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
import { YapiKrediConfig, YapiKrediCallbackData } from './types';
import {
  PosnetResponse,
  assertPosnetOrderNo,
  buildAutoSubmitForm,
  buildPosnetMac,
  buildPosnetResponseMac,
  buildXmlEnvelope,
  formatExpDateYYMM,
  formatYapiKrediAmount,
  formatYapiKrediInstallment,
  getYapiKrediCurrency,
  parsePosnetResponse,
  posnetOrderStatus,
  lowerKeys,
  safeEqual,
  toPosnetOrderNo,
} from './utils';

export type { YapiKrediConfig, YapiKrediCallbackData } from './types';

const XML_PATH = '/PosnetWebService/XML';
const THREE_D_GATE_PATH = '/3DSWebService/YKBPaymentService';

type Outcome = { status: PaymentStatus; errorCode?: string; errorMessage?: string; rawResponse?: any };

/**
 * Yapı Kredi Posnet Sanal POS — XML API + OOS 3D Secure.
 *
 * - createPayment: XML `sale` (non-3D)
 * - initThreeDSPayment: `oosRequestData` → the bank's encrypted data1/data2/sign
 *   are posted from the browser to the 3D gateway
 * - completeThreeDSPayment: `oosResolveMerchantData` (bank decrypts the callback),
 *   bank MAC checked against the merchant's own order number + amount, then
 *   `oosTranData` charges
 * - refund `return`, cancel `reverse`, getPayment `agreement`
 *
 * Ids: `conversationId` is always the 20-char Posnet order number (your
 * conversationId zero-padded when it fits `[A-Za-z0-9_]{1,20}`, otherwise a
 * generated one) — that's what getPayment and the 3D completion take.
 * A successful charge returns the bank's `hostlogkey` as `paymentId`; refund
 * and cancel take that.
 */
export class YapiKredi extends PaymentProvider {
  private client: AxiosInstance;
  private merchantId: string;
  private terminalId: string;
  private posnetId: string;
  private encKey: string;
  private acceptedMdStatuses: string[];

  constructor(config: PaymentProviderConfig & YapiKrediConfig) {
    if (!config.merchantId) throw new Error('Yapı Kredi merchantId is required');
    if (!config.terminalId) throw new Error('Yapı Kredi terminalId is required');
    if (!config.posnetId) throw new Error('Yapı Kredi posnetId is required');
    if (!config.encKey) throw new Error('Yapı Kredi encKey is required');
    super({ ...config, apiKey: config.merchantId, secretKey: config.encKey });
    this.merchantId = config.merchantId;
    this.terminalId = config.terminalId;
    this.posnetId = config.posnetId;
    this.encKey = config.encKey;
    this.acceptedMdStatuses = config.acceptedMdStatuses ?? ['1'];
    this.client = axios.create({
      baseURL: this.config.baseUrl,
      // Posnet can take up to ~45s to answer; a shorter timeout turns real charges into "unknown".
      timeout: 60000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      responseType: 'text',
    });
    this.setupAxiosLogging(this.client, 'yapikredi');
    this.setupAxiosRetry(this.client);
  }

  protected validateConfig(): void {
    // Validation in constructor.
  }

  private async postXml(payload: Record<string, any>): Promise<PosnetResponse> {
    const xml = buildXmlEnvelope({ mid: this.merchantId, tid: this.terminalId, ...payload });
    const res = await this.client.post<string>(XML_PATH, `xmldata=${encodeURIComponent(xml)}`);
    return parsePosnetResponse(res.data);
  }

  private static declined(res: PosnetResponse) {
    return { errorCode: res.fields.respCode, errorMessage: res.fields.respText };
  }

