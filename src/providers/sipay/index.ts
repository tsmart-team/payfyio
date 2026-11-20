import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { randomBytes } from 'crypto';
import { PaymentProvider, PaymentProviderConfig } from '../../core/PaymentProvider';
import { formatMinor, toMinor } from '../../core/money';
import {
  PaymentRequest,
  PaymentResponse,
  ThreeDSPaymentRequest,
  ThreeDSInitResponse,
  RefundRequest,
  RefundResponse,
  CancelRequest,
  CancelResponse,
  CaptureRequest,
  CaptureResponse,
  VoidAuthorizationRequest,
  VoidAuthorizationResponse,
  BinCheckResponse,
  InstallmentInfoRequest,
  InstallmentInfoResponse,
  PaymentStatus,
} from '../../types';
import {
  SipayBrand,
  SipayConfig,
  Sipay3DCallbackData,
  SipayPaymentResponse,
  SipayPosOption,
  SipayResponse,
  SipayStatusResponse,
} from './types';
import {
  SIPAY_OK,
  SIPAY_PATHS,
  sipayBasketLines,
  sealSipayHashKey,
  formatSipayAmount,
  getSipayCurrency,
  getSipayInstallment,
  sipayStatusFromCheck,
  hiddenInputs,
  readSipayResultSeal,
  safeEqual,
  sameSipayAmount,
  verifySipay3DCallback,
} from './utils';

export type { SipayConfig, SipayBrand, Sipay3DCallbackData, SipayHashFields } from './types';
export { verifySipay3DCallback } from './utils';

const BRAND_NAMES: Record<SipayBrand, string> = { sipay: 'Sipay', qnbpay: 'QNBpay' };

/** Tokens live 2 hours; renew a bit early. */
const TOKEN_TTL_MS = 100 * 60 * 1000;

/** confirmPayment `status`. */
const CONFIRM = { capture: 1, void: 2 } as const;

/** Token could not be obtained — nothing was sent, so the outcome is a known failure. */
class SipayAuthError extends Error {
  constructor(message: string, readonly response: unknown) {
    super(message);
  }
}

type Failure = { status: PaymentStatus; errorCode?: string; errorMessage?: string; rawResponse?: unknown };

const isOk = (code: unknown) => Number(code) === SIPAY_OK;
const flagSet = (v: unknown) => v === 1 || v === '1' || v === true;
const text = (v: unknown) => (v === undefined || v === null || String(v).trim() === '' ? undefined : String(v));

/** Where Sipay puts the reason, most specific first (bank's ISO 8583 answer before Sipay's own). */
const CODE_KEYS = ['original_bank_error_code', 'error_code', 'status_code'];
const MESSAGE_KEYS = ['original_bank_error_description', 'error', 'status_description', 'message'];

function pickError(...sources: Array<Record<string, unknown> | undefined>) {
  const first = (keys: string[]) => {
    for (const src of sources) for (const k of keys) if (text(src?.[k])) return text(src?.[k]);
    return undefined;
  };
  return { errorCode: first(CODE_KEYS), errorMessage: first(MESSAGE_KEYS) };
}

/**
 * Sipay CCPayment provider. QNBpay runs the identical API on its own hosts, so
 * it is the same class with a different `brand` (see `QnbPay` below).
 *
 * Every call is a JSON POST authorised by a Bearer token that is minted from
 * appId/appSecret and kept until shortly before it expires. Money-moving calls
 * and payment results carry an AES-encrypted `hash_key`; on the way back in,
 * that encrypted value is the only part of a 3D callback we believe.
 *
 * Ids: the Sipay `invoice_id` is our `paymentId` throughout — taken from
 * `conversationId` or generated at init. Pre-auth is `capture: false` on a
 * normal payment request; capture/void go through confirmPayment, card
 * metadata and instalment plans through getpos.
 */
export class Sipay extends PaymentProvider {
  private client: AxiosInstance;
  private appId: string;
  private appSecret: string;
  private merchantKey: string;
  protected brand: SipayBrand;
  private token?: { value: string; expiresAt: number };
  private tokenRequest?: Promise<string>;

