import axios, { AxiosInstance } from 'axios';
import { randomBytes } from 'crypto';
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
import { QnbConfig, Qnb3DCallbackData, QnbSecureType } from './types';
import {
  bankAmount,
  bankCurrencyCode,
  bankExpiry,
  bankFailure,
  buildBankFormHtml,
  field,
  sameAmount,
} from '../denizbank/utils';
import {
  QNB_API_PATH,
  QNB_GATE_PATH,
  QNB_MBR_ID,
  assertQnbOrderId,
  buildQnbXml,
  mapQnbInquiry,
  parseQnbXml,
  qnbFormHash,
  qnbInstallment,
  verifyQnb3DCallback,
} from './utils';

export type { QnbConfig, Qnb3DCallbackData, QnbSecureType } from './types';
export { verifyQnb3DCallback } from './utils';

const BANK = 'QNB';
// shortcut: CancelRequest and getPayment carry no currency, so Void/OrderInquiry assume TRY; thread a currency through if non-TRY terminals need them
const TRY_CODE = '949';

/**
 * QNB (ex QNB Finansbank PayFor) virtual POS provider.
 *
 * - `createPayment`: XML `Auth`, SecureType `NonSecure`
 * - `initThreeDSPayment`: signed auto-submitting form, SecureType from config
 * - `completeThreeDSPayment`: verifies `ResponseHash`, then confirms with the
 *   bank — 3D Model charges with `3DModelPayment`, 3D Pay is checked with
 *   `OrderInquiry`
 * - `refund` (`Refund`, earlier-day sales), `cancel` (`Void`, same day),
 *   `getPayment` (`OrderInquiry`)
 *
 * `paymentId` is the OrderId: your `conversationId`, or a generated one.
 */
export class Qnb extends PaymentProvider {
  private client: AxiosInstance;
  private merchantId: string;
  private userCode: string;
  private userPass: string;
  private merchantPass: string;
  private secureType: QnbSecureType;

  constructor(config: PaymentProviderConfig & QnbConfig) {
    if (!config.merchantId) throw new Error('QNB merchantId is required');
    if (!config.userCode) throw new Error('QNB userCode is required');
    if (!config.userPass) throw new Error('QNB userPass is required');
    if (!config.merchantPass) throw new Error('QNB merchantPass is required');
    // Without it the 3D form would post the card to a relative URL on the merchant's own site.
    if (!config.baseUrl) throw new Error('QNB baseUrl is required');
    if (config.secureType && config.secureType !== '3DModel' && config.secureType !== '3DPay') {
      throw new Error(`QNB secureType must be '3DModel' or '3DPay', got: ${config.secureType}`);
    }
    super({ ...config, apiKey: config.merchantId, secretKey: config.merchantPass });
    this.merchantId = config.merchantId;
    this.userCode = config.userCode;
    this.userPass = config.userPass;
    this.merchantPass = config.merchantPass;
    this.secureType = config.secureType ?? '3DModel';
    this.client = axios.create({
      baseURL: this.config.baseUrl,
      timeout: 30000,
      headers: { 'Content-Type': 'application/xml' },
      responseType: 'text',
    });
    this.setupAxiosLogging(this.client, 'qnb');
    this.setupAxiosSecurity(this.client, 'qnb');
    this.setupAxiosRetry(this.client);
  }

  protected validateConfig(): void {
    // Checked in the constructor; apiKey/secretKey are synthesized for the base class.
  }

  private get lang(): string {
    return (this.config.locale || 'tr').toLowerCase().startsWith('en') ? 'EN' : 'TR';
  }

  private async api(fields: Record<string, string>): Promise<Record<string, string>> {
    const xml = buildQnbXml({
      MbrId: QNB_MBR_ID,
      MerchantId: this.merchantId,
      UserCode: this.userCode,
      UserPass: this.userPass,
      ...fields,
      Lang: this.lang,
    });
    const res = await this.client.post(QNB_API_PATH, xml);
    return parseQnbXml(res.data);
  }

  private inquiry(orderId: string, currencyCode = TRY_CODE): Promise<Record<string, string>> {
    return this.api({ OrgOrderId: orderId, SecureType: 'Inquiry', TxnType: 'OrderInquiry', Currency: currencyCode });
  }