  /**
   * No response on a money-moving call means the outcome is unknown: PENDING +
   * NETWORK_ERROR, confirm with getPayment. Anything else is a FAILURE. Never
   * return the axios error itself (its config carries the request body).
   */
  private failure(err: any, fallback: string, movesMoney: boolean): Outcome {
    if (movesMoney && axios.isAxiosError(err) && !err.response) {
      return {
        status: PaymentStatus.PENDING,
        errorCode: 'NETWORK_ERROR',
        errorMessage: 'No response from Yapı Kredi; the outcome is unknown — check it with getPayment()',
      };
    }
    return {
      status: PaymentStatus.FAILURE,
      errorMessage: err?.message || fallback,
      rawResponse: err?.response?.data,
    };
  }

  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    const orderNo = toPosnetOrderNo(request.conversationId);
    try {
      const card = request.paymentCard;
      const res = await this.postXml({
        tranDateRequired: '1',
        sale: {
          amount: formatYapiKrediAmount(request.price, request.currency as string),
          ccno: card.cardNumber.replace(/\s/g, ''),
          currencyCode: getYapiKrediCurrency(request.currency as string),
          cvc: card.cvc,
          expDate: formatExpDateYYMM(card.expireMonth, card.expireYear),
          installment: formatYapiKrediInstallment((request as ThreeDSPaymentRequest).installment),
          // Non-3D order ids are 24 characters on Posnet.
          orderID: orderNo.padStart(24, '0'),
        },
      });
      const approved = res.fields.approved === '1';
      return {
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        paymentId: approved ? res.fields.hostlogkey : undefined,
        conversationId: orderNo,
        ...(approved ? {} : YapiKredi.declined(res)),
        rawResponse: res,
      };
    } catch (err: any) {
      return { ...this.failure(err, 'Yapı Kredi createPayment failed', true), conversationId: orderNo };
    }
  }

  /**
   * Registers the card + order with `oosRequestData` (no money moves) and
   * returns a form that posts the bank's encrypted packets to the 3D gateway.
   * `paymentId` is the Posnet order number: keep it, completion needs it back.
   */
  async initThreeDSPayment(request: ThreeDSPaymentRequest): Promise<ThreeDSInitResponse> {
    const orderNo = toPosnetOrderNo(request.conversationId);
    try {
      if (!request.callbackUrl) throw new Error('callbackUrl is required for 3D Secure');
      const card = request.paymentCard;
      const res = await this.postXml({
        oosRequestData: {
          posnetid: this.posnetId,
          ccno: card.cardNumber.replace(/\s/g, ''),
          expDate: formatExpDateYYMM(card.expireMonth, card.expireYear),
          cvc: card.cvc,
          amount: formatYapiKrediAmount(request.price, request.currency as string),
          currencyCode: getYapiKrediCurrency(request.currency as string),
          installment: formatYapiKrediInstallment(request.installment),
          XID: orderNo,
          cardHolderName: card.cardHolderName,
          tranType: 'Sale',
        },
      });
      const { data1, data2, sign } = res.oos;
      if (res.fields.approved !== '1' || !data1 || !data2 || !sign) {
        return {
          status: PaymentStatus.FAILURE,
          conversationId: orderNo,
          ...YapiKredi.declined(res),
          rawResponse: res,
        };
      }
      return {
        status: PaymentStatus.PENDING,
        threeDSHtmlContent: buildAutoSubmitForm(`${this.config.baseUrl}${THREE_D_GATE_PATH}`, {
          mid: this.merchantId,
          posnetID: this.posnetId,
          posnetData: data1,
          posnetData2: data2,
          digest: sign,
          merchantReturnURL: request.callbackUrl,
          url: '',
          lang: (this.config.locale || 'tr').toLowerCase().startsWith('en') ? 'en' : 'tr',
        }),
        paymentId: orderNo,
        conversationId: orderNo,
      };
    } catch (err: any) {
      return { ...this.failure(err, 'Yapı Kredi initThreeDSPayment failed', false), conversationId: orderNo };
    }
  }

  /**
   * Completes a 3D payment from the `merchantReturnURL` POST.
   *
   * The POST only carries encrypted packets, so pass the order from your own
   * records: `completeThreeDSPayment({ ...callbackBody, orderId, amount, currency })`
   * where `orderId` is the `paymentId` initThreeDSPayment returned.
   *
   * Order of checks: the bank decrypts the packets (`oosResolveMerchantData`);
   * its answer MAC — computed here over YOUR order number, amount and currency —
   * must match (constant-time), so a callback from another order or for another
   * amount fails before mdStatus is read. Only then is `oosTranData` sent.
   */
  async completeThreeDSPayment(callbackData: YapiKrediCallbackData): Promise<PaymentResponse> {
    const data = (callbackData || {}) as YapiKrediCallbackData;
    const str = (v: unknown) => (v == null ? '' : String(v));
    const packets = {
      bankData: str(data.BankPacket),
      merchantData: str(data.MerchantPacket),
      sign: str(data.Sign),
    };
    if (!packets.bankData || !packets.merchantData || !packets.sign) {
      return {
        status: PaymentStatus.FAILURE,
        errorCode: 'INVALID_CALLBACK',
        errorMessage: 'Yapı Kredi callback is missing BankPacket, MerchantPacket or Sign',
        rawResponse: callbackData,
      };
    }
    if (!data.orderId || !data.amount) {
      return {
        status: PaymentStatus.FAILURE,
        errorCode: 'VALIDATION_ERROR',
        errorMessage:
          'Yapı Kredi completion needs orderId and amount from your records: ' +
          'completeThreeDSPayment({ ...callbackBody, orderId, amount, currency })',
        rawResponse: callbackData,
      };
    }

    let xid: string;
    let charging = false;
    try {
      xid = assertPosnetOrderNo(str(data.orderId));
      const macInput = {
        xid,
        amount: formatYapiKrediAmount(str(data.amount), str(data.currency) || 'TRY'),
        currency: getYapiKrediCurrency(str(data.currency) || undefined),
        merchantId: this.merchantId,
        terminalId: this.terminalId,
        encKey: this.encKey,
      };
      const mac = buildPosnetMac(macInput);

      const resolve = await this.postXml({ oosResolveMerchantData: { ...packets, mac } });
      if (resolve.fields.approved !== '1') {
        return {
          status: PaymentStatus.FAILURE,
          ...YapiKredi.declined(resolve),
          rawResponse: { resolve },
        };
      }
      const r = resolve.oos;
      const expectedMac = buildPosnetResponseMac(r.mdStatus ?? '', macInput);
      if (
        !r.mac ||
        !safeEqual(r.mac, expectedMac) ||
        r.xid !== xid ||
        r.amount !== macInput.amount ||
        (r.currency !== undefined && r.currency !== macInput.currency)
      ) {
        return {
          status: PaymentStatus.FAILURE,
          errorCode: 'INVALID_HASH',
          errorMessage: 'Yapı Kredi 3D result does not match the order (MAC / order number / amount)',
          rawResponse: { resolve },
        };
      }
      if (!r.mdStatus || !this.acceptedMdStatuses.includes(r.mdStatus)) {
        return {
          status: PaymentStatus.FAILURE,
          conversationId: xid,
          errorCode: `MD_STATUS_${r.mdStatus ?? ''}`,
          errorMessage: r.mdErrorMessage || `3D authentication failed (mdStatus=${r.mdStatus})`,
          rawResponse: { resolve },
        };
      }

      charging = true;
      const payment = await this.postXml({ oosTranData: { ...packets, wpAmount: '0', mac } });
      if (payment.fields.approved !== '1') {
        return {
          status: PaymentStatus.FAILURE,
          conversationId: xid,
          ...YapiKredi.declined(payment),
          rawResponse: { resolve, payment },
        };
      }
      const hostlogkey = payment.fields.hostlogkey ?? '';
      if (
        payment.fields.mac &&
        !safeEqual(payment.fields.mac, buildPosnetResponseMac(hostlogkey, macInput))
      ) {
        return {
          status: PaymentStatus.PENDING,
          conversationId: xid,
          errorCode: 'INVALID_HASH',
          errorMessage: 'Yapı Kredi charge answer MAC does not match; check the order with getPayment()',
          rawResponse: { resolve, payment },
        };
      }
      return {
        status: PaymentStatus.SUCCESS,
        paymentId: hostlogkey || undefined,
        conversationId: xid,
        rawResponse: { resolve, payment },
      };
    } catch (err: any) {
      const out = this.failure(err, 'Yapı Kredi completeThreeDSPayment failed', charging);
      return charging ? { ...out, conversationId: xid! } : out;
    }
  }

  /** XML `return`; `paymentId` is the payment's hostlogkey. Partial amounts allowed. */
  async refund(request: RefundRequest): Promise<RefundResponse> {
    try {
      const res = await this.postXml({
        tranDateRequired: '1',
        return: {
          amount: formatYapiKrediAmount(request.price, request.currency as string),
          currencyCode: getYapiKrediCurrency(request.currency as string),
          hostLogKey: request.paymentId,
        },
      });
      const approved = res.fields.approved === '1';
      return {
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        refundId: approved ? res.fields.hostlogkey || request.paymentId : undefined,
        conversationId: request.conversationId,
        ...(approved ? {} : YapiKredi.declined(res)),
        rawResponse: res,
      };
    } catch (err: any) {
      return { ...this.failure(err, 'Yapı Kredi refund failed', true), conversationId: request.conversationId };
    }
  }

  /** XML `reverse` (same day, before batch close); `paymentId` is the hostlogkey. */
  async cancel(request: CancelRequest): Promise<CancelResponse> {
    try {
      const res = await this.postXml({
        tranDateRequired: '1',
        reverse: { transaction: 'sale', hostLogKey: request.paymentId },
      });
      const approved = res.fields.approved === '1';
      return {
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        voidId: approved ? res.fields.hostlogkey || request.paymentId : undefined,
        conversationId: request.conversationId,
        ...(approved ? {} : YapiKredi.declined(res)),
        rawResponse: res,
      };
    } catch (err: any) {
      return { ...this.failure(err, 'Yapı Kredi cancel failed', true), conversationId: request.conversationId };
    }
  }

  /**
   * XML `agreement` by **order number** (the `conversationId` / init
   * `paymentId`), not by hostlogkey. Posnet files a non-3D order under the
   * zero-padded 24-char id and a 3D one under a 4-char prefix + XID.
   *
   * shortcut: the 3D prefix is documented as both `TDSC` and `TDS_` by
   * different integrations, so both are tried (read-only); drop the wrong one
   * once a real merchant confirms.
   */
  async getPayment(paymentId: string): Promise<PaymentResponse> {
    try {
      const xid = assertPosnetOrderNo(paymentId);
      let res!: PosnetResponse;
      for (const orderID of [xid.padStart(24, '0'), `TDSC${xid}`, `TDS_${xid}`]) {
        res = await this.postXml({ agreement: { orderID } });
        if (res.fields.approved === '1' && res.transactions.length > 0) break;
      }
      if (res.fields.approved !== '1' || res.transactions.length === 0) {
        return {
          status: PaymentStatus.FAILURE,
          conversationId: xid,
          ...(res.fields.approved === '1'
            ? { errorCode: 'NOT_FOUND', errorMessage: 'No transaction found for the order' }
            : YapiKredi.declined(res)),
          rawResponse: res,
        };
      }
      const txs = res.transactions.map(lowerKeys);
      const sale = txs.find(
        (t) => t.txnstatus === '1' && ['sale', 'vft_sale', 'capture', 'authorization'].includes(t.state?.toLowerCase()),
      );
      return {
        status: posnetOrderStatus(txs),
        paymentId: sale?.hostlogkey || undefined,
        conversationId: xid,
        rawResponse: res,
      };
    } catch (err: any) {
      return this.failure(err, 'Yapı Kredi getPayment failed', false);
    }
  }
}
