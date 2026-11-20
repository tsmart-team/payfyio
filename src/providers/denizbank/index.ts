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
import { DenizbankConfig, Denizbank3DCallbackData } from './types';
import {
  DENIZBANK_PATH,
  bankAmount,
  bankCurrencyCode,
  bankExpiry,
  bankFailure,
  buildBankFormHtml,
  denizbankCardType,
  denizbankFormHash,
  denizbankInstallment,
  field,
  parseDenizbankResponse,
  sameAmount,
  verifyDenizbank3DCallback,
} from './utils';

export type { DenizbankConfig, Denizbank3DCallbackData } from './types';
export { verifyDenizbank3DCallback } from './utils';

const BANK = 'Denizbank';

/**
 * Denizbank InterVPos provider.
 *
 * - `createPayment`: `Auth`, SecureType `NonSecure`
 * - `initThreeDSPayment`: signed auto-submitting form, SecureType `3DModel`
 * - `completeThreeDSPayment`: verifies the callback HASH, then charges with
 *   `Auth` carrying the 3D data and the merchant's own amount
 * - `refund` (`Refund`), `cancel` (`Void`)
 * - `getPayment`: not supported (InterVPos status query is not implemented)
 *
 * `paymentId` is the OrderId: your `conversationId`, or a generated one.
 */
export class Denizbank extends PaymentProvider {
  private client: AxiosInstance;
  private shopCode: string;
  private userCode: string;
  private userPass: string;
  private merchantPass: string;

  constructor(config: PaymentProviderConfig & DenizbankConfig) {
    if (!config.shopCode) throw new Error('Denizbank shopCode is required');
    if (!config.userCode) throw new Error('Denizbank userCode is required');
    if (!config.userPass) throw new Error('Denizbank userPass is required');
    if (!config.merchantPass) throw new Error('Denizbank merchantPass is required');
    // Without it the 3D form would post the card to a relative URL on the merchant's own site.
    if (!config.baseUrl) throw new Error('Denizbank baseUrl is required');
    super({ ...config, apiKey: config.shopCode, secretKey: config.merchantPass });
    this.shopCode = config.shopCode;
    this.userCode = config.userCode;
    this.userPass = config.userPass;
    this.merchantPass = config.merchantPass;
    this.client = axios.create({
      baseURL: this.config.baseUrl,
      timeout: 30000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      responseType: 'text',
    });
    this.setupAxiosLogging(this.client, 'denizbank');
    this.setupAxiosSecurity(this.client, 'denizbank');
    this.setupAxiosRetry(this.client);
  }

  protected validateConfig(): void {
    // Checked in the constructor; apiKey/secretKey are synthesized for the base class.
  }

  private get lang(): string {
    return (this.config.locale || 'tr').toLowerCase().startsWith('en') ? 'EN' : 'TR';
  }

  private async api(fields: Record<string, string>): Promise<Record<string, string>> {
    const body = new URLSearchParams({
      ShopCode: this.shopCode,
      UserCode: this.userCode,
      UserPass: this.userPass,
      ...fields,
      Lang: this.lang,
    });
    const res = await this.client.post(DENIZBANK_PATH, body.toString());
    return parseDenizbankResponse(res.data);
  }

