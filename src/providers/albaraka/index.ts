import axios, { AxiosInstance } from 'axios';
import { PaymentProvider, PaymentProviderConfig } from '../../core/PaymentProvider';
import {
  PaymentRequest,
  PaymentResponse,
  ThreeDSPaymentRequest,
  ThreeDSInitResponse,
  RefundRequest,
  RefundResponse,
  CancelRequest,
  CancelResponse,
  PaymentStatus,
} from '../../types';
import { AlbarakaConfig, AlbarakaCallbackData, AlbarakaResponse } from './types';
import { buildAlbarakaMac, pick, verifyAlbaraka3DCallback } from './utils';
import {
  assertPosnetOrderNo,
  buildAutoSubmitForm,
  formatExpDateYYMM,
  formatYapiKrediAmount,
  getYapiKrediCurrency,
  lowerKeys,
  posnetOrderStatus,
  toPosnetOrderNo,
} from '../yapikredi/utils';

export type { AlbarakaConfig, AlbarakaCallbackData, AlbarakaResponse } from './types';
export { verifyAlbaraka3DCallback } from './utils';

const API_PATH = '/ALBMerchantService/MerchantJSONAPI.svc';
const THREE_D_GATE_PATH = '/ALBSecurePaymentUI/SecureProcess/SecureVerification.aspx';
const CARD_MAC_PARAMS = 'MerchantNo:TerminalNo:CardNo:Cvc2:ExpireDate:Amount';
const REFERENCE_MAC_PARAMS = 'MerchantNo:TerminalNo:ReferenceCode:OrderId';

type Outcome = { status: PaymentStatus; errorCode?: string; errorMessage?: string; rawResponse?: any };

function installmentOf(n: number | string | undefined) {
  const count = Number(n ?? 1);
  if (!Number.isInteger(count) || count < 1 || count > 99) throw new Error(`Invalid installment: ${n}`);
  return count > 1 ? { count, type: 'Y' } : { count: 0, type: 'N' };
}

/**
 * Albaraka Türk e-POS (Posnet JSON API).
 *
 * - createPayment: JSON `Sale` (non-3D)
 * - initThreeDSPayment: MAC-signed form to the 3D verification page
 * - completeThreeDSPayment: callback `Mac` verified, then JSON `Sale` with the
 *   3D data for the order number + amount from your records
 * - refund `Return`, cancel `Reverse`, getPayment `TransactionInquiry`
 *
 * Ids: `conversationId` is the 20-char order number (your conversationId
 * zero-padded when it fits `[A-Za-z0-9_]{1,20}`, otherwise generated) — what
 * getPayment and the 3D completion take. A successful charge returns the
 * bank's `ReferenceCode` as `paymentId`; refund and cancel take that.
 * Pre-authorization is not implemented.
 */
export class Albaraka extends PaymentProvider {
  private client: AxiosInstance;
  private merchantId: string;
  private terminalId: string;
  private posnetId: string;
  private encKey: string;
  private acceptedMdStatuses: string[];

  constructor(config: PaymentProviderConfig & AlbarakaConfig) {
    if (!config.merchantId) throw new Error('Albaraka merchantId is required');
    if (!config.terminalId) throw new Error('Albaraka terminalId is required');
    if (!config.posnetId) throw new Error('Albaraka posnetId is required');
    if (!config.encKey) throw new Error('Albaraka encKey is required');
    super({ ...config, apiKey: config.merchantId, secretKey: config.encKey });
    this.merchantId = config.merchantId;
    this.terminalId = config.terminalId;
    this.posnetId = config.posnetId;
    this.encKey = config.encKey;
    this.acceptedMdStatuses = config.acceptedMdStatuses ?? ['1'];
    this.client = axios.create({
      baseURL: this.config.baseUrl,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
    });
    this.setupAxiosLogging(this.client, 'albaraka');
    this.setupAxiosRetry(this.client);
  }

  protected validateConfig(): void {
    // Validation in constructor.
  }

  private async call(operation: string, body: Record<string, unknown>): Promise<AlbarakaResponse> {
    const res = await this.client.post<AlbarakaResponse>(`${API_PATH}/${operation}`, {
      ApiType: 'JSON',
      ApiVersion: 'V100',
      MerchantNo: this.merchantId,
      TerminalNo: this.terminalId,
      ...body,
    });
    if (!res.data || typeof res.data !== 'object') throw new Error('Unexpected Albaraka response');
    return res.data;
  }