  private static declined(res: Record<string, string | undefined>) {
    return { errorCode: res.ProcReturnCode || undefined, errorMessage: res.ErrMsg || undefined };
  }

  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    const orderId = request.conversationId || `QNB-${Date.now()}`;
    try {
      assertQnbOrderId(orderId);
      const card = request.paymentCard;
      if (!card?.cardNumber) throw new Error('paymentCard is required');
      const res = await this.api({
        OrderId: orderId,
        SecureType: 'NonSecure',
        TxnType: 'Auth',
        InstallmentCount: qnbInstallment((request as Partial<ThreeDSPaymentRequest>).installment),
        PurchAmount: bankAmount(request.paidPrice || request.price),
        Currency: bankCurrencyCode(request.currency, BANK),
        CardHolderName: card.cardHolderName || '',
        Pan: card.cardNumber.replace(/\s/g, ''),
        Expiry: bankExpiry(card.expireMonth, card.expireYear),
        Cvv2: card.cvc,
        MOTO: '0',
      });
      const ok = res.ProcReturnCode === '00';
      return {
        status: ok ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        paymentId: orderId,
        conversationId: orderId,
        ...(ok ? {} : Qnb.declined(res)),
        rawResponse: res,
      };
    } catch (error) {
      return bankFailure<PaymentResponse>(error, BANK, 'QNB payment failed', { paymentId: orderId, conversationId: orderId });
    }
  }

  /**
   * 3D form for the configured `secureType`. Signed with MerchantPass; the API
   * password is not in it. Pass `failUrl` to split success/failure posts.
   */
  async initThreeDSPayment(request: ThreeDSPaymentRequest & { failUrl?: string }): Promise<ThreeDSInitResponse> {
    const orderId = request.conversationId || `QNB-${Date.now()}`;
    try {
      assertQnbOrderId(orderId);
      const card = request.paymentCard;
      if (!request.callbackUrl) throw new Error('callbackUrl is required for 3D Secure');
      if (!card?.cardNumber) throw new Error('paymentCard is required');
      const fields: Record<string, string> = {
        MbrId: QNB_MBR_ID,
        MerchantID: this.merchantId,
        UserCode: this.userCode,
        SecureType: this.secureType,
        TxnType: 'Auth',
        InstallmentCount: qnbInstallment(request.installment),
        Currency: bankCurrencyCode(request.currency, BANK),
        OkUrl: request.callbackUrl,
        FailUrl: request.failUrl || request.callbackUrl,
        OrderId: orderId,
        PurchAmount: bankAmount(request.paidPrice || request.price),
        Lang: this.lang,
        Rnd: randomBytes(10).toString('hex'),
        Pan: card.cardNumber.replace(/\s/g, ''),
        Expiry: bankExpiry(card.expireMonth, card.expireYear),
        Cvv2: card.cvc,
        CardHolderName: card.cardHolderName || '',
      };
      fields.Hash = qnbFormHash({
        orderId,
        amount: fields.PurchAmount,
        okUrl: fields.OkUrl,
        failUrl: fields.FailUrl,
        txnType: fields.TxnType,
        installment: fields.InstallmentCount,
        rnd: fields.Rnd,
        merchantPass: this.merchantPass,
      });
      return {
        status: PaymentStatus.PENDING,
        threeDSHtmlContent: buildBankFormHtml(`${this.config.baseUrl}${QNB_GATE_PATH}`, fields),
        paymentId: orderId,
        conversationId: orderId,
      };
    } catch (error) {
      return bankFailure<ThreeDSInitResponse>(error, BANK, 'QNB 3DS init failed', { paymentId: orderId, conversationId: orderId });
    }
  }

  /**
   * Completes a 3D payment from the OkUrl/FailUrl POST.
   *
   * `ResponseHash` is verified first (with merchantId/userCode from config),
   * before any status field is read. It joins its values without separators
   * and covers no amount, so the result is then confirmed with the bank:
   * - 3D Model: `3DModelPayment` with the callback's RequestGuid (unsigned);
   *   with `amount` given, `OrderInquiry` must then show this order's sale at
   *   that amount, since the guid could belong to another authentication;
   * - 3D Pay: the bank already charged; `OrderInquiry` must show an approved,
   *   not voided sale for this OrderId.
   * The model comes from config, never from the callback's SecureType.
   *
   * @param callbackData the parsed form body, plus optional `orderId`, `amount`
   *   and `currency` from your order record. When `amount` is given, the
   *   posted amount and the bank-confirmed (OrderInquiry) amount must equal it.
   */
  async completeThreeDSPayment(callbackData: Qnb3DCallbackData): Promise<PaymentResponse> {
    const data: Record<string, unknown> = callbackData && typeof callbackData === 'object' ? callbackData : {};

    if (!verifyQnb3DCallback(data, this.merchantId, this.merchantPass, this.userCode)) {
      this.emitSecurityEvent('callback_verification_failed', 'QNB 3D callback failed hash verification', {
        severity: 'critical',
      });
      return { status: PaymentStatus.FAILURE, errorCode: 'INVALID_HASH', errorMessage: 'Invalid 3D Secure callback hash', rawResponse: callbackData };
    }
    const orderId = field(data, 'OrderId')!;
    const merchant = field(data, 'MerchantID');
    if (merchant !== undefined && merchant !== this.merchantId) {
      return { status: PaymentStatus.FAILURE, errorCode: 'INVALID_HASH', errorMessage: 'Callback belongs to another merchant', rawResponse: callbackData };
    }
    if (data.orderId !== undefined && data.orderId !== orderId) {
      return { status: PaymentStatus.FAILURE, errorCode: 'ORDER_MISMATCH', errorMessage: 'Callback OrderId does not match the order', rawResponse: callbackData };
    }

    const ids = { paymentId: orderId, conversationId: orderId };
    const fail = (errorCode: string | undefined, errorMessage: string | undefined, rawResponse: unknown = callbackData): PaymentResponse => ({
      status: PaymentStatus.FAILURE,
      ...ids,
      errorCode,
      errorMessage,
      rawResponse,
    });

    if (field(data, '3DStatus') !== '1') {
      return fail(
        field(data, 'ProcReturnCode') || `3D_STATUS_${field(data, '3DStatus') ?? ''}`,
        field(data, 'ErrMsg') || '3D Secure authentication failed',
      );
    }

    let amount: string | undefined;
    let currencyCode: string;
    try {
      assertQnbOrderId(orderId);
      const recorded = data.amount;
      if (recorded !== undefined) {
        if (typeof recorded !== 'string' && typeof recorded !== 'number') throw new Error('callbackData.amount must be a decimal string');
        amount = bankAmount(recorded);
      }
      currencyCode = bankCurrencyCode(typeof data.currency === 'string' ? data.currency : undefined, BANK);
    } catch (error) {
      return fail('INVALID_REQUEST', (error as Error).message);
    }
    const posted = field(data, 'PurchAmount');
    if (amount !== undefined && posted !== undefined && !sameAmount(posted, amount)) {
      return fail('AMOUNT_MISMATCH', 'Callback amount does not match the order');
    }

    try {
      if (this.secureType === '3DModel') {
        const guid = field(data, 'RequestGuid');
        if (!guid) return fail('INVALID_REQUEST', 'Callback has no RequestGuid');
        const res = await this.api({ RequestGuid: guid, OrderId: orderId, SecureType: '3DModelPayment' });
        if (res.ProcReturnCode !== '00') {
          return fail(Qnb.declined(res).errorCode, Qnb.declined(res).errorMessage, { callback: callbackData, payment: res });
        }
        if (res.OrderId && res.OrderId !== orderId) {
          return fail('ORDER_MISMATCH', 'The bank charged a different order', { callback: callbackData, payment: res });
        }
        // RequestGuid is unsigned: with an order record, make the bank confirm this order's amount too.
        if (amount === undefined) {
          return { status: PaymentStatus.SUCCESS, ...ids, rawResponse: { callback: callbackData, payment: res } };
        }
        return await this.confirmSale(orderId, currencyCode, amount, { callback: callbackData, payment: res }, fail);
      }

      // 3D Pay: the bank charged in the browser leg; a signed "approved" still needs the bank's word.
      if (field(data, 'ProcReturnCode') !== '00') {
        return fail(field(data, 'ProcReturnCode'), field(data, 'ErrMsg') || 'Payment declined');
      }
      return await this.confirmSale(orderId, currencyCode, amount, { callback: callbackData }, fail);
    } catch (error) {
      return bankFailure<PaymentResponse>(error, BANK, 'QNB 3DS completion failed', ids);
    }
  }

  /**
   * `OrderInquiry` must show an approved, not voided/refunded sale for the
   * order and, when the merchant gave one, the same amount. Network errors
   * propagate to the caller's catch (→ PENDING with ids).
   */
  private async confirmSale(
    orderId: string,
    currencyCode: string,
    amount: string | undefined,
    raw: Record<string, unknown>,
    fail: (code: string, message: string, rawResponse: unknown) => PaymentResponse,
  ): Promise<PaymentResponse> {
    const res = await this.inquiry(orderId, currencyCode);
    const rawResponse = { ...raw, inquiry: res };
    const status = res.ProcReturnCode === '00' ? mapQnbInquiry(res) : PaymentStatus.FAILURE;
    if (status === PaymentStatus.PENDING) {
      return {
        status: PaymentStatus.PENDING,
        paymentId: orderId,
        conversationId: orderId,
        errorCode: 'NOT_CONFIRMED',
        errorMessage: 'Bank has not settled the order yet; check with getPayment',
        rawResponse,
      };
    }
    if (status !== PaymentStatus.SUCCESS) return fail('NOT_CONFIRMED', 'The bank does not confirm this payment', rawResponse);
    if (amount !== undefined && !sameAmount(res.PurchAmount ?? '', amount)) {
      return fail('CHARGED_AMOUNT_MISMATCH', 'The bank charged a different amount than the order; refund or cancel it', rawResponse);
    }
    return { status: PaymentStatus.SUCCESS, paymentId: orderId, conversationId: orderId, rawResponse };
  }

  /** `Refund` for a sale of an earlier day (same day: use `cancel`); partial allowed. `paymentId` is the OrderId. */
  async refund(request: RefundRequest): Promise<RefundResponse> {
    try {
      const res = await this.api({
        OrgOrderId: request.paymentId,
        SecureType: 'NonSecure',
        TxnType: 'Refund',
        PurchAmount: bankAmount(request.price),
        Currency: bankCurrencyCode(request.currency, BANK),
      });
      const ok = res.ProcReturnCode === '00';
      return {
        status: ok ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        refundId: ok ? res.HostRefNum || undefined : undefined,
        conversationId: request.conversationId,
        ...(ok ? {} : Qnb.declined(res)),
        rawResponse: res,
      };
    } catch (error) {
      return bankFailure<RefundResponse>(error, BANK, 'QNB refund failed', { conversationId: request.conversationId });
    }
  }

  /** Same-day `Void` of the whole order. `paymentId` is the OrderId. */
  async cancel(request: CancelRequest): Promise<CancelResponse> {
    try {
      const res = await this.api({ OrgOrderId: request.paymentId, SecureType: 'NonSecure', TxnType: 'Void', Currency: TRY_CODE });
      const ok = res.ProcReturnCode === '00';
      return {
        status: ok ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        transactionId: ok ? res.HostRefNum || undefined : undefined,
        conversationId: request.conversationId,
        ...(ok ? {} : Qnb.declined(res)),
        rawResponse: res,
      };
    } catch (error) {
      return bankFailure<CancelResponse>(error, BANK, 'QNB cancel failed', { conversationId: request.conversationId });
    }
  }

  /** `OrderInquiry`: success, cancelled (voided/refunded), failure or pending. */
  async getPayment(paymentId: string): Promise<PaymentResponse> {
    try {
      const res = await this.inquiry(paymentId);
      if (res.ProcReturnCode !== '00') {
        return { status: PaymentStatus.FAILURE, paymentId, conversationId: paymentId, ...Qnb.declined(res), rawResponse: res };
      }
      return { status: mapQnbInquiry(res), paymentId, conversationId: paymentId, rawResponse: res };
    } catch (error) {
      return bankFailure<PaymentResponse>(error, BANK, 'QNB getPayment failed', { paymentId, conversationId: paymentId });
    }
  }
}