  constructor(config: PaymentProviderConfig & SipayConfig) {
    const brand = config.brand ?? 'sipay';
    const name = BRAND_NAMES[brand];
    if (!name) throw new Error(`Unknown Sipay brand: ${config.brand}`);
    if (!config.appId) throw new Error(`${name} appId is required`);
    if (!config.appSecret) throw new Error(`${name} appSecret is required`);
    if (!config.merchantKey) throw new Error(`${name} merchantKey is required`);
    if (!config.baseUrl) throw new Error(`${name} baseUrl is required`);
    super({ ...config, apiKey: config.appId, secretKey: config.appSecret });
    this.brand = brand;
    this.appId = config.appId;
    this.appSecret = config.appSecret;
    this.merchantKey = config.merchantKey;
    this.client = axios.create({
      baseURL: this.config.baseUrl,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    });
    this.setupAxiosLogging(this.client, brand);
    this.setupAxiosRetry(this.client);
  }

  protected validateConfig(): void {
    // Checked in the constructor; apiKey/secretKey are synthesized for the base class.
  }

  private get name(): string {
    return BRAND_NAMES[this.brand];
  }

  private get lang(): 'tr' | 'en' {
    return (this.config.locale || 'tr').toLowerCase().startsWith('en') ? 'en' : 'tr';
  }

  private getToken(renew = false): Promise<string> {
    if (!renew && this.token && this.token.expiresAt > Date.now()) return Promise.resolve(this.token.value);
    // One in-flight token request shared by concurrent callers.
    this.tokenRequest ??= this.requestToken().finally(() => {
      this.tokenRequest = undefined;
    });
    return this.tokenRequest;
  }

  private async requestToken(): Promise<string> {
    let res: AxiosResponse<{ status_description?: string; data?: { token?: string } }>;
    try {
      res = await this.client.post(
        SIPAY_PATHS.token,
        { app_id: this.appId, app_secret: this.appSecret, app_lang: this.lang },
        { validateStatus: (s) => s < 500 },
      );
    } catch (err: any) {
      throw new SipayAuthError(`${this.name} token request failed: ${err?.message ?? 'unknown error'}`, err?.response?.data);
    }
    const value = res.data?.data?.token;
    if (!value) {
      throw new SipayAuthError(
        `${this.name} did not issue a token: ${res.data?.status_description || 'unknown error'}`,
        res.data,
      );
    }
    this.token = { value, expiresAt: Date.now() + TOKEN_TTL_MS };
    return value;
  }