  private static declined(res: Record<string, string>) {
    return {
      errorCode: res.ProcReturnCode || undefined,
      errorMessage: res.ErrorMessage || res.ErrMsg || undefined,
    };
  }

  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    const orderId = request.conversationId || `DNZ-${Date.now()}`;
    try {
      const card = request.paymentCard;
      if (!card?.cardNumber) throw new Error('paymentCard is required');
      const pan = card.cardNumber.replace(/\s/g, '');
      const res = await this.api({
        TxnType: 'Auth',
        SecureType: 'NonSecure',
        OrderId: orderId,
        PurchAmount: bankAmount(request.paidPrice || request.price),
        Currency: bankCurrencyCode(request.currency, BANK),
        InstallmentCount: denizbankInstallment((request as Partial<ThreeDSPaymentRequest>).installment),
        CardType: denizbankCardType(pan),
        Pan: pan,
        Expiry: bankExpiry(card.expireMonth, card.expireYear),
        Cvv2: card.cvc,
        MOTO: '0',
      });
      const ok = res.ProcReturnCode === '00';
      return {
        status: ok ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        paymentId: orderId,
        conversationId: orderId,
        ...(ok ? {} : Denizbank.declined(res)),
        rawResponse: res,
      };
    } catch (error) {
      return bankFailure<PaymentResponse>(error, BANK, 'Denizbank payment failed', {
        paymentId: orderId,
        conversationId: orderId,
      });
    }
  }

  /**
   * 3D Model form. Signed with the store key; the API password is not in it.
   * Pass `failUrl` to split the bank's success/failure posts (default: callbackUrl).
   */
  async initThreeDSPayment(request: ThreeDSPaymentRequest & { failUrl?: string }): Promise<ThreeDSInitResponse> {
    const orderId = request.conversationId || `DNZ-${Date.now()}`;
    try {
      const card = request.paymentCard;
      if (!request.callbackUrl) throw new Error('callbackUrl is required for 3D Secure');
      if (!card?.cardNumber) throw new Error('paymentCard is required');
      const pan = card.cardNumber.replace(/\s/g, '');
      const fields: Record<string, string> = {
        Version3D: '2.0',
        ShopCode: this.shopCode,
        TxnType: 'Auth',
        SecureType: '3DModel',
        OrderId: orderId,
        PurchAmount: bankAmount(request.paidPrice || request.price),
        Currency: bankCurrencyCode(request.currency, BANK),
        InstallmentCount: denizbankInstallment(request.installment),
        OkUrl: request.callbackUrl,
        FailUrl: request.failUrl || request.callbackUrl,
        Rnd: randomBytes(16).toString('hex'),
        Lang: this.lang,
        CardType: denizbankCardType(pan),
        Pan: pan,
        Expiry: bankExpiry(card.expireMonth, card.expireYear),
        Cvv2: card.cvc,
      };
      fields.Hash = denizbankFormHash({
        shopCode: this.shopCode,
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
        threeDSHtmlContent: buildBankFormHtml(`${this.config.baseUrl}${DENIZBANK_PATH}`, fields),
        paymentId: orderId,
        conversationId: orderId,
      };
    } catch (error) {
      return bankFailure<ThreeDSInitResponse>(error, BANK, 'Denizbank 3DS init failed', {
        paymentId: orderId,
        conversationId: orderId,
      });
    }
  }

  /**
   * Completes a 3D Model payment from the OkUrl/FailUrl POST.
   *
   * Order: HASH is verified first (nothing else is read before that), then the
   * shop and order are matched, then 3DStatus, then the card is charged with
   * `Auth` + the 3D data. The charge amount is `callbackData.amount` — the
   * order total from YOUR records, required: the callback's HASHPARAMS list
   * is unsigned and its values are joined without separators, so a signed
   * PurchAmount can still be re-cut by a forger. A posted PurchAmount/Currency
   * that disagrees with your record is rejected before the bank is called.
   *
   * @param callbackData the parsed form body, plus `amount` (required),
   *   `currency` (default 'TRY') and `orderId` (optional) from your order record
   */
  async completeThreeDSPayment(callbackData: Denizbank3DCallbackData): Promise<PaymentResponse> {
    const data: Record<string, unknown> = callbackData && typeof callbackData === 'object' ? callbackData : {};

    if (!verifyDenizbank3DCallback(data, this.merchantPass)) {
      this.emitSecurityEvent('callback_verification_failed', 'Denizbank 3D callback failed hash verification', {
        severity: 'critical',
      });
      return { status: PaymentStatus.FAILURE, errorCode: 'INVALID_HASH', errorMessage: 'Invalid 3D Secure callback hash', rawResponse: callbackData };
    }
    const orderId = field(data, 'OrderId')!;
    const shop = field(data, 'ShopCode');
    if (shop !== undefined && shop !== this.shopCode) {
      return { status: PaymentStatus.FAILURE, errorCode: 'INVALID_HASH', errorMessage: 'Callback belongs to another shop', rawResponse: callbackData };
    }
    if (data.orderId !== undefined && data.orderId !== orderId) {
      return { status: PaymentStatus.FAILURE, errorCode: 'ORDER_MISMATCH', errorMessage: 'Callback OrderId does not match the order', rawResponse: callbackData };
    }

    const ids = { paymentId: orderId, conversationId: orderId };
    const fail = (errorCode: string, errorMessage: string, rawResponse: unknown = callbackData): PaymentResponse => ({
      status: PaymentStatus.FAILURE,
      ...ids,
      errorCode,
      errorMessage,
      rawResponse,
    });

    const md = field(data, 'MD');
    if (field(data, '3DStatus') !== '1' || !md) {
      return fail(
        field(data, 'ProcReturnCode') || `3D_STATUS_${field(data, '3DStatus') ?? ''}`,
        field(data, 'ErrorMessage') || '3D Secure authentication failed',
      );
    }

    let amount: string;
    let currency: string;
    try {
      const recorded = data.amount;
      if (typeof recorded !== 'string' && typeof recorded !== 'number') {
        return fail('AMOUNT_REQUIRED', 'callbackData.amount (the order total from your records) is required');
      }
      amount = bankAmount(recorded);
      currency = bankCurrencyCode(typeof data.currency === 'string' ? data.currency : undefined, BANK);
    } catch (error) {
      return fail('INVALID_REQUEST', (error as Error).message);
    }
    const postedAmount = field(data, 'PurchAmount');
    if (postedAmount !== undefined && !sameAmount(postedAmount, amount)) {
      return fail('AMOUNT_MISMATCH', 'Callback amount does not match the order');
    }
    const postedCurrency = field(data, 'Currency');
    if (postedCurrency !== undefined && postedCurrency !== currency) {
      return fail('CURRENCY_MISMATCH', 'Callback currency does not match the order');
    }
    // The merchant's own count wins: InstallmentCount can be left out of the signed list.
    const own = (data as { installment?: unknown }).installment;
    const installment = own !== undefined ? denizbankInstallment(Number(own)) : field(data, 'InstallmentCount') ?? '';

    try {
      const res = await this.api({
        TxnType: 'Auth',
        SecureType: 'NonSecure',
        OrderId: orderId,
        PurchAmount: amount,
        Currency: currency,
        InstallmentCount: /^\d{0,2}$/.test(installment) ? installment : '',
        MD: md,
        PayerTxnId: field(data, 'PayerTxnId') ?? '',
        Eci: field(data, 'Eci') ?? '',
        PayerAuthenticationCode: field(data, 'PayerAuthenticationCode') ?? '',
        MOTO: '0',
      });
      if (res.ProcReturnCode !== '00') {
        return { status: PaymentStatus.FAILURE, ...ids, ...Denizbank.declined(res), rawResponse: { callback: callbackData, payment: res } };
      }
      return { status: PaymentStatus.SUCCESS, ...ids, rawResponse: { callback: callbackData, payment: res } };
    } catch (error) {
      return bankFailure<PaymentResponse>(error, BANK, 'Denizbank 3DS completion failed', ids);
    }
  }

  /** `Refund`; a lower amount is a partial refund. `paymentId` is the OrderId. */
  async refund(request: RefundRequest): Promise<RefundResponse> {
    try {
      const res = await this.api({
        TxnType: 'Refund',
        SecureType: 'NonSecure',
        orgOrderId: request.paymentId,
        PurchAmount: bankAmount(request.price),
        Currency: bankCurrencyCode(request.currency, BANK),
        MOTO: '0',
      });
      const ok = res.ProcReturnCode === '00';
      return {
        status: ok ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        refundId: ok ? res.TransId || res.HostRefNum || undefined : undefined,
        conversationId: request.conversationId,
        ...(ok ? {} : Denizbank.declined(res)),
        rawResponse: res,
      };
    } catch (error) {
      return bankFailure<RefundResponse>(error, BANK, 'Denizbank refund failed', {
        conversationId: request.conversationId,
      });
    }
  }

  /** Same-day `Void` of the whole order. `paymentId` is the OrderId. */
  async cancel(request: CancelRequest): Promise<CancelResponse> {
    try {
      const res = await this.api({ TxnType: 'Void', SecureType: 'NonSecure', orgOrderId: request.paymentId });
      const ok = res.ProcReturnCode === '00';
      return {
        status: ok ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        transactionId: ok ? res.TransId || res.HostRefNum || undefined : undefined,
        conversationId: request.conversationId,
        ...(ok ? {} : Denizbank.declined(res)),
        rawResponse: res,
      };
    } catch (error) {
      return bankFailure<CancelResponse>(error, BANK, 'Denizbank cancel failed', {
        conversationId: request.conversationId,
      });
    }
  }

  /**
   * Not supported: the InterVPos status query is not implemented. Reconcile a
   * PENDING/NETWORK_ERROR result from the merchant panel.
   */
  async getPayment(_paymentId: string): Promise<PaymentResponse> {
    throw new Error('getPayment is not supported by the Denizbank provider (no InterVPos status query yet)');
  }
}