  private static approved(res: AlbarakaResponse): boolean {
    return res.ServiceResponseData?.ResponseCode === '00';
  }

  private static declined(res: AlbarakaResponse) {
    return {
      errorCode: res.ServiceResponseData?.ResponseCode || undefined,
      errorMessage: res.ServiceResponseData?.ResponseDescription || undefined,
    };
  }

  /** No response on a money-moving call → PENDING/NETWORK_ERROR; never leak the axios error. */
  private failure(err: any, fallback: string, movesMoney: boolean): Outcome {
    if (movesMoney && axios.isAxiosError(err) && !err.response) {
      return {
        status: PaymentStatus.PENDING,
        errorCode: 'NETWORK_ERROR',
        errorMessage: 'No response from Albaraka; the outcome is unknown — check it with getPayment()',
      };
    }
    return {
      status: PaymentStatus.FAILURE,
      errorMessage: err?.message || fallback,
      rawResponse: err?.response?.data,
    };
  }

  private referenceMac(referenceCode: string): string {
    // OrderId is sent as null, so it adds nothing to the MAC.
    return buildAlbarakaMac([this.merchantId, this.terminalId, referenceCode, null], this.encKey);
  }

  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    const orderNo = toPosnetOrderNo(request.conversationId);
    try {
      const card = request.paymentCard;
      const cardNo = card.cardNumber.replace(/\s/g, '');
      const expire = formatExpDateYYMM(card.expireMonth, card.expireYear);
      const amount = Number(formatYapiKrediAmount(request.price, request.currency as string));
      const inst = installmentOf((request as ThreeDSPaymentRequest).installment);
      // The service rejects bodies that leave out a data member, so unused ones go as null.
      const res = await this.call('Sale', {
        MACParams: CARD_MAC_PARAMS,
        CipheredData: null,
        DealerData: null,
        IsEncrypted: null,
        PaymentFacilitatorData: null,
        AdditionalInfoData: null,
        CardInformationData: {
          CardNo: cardNo,
          ExpireDate: expire,
          Cvc2: card.cvc,
          CardHolderName: card.cardHolderName,
        },
        IsMailOrder: 'N',
        IsRecurring: null,
        IsTDSecureMerchant: null,
        PaymentInstrumentType: 'CARD',
        ThreeDSecureData: null,
        Amount: amount,
        CurrencyCode: getYapiKrediCurrency(request.currency as string),
        OrderId: orderNo,
        InstallmentCount: inst.count,
        InstallmentType: inst.type,
        KOICode: null,
        MerchantMessageData: null,
        PointAmount: null,
        MAC: buildAlbarakaMac(
          [this.merchantId, this.terminalId, cardNo, card.cvc, expire, amount],
          this.encKey,
        ),
      });
      const ok = Albaraka.approved(res);
      return {
        status: ok ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        paymentId: ok ? res.ReferenceCode || undefined : undefined,
        conversationId: orderNo,
        ...(ok ? {} : Albaraka.declined(res)),
        rawResponse: res,
      };
    } catch (err: any) {
      return { ...this.failure(err, 'Albaraka createPayment failed', true), conversationId: orderNo };
    }
  }

  /**
   * Builds the MAC-signed form to Albaraka's 3D page (the MAC covers the card
   * and the Amount, which binds the amount to the 3D session). No API call,
   * no money moves. `paymentId` is the order number: completion needs it back.
   */
  async initThreeDSPayment(request: ThreeDSPaymentRequest): Promise<ThreeDSInitResponse> {
    const orderNo = toPosnetOrderNo(request.conversationId);
    try {
      if (!request.callbackUrl) throw new Error('callbackUrl is required for 3D Secure');
      const card = request.paymentCard;
      const cardNo = card.cardNumber.replace(/\s/g, '');
      const expire = formatExpDateYYMM(card.expireMonth, card.expireYear);
      const amount = formatYapiKrediAmount(request.price, request.currency as string);
      const fields: Record<string, string> = {
        MerchantNo: this.merchantId,
        TerminalNo: this.terminalId,
        PosnetID: this.posnetId,
        TransactionType: 'Sale',
        OrderId: orderNo,
        Amount: amount,
        CurrencyCode: getYapiKrediCurrency(request.currency as string),
        MerchantReturnURL: request.callbackUrl,
        InstallmentCount: String(installmentOf(request.installment).count),
        Language: (this.config.locale || 'tr').toLowerCase().startsWith('en') ? 'en' : 'tr',
        TxnState: 'INITIAL',
        OpenNewWindow: '0',
        CardNo: cardNo,
        // The MAC calls it ExpireDate, the form field is ExpiredDate.
        ExpiredDate: expire,
        Cvv: card.cvc,
        CardHolderName: card.cardHolderName || '',
        MacParams: CARD_MAC_PARAMS,
        UseOOS: '0',
        Mac: buildAlbarakaMac(
          [this.merchantId, this.terminalId, cardNo, card.cvc, expire, amount],
          this.encKey,
        ),
      };
      return {
        status: PaymentStatus.PENDING,
        threeDSHtmlContent: buildAutoSubmitForm(`${this.config.baseUrl}${THREE_D_GATE_PATH}`, fields),
        paymentId: orderNo,
        conversationId: orderNo,
      };
    } catch (err: any) {
      return { ...this.failure(err, 'Albaraka initThreeDSPayment failed', false), conversationId: orderNo };
    }
  }

  /**
   * Completes a 3D payment from the `MerchantReturnURL` POST.
   *
   * `completeThreeDSPayment({ ...callbackBody, orderId, amount, currency })` —
   * `orderId` is the `paymentId` init returned, `amount`/`currency` come from
   * your records (the signed callback fields carry neither).
   *
   * The callback `Mac` is verified first (constant-time, see
   * verifyAlbaraka3DCallback); MdStatus is read only after that. The charge is
   * a JSON `Sale` with the 3D data; the bank checks the CAVV against its own
   * 3D session, and its answer decides.
   */
  async completeThreeDSPayment(callbackData: AlbarakaCallbackData): Promise<PaymentResponse> {
    const data = (callbackData || {}) as AlbarakaCallbackData;
    if (!verifyAlbaraka3DCallback(data, this.encKey)) {
      return {
        status: PaymentStatus.FAILURE,
        errorCode: 'INVALID_HASH',
        errorMessage: 'Albaraka 3DS callback MAC verification failed',
        rawResponse: callbackData,
      };
    }
    const str = (v: unknown) => (v == null ? '' : String(v));
    // Same accessor as the verifier, so a duplicate key in another case can't swap a signed value.
    const field = (name: string) => pick(data, name);
    const mdStatus = field('MdStatus');
    if (!this.acceptedMdStatuses.includes(mdStatus)) {
      return {
        status: PaymentStatus.FAILURE,
        errorCode: `MD_STATUS_${mdStatus}`,
        errorMessage: field('MdErrorMessage') || `3D authentication failed (MdStatus=${mdStatus})`,
        rawResponse: callbackData,
      };
    }
    if (!data.orderId || !data.amount) {
      return {
        status: PaymentStatus.FAILURE,
        errorCode: 'VALIDATION_ERROR',
        errorMessage:
          'Albaraka completion needs orderId and amount from your records: ' +
          'completeThreeDSPayment({ ...callbackBody, orderId, amount, currency })',
        rawResponse: callbackData,
      };
    }

    let orderNo = '';
    let charging = false;
    try {
      orderNo = assertPosnetOrderNo(str(data.orderId));
      const currency = str(data.currency) || 'TRY';
      const inst = installmentOf(data.installment as number | string | undefined);
      const secure = {
        SecureTransactionId: field('SecureTransactionId'),
        CavvData: field('CAVV'),
        Eci: field('ECI'),
        MdStatus: Number(mdStatus),
        MD: field('MD'),
      };
      charging = true;
      const res = await this.call('Sale', {
        PaymentInstrumentType: 'CARD',
        IsEncrypted: 'N',
        IsTDSecureMerchant: 'Y',
        IsMailOrder: 'N',
        ThreeDSecureData: secure,
        MACParams: 'MerchantNo:TerminalNo:SecureTransactionId:CavvData:Eci:MdStatus',
        Amount: Number(formatYapiKrediAmount(str(data.amount), currency)),
        CurrencyCode: getYapiKrediCurrency(currency),
        PointAmount: 0,
        OrderId: orderNo,
        InstallmentCount: inst.count,
        InstallmentType: inst.type,
        MAC: buildAlbarakaMac(
          [this.merchantId, this.terminalId, secure.SecureTransactionId, secure.CavvData, secure.Eci, mdStatus],
          this.encKey,
        ),
      });
      const ok = Albaraka.approved(res);
      return {
        status: ok ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        paymentId: ok ? res.ReferenceCode || undefined : undefined,
        conversationId: orderNo,
        ...(ok ? {} : Albaraka.declined(res)),
        rawResponse: { callback: callbackData, payment: res },
      };
    } catch (err: any) {
      const out = this.failure(err, 'Albaraka completeThreeDSPayment failed', charging);
      return charging ? { ...out, conversationId: orderNo } : out;
    }
  }

  /** JSON `Return`; `paymentId` is the payment's ReferenceCode. Partial amounts allowed. */
  async refund(request: RefundRequest): Promise<RefundResponse> {
    try {
      const res = await this.call('Return', {
        MACParams: REFERENCE_MAC_PARAMS,
        CipheredData: null,
        DealerData: null,
        IsEncrypted: null,
        PaymentFacilitatorData: null,
        ReferenceCode: request.paymentId,
        OrderId: null,
        TransactionType: 'Sale',
        Amount: Number(formatYapiKrediAmount(request.price, request.currency as string)),
        CurrencyCode: getYapiKrediCurrency(request.currency as string),
        MAC: this.referenceMac(request.paymentId),
      });
      const ok = Albaraka.approved(res);
      return {
        status: ok ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        refundId: ok ? res.ReferenceCode || request.paymentId : undefined,
        conversationId: request.conversationId,
        ...(ok ? {} : Albaraka.declined(res)),
        rawResponse: res,
      };
    } catch (err: any) {
      return { ...this.failure(err, 'Albaraka refund failed', true), conversationId: request.conversationId };
    }
  }

  /** JSON `Reverse` (before end of day); `paymentId` is the ReferenceCode. */
  async cancel(request: CancelRequest): Promise<CancelResponse> {
    try {
      const res = await this.call('Reverse', {
        MACParams: REFERENCE_MAC_PARAMS,
        CipheredData: null,
        DealerData: null,
        IsEncrypted: null,
        PaymentFacilitatorData: null,
        ReferenceCode: request.paymentId,
        OrderId: null,
        TransactionType: 'Sale',
        MAC: this.referenceMac(request.paymentId),
      });
      const ok = Albaraka.approved(res);
      return {
        status: ok ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        voidId: ok ? res.ReferenceCode || request.paymentId : undefined,
        conversationId: request.conversationId,
        ...(ok ? {} : Albaraka.declined(res)),
        rawResponse: res,
      };
    } catch (err: any) {
      return { ...this.failure(err, 'Albaraka cancel failed', true), conversationId: request.conversationId };
    }
  }

  /**
   * JSON `TransactionInquiry` by **order number** (conversationId / init
   * paymentId). A 3D order is filed as `TDS_` + order number, a non-3D one as
   * the 24-char zero-padded order number; both are tried (read-only).
   *
   * shortcut: TransactionData's shape is unconfirmed with a real merchant; it
   * is read like YKB's `agreement` list (TxnStatus/State), and anything else
   * maps to PENDING with the answer in rawResponse.
   */
  async getPayment(paymentId: string): Promise<PaymentResponse> {
    try {
      const orderNo = assertPosnetOrderNo(paymentId);
      let res!: AlbarakaResponse;
      for (const OrderId of [`TDS_${orderNo}`, orderNo.padStart(24, '0')]) {
        res = await this.call('TransactionInquiry', {
          MACParams: 'MerchantNo:TerminalNo',
          CipheredData: null,
          DealerData: null,
          IsEncrypted: 'N',
          PaymentFacilitatorData: null,
          OrderId,
          MAC: buildAlbarakaMac([this.merchantId, this.terminalId], this.encKey),
        });
        if (Albaraka.approved(res)) break;
      }
      if (!Albaraka.approved(res)) {
        return { status: PaymentStatus.FAILURE, conversationId: orderNo, ...Albaraka.declined(res), rawResponse: res };
      }
      const raw = res.TransactionData;
      const txs = (Array.isArray(raw) ? raw : raw ? [raw] : [])
        .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
        .map(lowerKeys);
      const status = posnetOrderStatus(txs);
      const sale = txs.find((t) => t.txnstatus === '1' && t.referencecode);
      return {
        status,
        paymentId: (sale?.referencecode || res.ReferenceCode) ?? undefined,
        conversationId: orderNo,
        rawResponse: res,
      };
    } catch (err: any) {
      return this.failure(err, 'Albaraka getPayment failed', false);
    }
  }
}