  private static tokenExpired(res: AxiosResponse): boolean {
    if (res.status === 401) return true;
    let data: unknown = res.data;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch {
        return false;
      }
    }
    const d = (data || {}) as SipayResponse;
    return Number(d.status_code) === 101 && /unauthenticated/i.test(String(d.status_description ?? ''));
  }

  /**
   * POST JSON with the Bearer token. A request rejected as unauthenticated was
   * not processed, so it is resent once with a fresh token. Network errors are
   * never resent here (a lost response may mean the charge went through).
   */
  private async call<T>(path: string, body: Record<string, unknown>, asText = false): Promise<T> {
    const send = (token: string) =>
      this.client.post(path, body, {
        headers: { Authorization: `Bearer ${token}` },
        validateStatus: (s) => s < 500,
        ...(asText ? { responseType: 'text' as const, transformResponse: (r: unknown) => r } : {}),
      });
    let res = await send(await this.getToken());
    if (Sipay.tokenExpired(res)) res = await send(await this.getToken(true));
    return res.data as T;
  }

  /**
   * Error result. `moneyCall`: the failing request itself could have moved
   * money — no response there means the outcome is unknown (PENDING).
   */
  private fail(err: any, fallback: string, moneyCall: boolean): Failure {
    if (err instanceof SipayAuthError) {
      return { status: PaymentStatus.FAILURE, errorCode: 'TOKEN_ERROR', errorMessage: err.message, rawResponse: err.response };
    }
    if (moneyCall && axios.isAxiosError(err) && !err.response) {
      return {
        status: PaymentStatus.PENDING,
        errorCode: 'NETWORK_ERROR',
        errorMessage: `No response from ${this.name}; confirm the outcome with getPayment`,
      };
    }
    return { status: PaymentStatus.FAILURE, errorMessage: err?.message || fallback, rawResponse: err?.response?.data };
  }

  private newInvoiceId(): string {
    return `SP${Date.now()}${randomBytes(3).toString('hex')}`;
  }

  private paymentBody(request: PaymentRequest, invoiceId: string, installment?: number): Record<string, unknown> {
    const card = request.paymentCard;
    if (!card?.cardNumber) throw new Error(`${this.name} requires paymentCard`);
    const total = formatSipayAmount(request.paidPrice || request.price);
    const installments = getSipayInstallment(installment);
    const currency = getSipayCurrency(request.currency as string);
    const year = String(card.expireYear);
    const description = `Order ${invoiceId}`;
    return {
      cc_holder_name: card.cardHolderName,
      cc_no: card.cardNumber.replace(/\s/g, ''),
      expiry_month: String(card.expireMonth).padStart(2, '0'),
      expiry_year: year.length === 2 ? `20${year}` : year,
      cvv: card.cvc,
      currency_code: currency,
      installments_number: installments,
      invoice_id: invoiceId,
      invoice_description: description,
      name: request.buyer?.name,
      surname: request.buyer?.surname,
      total,
      merchant_key: this.merchantKey,
      items: sipayBasketLines(request.basketItems, total, description),
      hash_key: sealSipayHashKey([total, installments, currency, this.merchantKey, invoiceId], this.appSecret),
      bill_address1: request.billingAddress?.address,
      bill_city: request.billingAddress?.city,
      bill_postcode: request.billingAddress?.zipCode,
      bill_country: request.billingAddress?.country,
      bill_email: request.buyer?.email,
      bill_phone: request.buyer?.gsmNumber,
      ip: request.buyer?.ip,
      transaction_type: request.capture === false ? 'PreAuth' : 'Auth',
      app_lang: this.lang,
    };
  }

  /** Non-3D sale (paySmart2D). `capture: false` makes it a pre-authorization. */
  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    const invoiceId = request.conversationId || this.newInvoiceId();
    let body: Record<string, unknown>;
    try {
      body = this.paymentBody(request, invoiceId, (request as any).installment);
    } catch (err) {
      return this.fail(err, `${this.name} createPayment failed`, false);
    }
    try {
      const res = await this.call<SipayPaymentResponse>(SIPAY_PATHS.pay2D, body);
      const approved = isOk(res?.status_code) && flagSet(res?.data?.payment_status);
      return {
        status: approved ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        paymentId: invoiceId,
        conversationId: invoiceId,
        ...(approved ? {} : pickError(res?.data, res)),
        rawResponse: res,
      };
    } catch (err) {
      return { ...this.fail(err, `${this.name} createPayment failed`, true), paymentId: invoiceId, conversationId: invoiceId };
    }
  }

  /**
   * 3D Secure sale (paySmart3D). Sipay answers with its 3D page; the result is
   * POSTed to `callbackUrl` (used as both return_url and cancel_url). The total
   * signed into the request is `paidPrice`. `capture: false` → pre-authorization.
   */
  async initThreeDSPayment(request: ThreeDSPaymentRequest): Promise<ThreeDSInitResponse> {
    const invoiceId = request.conversationId || this.newInvoiceId();
    try {
      if (!request.callbackUrl) throw new Error('callbackUrl is required for 3D Secure');
      const body = {
        ...this.paymentBody(request, invoiceId, request.installment),
        return_url: request.callbackUrl,
        cancel_url: request.callbackUrl,
        response_method: 'POST',
      };
      const res = await this.call<unknown>(SIPAY_PATHS.pay3D, body, true);
      const html = typeof res === 'string' ? res : JSON.stringify(res ?? '');
      const rejection = this.paySmart3DError(html);
      if (rejection) {
        return { status: PaymentStatus.FAILURE, paymentId: invoiceId, conversationId: invoiceId, ...pickError(rejection), rawResponse: rejection };
      }
      return { status: PaymentStatus.PENDING, threeDSHtmlContent: html, paymentId: invoiceId, conversationId: invoiceId };
    } catch (err) {
      // No charge happens before the shopper completes 3D, so a lost response is a plain failure.
      return { ...this.fail(err, `${this.name} 3DS init failed`, false), paymentId: invoiceId, conversationId: invoiceId };
    }
  }

  /**
   * paySmart3D answers with the bank's 3D form on success. A rejection comes
   * back as JSON, or as a form that would post a non-100 status to cancel_url.
   */
  private paySmart3DError(body: string): Record<string, unknown> | undefined {
    const t = body.trim();
    if (t.startsWith('{')) {
      let parsed: SipayPaymentResponse | undefined;
      try {
        parsed = JSON.parse(t);
      } catch {
        // handled below
      }
      return parsed ? { ...parsed, ...(parsed.data ?? {}) } : { status_description: 'paySmart3D sent unparseable JSON' };
    }
    const fields = hiddenInputs(t);
    const badStatus = fields.status_code !== undefined && !isOk(fields.status_code);
    if (badStatus || fields.sipay_status === '0' || fields.payment_status === '0') return fields;
    // Empty body or no form at all: nothing the shopper could be sent to.
    return /<form\b/i.test(t) ? undefined : { status_description: 'paySmart3D returned no 3D Secure form' };
  }

  /**
   * Complete a 3D Secure payment from the fields Sipay POSTs to the callback.
   *
   * Only the encrypted `hash_key` is trusted (`status|total|invoice_id|order_id|currency`):
   * it is decrypted *before* any status field is looked at, and the posted
   * invoice/order ids must match it. The result comes from the signed status.
   *
   * @param callbackData the posted form body, plus optional values from your
   *   order record: `orderId` (= init `paymentId` = invoice id) and `amount`
   *   (decimal order total; compared with the signed total in minor units).
   *   Sipay itself posts an unsigned `amount` — overwrite it with your value.
   */
  async completeThreeDSPayment(callbackData: Sipay3DCallbackData): Promise<PaymentResponse> {
    const data: Record<string, unknown> = callbackData && typeof callbackData === 'object' ? callbackData : {};
    const signed = verifySipay3DCallback(data, this.appSecret) ? readSipayResultSeal(data.hash_key, this.appSecret) : undefined;
    if (!signed) {
      this.emitSecurityEvent('callback_verification_failed', `${this.name} 3D callback failed hash_key verification`, {
        severity: 'critical',
      });
      return {
        status: PaymentStatus.FAILURE,
        errorCode: 'INVALID_HASH',
        errorMessage: `${this.name} hash_key is missing, invalid or does not match the callback`,
        rawResponse: callbackData,
      };
    }
    if (data.orderId !== undefined && !safeEqual(String(data.orderId), signed.invoiceId)) {
      return { status: PaymentStatus.FAILURE, errorCode: 'ORDER_MISMATCH', errorMessage: 'Callback invoice_id does not match the order', rawResponse: callbackData };
    }

    const ids = { paymentId: signed.invoiceId, conversationId: signed.invoiceId };
    const raw = { ...data, verified: signed };
    // Signed decline first, so a real decline keeps the bank's code.
    if (signed.status !== '1') {
      const e = pickError(data);
      return { status: PaymentStatus.FAILURE, ...ids, errorCode: e.errorCode, errorMessage: e.errorMessage || '3D Secure payment failed', rawResponse: raw };
    }
    if (data.amount !== undefined && !sameSipayAmount(data.amount, signed.total, signed.currency || 'TRY')) {
      return { status: PaymentStatus.FAILURE, errorCode: 'AMOUNT_MISMATCH', errorMessage: 'Signed total does not match the order amount', rawResponse: raw };
    }
    // hash_key is AES-CBC without a MAC and its IV travels in the POST: a
    // flipped IV byte turns a signed decline ("0|…") into "1|…". It proves
    // nothing about the outcome, so the bank's own record decides.
    let check: SipayStatusResponse;
    try {
      check = await this.queryStatus(signed.invoiceId);
    } catch (err) {
      const f = this.fail(err, `${this.name} status check failed`, true);
      return { ...f, ...(f.status === PaymentStatus.PENDING ? ids : {}), rawResponse: raw };
    }
    const checked = sipayStatusFromCheck(check.transaction_status);
    if (checked === PaymentStatus.PENDING) {
      // Still settling at Sipay: outcome unknown, not a failure.
      return { status: PaymentStatus.PENDING, ...ids, errorCode: 'NOT_SETTLED', rawResponse: { ...raw, check } };
    }
    const confirmed =
      checked === PaymentStatus.SUCCESS &&
      (data.amount === undefined ||
        check.transaction_amount === undefined ||
        sameSipayAmount(check.transaction_amount, String(data.amount), signed.currency || 'TRY'));
    if (!confirmed) {
      return {
        status: PaymentStatus.FAILURE,
        errorCode: 'NOT_CONFIRMED',
        errorMessage: `${this.name} does not report this invoice as paid for the order amount`,
        rawResponse: { ...raw, check },
      };
    }
    return { status: PaymentStatus.SUCCESS, ...ids, rawResponse: { ...raw, check } };
  }

  private async queryStatus(invoiceId: string): Promise<SipayStatusResponse> {
    const res = await this.call<SipayStatusResponse>(SIPAY_PATHS.status, {
      merchant_key: this.merchantKey,
      invoice_id: invoiceId,
      include_pending_status: true,
      hash_key: sealSipayHashKey([invoiceId, this.merchantKey], this.appSecret),
      app_lang: this.lang,
    });
    return res ?? {};
  }

  /** Payment status (checkstatus); `paymentId` is the invoice id. */
  async getPayment(paymentId: string): Promise<PaymentResponse> {
    try {
      const res = await this.queryStatus(paymentId);
      const status = sipayStatusFromCheck(res.transaction_status);
      return {
        status,
        paymentId,
        conversationId: paymentId,
        ...(status === PaymentStatus.FAILURE ? pickError(res) : {}),
        rawResponse: res,
      };
    } catch (err) {
      return { ...this.fail(err, `${this.name} getPayment failed`, false), paymentId };
    }
  }

  private refundCall(invoiceId: string, amount: string): Promise<SipayResponse> {
    return this.call<SipayResponse>(SIPAY_PATHS.refund, {
      invoice_id: invoiceId,
      amount,
      merchant_key: this.merchantKey,
      hash_key: sealSipayHashKey([amount, invoiceId, this.merchantKey], this.appSecret),
      app_lang: this.lang,
    });
  }

  /** Full or partial refund; Sipay turns a same-day refund into a void itself. */
  async refund(request: RefundRequest): Promise<RefundResponse> {
    let amount: string;
    try {
      amount = formatSipayAmount(request.price);
    } catch (err) {
      return { ...this.fail(err, `${this.name} refund failed`, false), conversationId: request.conversationId };
    }
    try {
      const res = (await this.refundCall(request.paymentId, amount)) ?? {};
      const ok = isOk(res.status_code);
      return {
        status: ok ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        refundId: ok ? (text(res.ref_no) ?? text(res.ref_number) ?? request.paymentId) : undefined,
        conversationId: request.conversationId,
        ...(ok ? {} : pickError(res)),
        rawResponse: res,
      };
    } catch (err) {
      return { ...this.fail(err, `${this.name} refund failed`, true), conversationId: request.conversationId };
    }
  }

  private static isHeldAuth(s: SipayStatusResponse): boolean {
    return (s.transaction_status || '').trim().toLowerCase() === 'pre-authorization';
  }

  /** Amount still refundable (transaction amount minus refunds), or undefined. */
  private static refundableAmount(s: SipayStatusResponse): string | undefined {
    const amount = Number(s.transaction_amount ?? s.product_price);
    if (!isFinite(amount) || amount <= 0) return undefined;
    const left = toMinor(amount, 'TRY') - toMinor(Number(s.total_refunded_amount ?? 0) || 0, 'TRY');
    return left > 0 ? formatMinor(left, 'TRY') : undefined;
  }

  private confirmCall(invoiceId: string, status: number, total: string): Promise<SipayResponse> {
    return this.call<SipayResponse>(SIPAY_PATHS.confirm, {
      invoice_id: invoiceId,
      merchant_key: this.merchantKey,
      status,
      total: Number(total),
      hash_key: sealSipayHashKey([this.merchantKey, invoiceId, status], this.appSecret),
      app_lang: this.lang,
    });
  }

  /**
   * Cancel a payment: releases it if it is an open pre-authorization,
   * otherwise refunds whatever is still refundable (a void on the same day).
   */
  async cancel(request: CancelRequest): Promise<CancelResponse> {
    const conversationId = request.conversationId;
    let payment: SipayStatusResponse;
    try {
      payment = await this.queryStatus(request.paymentId);
    } catch (err) {
      return { ...this.fail(err, `${this.name} cancel failed`, false), conversationId };
    }
    const preAuth = Sipay.isHeldAuth(payment);
    const amount = Sipay.refundableAmount(payment);
    if (!amount || sipayStatusFromCheck(payment.transaction_status) !== PaymentStatus.SUCCESS) {
      return {
        status: PaymentStatus.FAILURE,
        conversationId,
        errorCode: isOk(payment.status_code) ? 'NOT_CANCELLABLE' : pickError(payment).errorCode,
        errorMessage: `${this.name} payment ${request.paymentId} is ${payment.transaction_status || 'not cancellable'}`,
        rawResponse: payment,
      };
    }
    try {
      const res = (preAuth
        ? await this.confirmCall(request.paymentId, CONFIRM.void, amount)
        : await this.refundCall(request.paymentId, amount)) ?? {};
      const ok = isOk(res.status_code);
      return {
        status: ok ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        voidId: ok ? (text(res.ref_no) ?? text(res.ref_number) ?? request.paymentId) : undefined,
        conversationId,
        ...(ok ? {} : pickError(res)),
        rawResponse: res,
      };
    } catch (err) {
      return { ...this.fail(err, `${this.name} cancel failed`, true), conversationId };
    }
  }

  /**
   * Charge all or part of a pre-authorization (confirmPayment, status 1).
   * Without `amountMinor` the full authorized amount is captured.
   */
  async capturePayment(request: CaptureRequest): Promise<CaptureResponse> {
    const ids = { paymentId: request.paymentId, conversationId: request.conversationId };
    let currency: string;
    let total: string;
    try {
      currency = getSipayCurrency(request.currency as string);
      if (request.amountMinor !== undefined) {
        if (!Number.isInteger(request.amountMinor) || request.amountMinor <= 0) {
          throw new Error('amountMinor must be a positive integer');
        }
        total = formatMinor(request.amountMinor, currency);
      } else {
        const payment = await this.queryStatus(request.paymentId);
        const authorized = Sipay.isHeldAuth(payment) ? Sipay.refundableAmount(payment) : undefined;
        if (!authorized) {
          return { status: PaymentStatus.FAILURE, ...ids, errorCode: 'NOT_CAPTURABLE', errorMessage: `${this.name} payment ${request.paymentId} is not an open pre-authorization`, rawResponse: payment };
        }
        total = authorized;
      }
    } catch (err) {
      return { ...this.fail(err, `${this.name} capture failed`, false), ...ids };
    }
    try {
      const res = (await this.confirmCall(request.paymentId, CONFIRM.capture, total)) ?? {};
      const ok = isOk(res.status_code);
      return {
        status: ok ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        ...ids,
        ...(ok ? { capturedAmountMinor: toMinor(total, currency), currency } : pickError(res)),
        rawResponse: res,
      };
    } catch (err) {
      return { ...this.fail(err, `${this.name} capture failed`, true), ...ids };
    }
  }

  /** Release an open pre-authorization (confirmPayment, status 2). */
  async voidAuthorization(request: VoidAuthorizationRequest): Promise<VoidAuthorizationResponse> {
    const ids = { paymentId: request.paymentId, conversationId: request.conversationId };
    let payment: SipayStatusResponse;
    try {
      payment = await this.queryStatus(request.paymentId);
    } catch (err) {
      return { ...this.fail(err, `${this.name} void failed`, false), ...ids };
    }
    const amount = Sipay.isHeldAuth(payment) ? Sipay.refundableAmount(payment) : undefined;
    if (!amount) {
      return { status: PaymentStatus.FAILURE, ...ids, errorCode: 'NOT_VOIDABLE', errorMessage: `${this.name} payment ${request.paymentId} is not an open pre-authorization`, rawResponse: payment };
    }
    try {
      const res = (await this.confirmCall(request.paymentId, CONFIRM.void, amount)) ?? {};
      const ok = isOk(res.status_code);
      return {
        status: ok ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        ...ids,
        ...(ok ? { voidId: request.paymentId } : pickError(res)),
        rawResponse: res,
      };
    } catch (err) {
      return { ...this.fail(err, `${this.name} void failed`, true), ...ids };
    }
  }

  private async fetchPosOptions(binNumber: string, amount: number): Promise<SipayPosOption[]> {
    const bin = String(binNumber ?? '').replace(/\s/g, '');
    if (!/^\d{6,8}$/.test(bin)) throw new Error('binNumber must be the first 6-8 digits of the card');
    const res = await this.call<SipayResponse & { data?: SipayPosOption[] }>(SIPAY_PATHS.pos, {
      credit_card: bin,
      amount,
      currency_code: 'TRY',
      merchant_key: this.merchantKey,
      app_lang: this.lang,
    });
    if (!isOk(res?.status_code) || !Array.isArray(res.data) || !res.data.length) {
      throw new Error(`${this.name} getpos failed: ${res?.status_description || 'no installment options'}`);
    }
    return res.data;
  }

  /** Card facts shared by binCheck and installmentInfo, read from the first getpos row. */
  private static cardFacts(rows: SipayPosOption[]) {
    const row = rows[0];
    return {
      cardType: row.card_type || '',
      cardAssociation: (row.card_scheme || '').toUpperCase(),
      family: row.card_program || '',
      bankName: row.card_bank || '',
      bankCode: Number(row.bank_code) || 0,
      commercial: /^true$/i.test(String(row.is_commercial)),
    };
  }

  /** BIN lookup via getpos (probed with a 1 TRY amount). Throws on failure. */
  async binCheck(binNumber: string): Promise<BinCheckResponse> {
    const rows = await this.fetchPosOptions(binNumber, 1);
    const { family, ...facts } = Sipay.cardFacts(rows);
    return { binNumber, ...facts, cardFamily: family, rawResponse: rows };
  }

  /** Instalment plans via getpos; totals are what Sipay says the shopper pays for each count. */
  async installmentInfo(request: InstallmentInfoRequest): Promise<InstallmentInfoResponse> {
    try {
      const baseMinor = toMinor(request.price, 'TRY');
      if (baseMinor <= 0) throw new Error('price must be greater than 0');
      const rows = await this.fetchPosOptions(request.binNumber, baseMinor / 100);
      const plans = new Map<number, number>();
      for (const row of rows) {
        const count = Number(row.installments_number) || 1;
        plans.set(count, toMinor(row.amount_to_be_paid ?? row.payable_amount ?? baseMinor / 100, 'TRY'));
      }
      const installmentPrices = [...plans.entries()]
        .sort(([a], [b]) => a - b)
        .map(([count, totalMinor]) => ({
          installmentNumber: count,
          totalPrice: totalMinor / 100,
          installmentPrice: Math.round(totalMinor / count) / 100,
        }));
      const { family, commercial, ...facts } = Sipay.cardFacts(rows);
      return {
        status: PaymentStatus.SUCCESS,
        installmentDetails: [
          {
            binNumber: request.binNumber,
            price: baseMinor / 100,
            ...facts,
            cardFamilyName: family,
            commercial: commercial ? 1 : 0,
            installmentPrices,
          },
        ],
        conversationId: request.conversationId,
        rawResponse: rows,
      };
    } catch (err) {
      return { ...this.fail(err, `${this.name} installmentInfo failed`, false), conversationId: request.conversationId };
    }
  }
}

/** QNBpay — Sipay's CCPayment platform on QNBpay hosts (`baseUrl` from config). */
export class QnbPay extends Sipay {
  constructor(config: PaymentProviderConfig & Omit<SipayConfig, 'brand'>) {
    super({ ...config, brand: 'qnbpay' });
  }
}
