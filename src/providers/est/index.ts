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
import { EstConfig, EstStoreType, EstXmlResult } from './types';
import {
  EST_STORE_TYPES,
  XmlNode,
  buildCC5Request,
  buildEstHashV3,
  buildRedirectFormHtml,
  formatEstAmount,
  formatEstInstallment,
  getEstCurrency,
  isApproved,
  isHostedStoreType,
  isMerchantCharged,
  parseCC5Response,
  randomNonce,
  verifyEst3DCallback,
} from './utils';

export type { EstConfig, EstStoreType } from './types';
export { verifyEst3DCallback } from './utils';

const API_PATH = '/fim/api';
const GATE_PATH = '/fim/est3Dgate';

/**
 * EST (Asseco NestPay) virtual POS — the platform behind İş Bankası, Ziraat,
 * Halkbank, TEB and Şekerbank. One class; `baseUrl` picks the bank.
 *
 * `paymentId` is the order id (`oid`): the `conversationId` you pass, or a
 * generated one. Refund/cancel/getPayment take that id.
 */
export class Est extends PaymentProvider {
  private client: AxiosInstance;
  private clientId: string;
  private username: string;
  private password: string;
  private storeKey: string;
  private storeType: EstStoreType;
  private acceptedMdStatuses: string[];

  constructor(config: PaymentProviderConfig & EstConfig) {
    if (!config.clientId) throw new Error('EST clientId is required');
    if (!config.username) throw new Error('EST username is required');
    if (!config.password) throw new Error('EST password is required');
    if (!config.storeKey) throw new Error('EST storeKey is required');
    const storeType = config.storeType ?? '3d';
    if (!EST_STORE_TYPES.includes(storeType)) throw new Error(`Unknown EST storeType: ${storeType}`);
    super({ ...config, apiKey: config.clientId, secretKey: config.storeKey });
    this.clientId = config.clientId;
    this.username = config.username;
    this.password = config.password;
    this.storeKey = config.storeKey;
    this.storeType = storeType;
    this.acceptedMdStatuses = config.acceptedMdStatuses ?? ['1'];
    this.client = axios.create({
      baseURL: this.config.baseUrl,
      timeout: 30000,
      headers: { 'Content-Type': 'text/xml; charset=ISO-8859-9' },
      responseType: 'text',
    });
    this.setupAxiosLogging(this.client, config.providerName || 'est');
    this.setupAxiosRetry(this.client);
  }

  protected validateConfig(): void {
    // Validated in the constructor; apiKey/secretKey are synthesized.
  }

  private async api(payload: Record<string, XmlNode>): Promise<EstXmlResult> {
    const res = await this.client.post<string>(
      API_PATH,
      buildCC5Request({
        Name: this.username,
        Password: this.password,
        ClientId: this.clientId,
        ...payload,
      }),
    );
    return parseCC5Response(res.data);
  }

  private orderStatus(orderId: string): Promise<EstXmlResult> {
    return this.api({ OrderId: orderId, Mode: 'P', Extra: { ORDERSTATUS: 'SOR' } });
  }

  private static declined(fields: Record<string, string | undefined>) {
    return {
      errorCode: fields.ProcReturnCode || undefined,
      errorMessage: fields.ErrMsg || fields.mdErrorMsg || undefined,
    };
  }

  /**
   * No response at all → the bank may have processed it: PENDING, confirm
   * with getPayment. Anything else is a FAILURE. Never returns the axios
   * error (its config carries the API password).
   */
  private static failed(err: any, fallback: string, ids: { paymentId?: string; conversationId?: string } = {}) {
    if (axios.isAxiosError(err) && !err.response) {
      return {
        status: PaymentStatus.PENDING,
        ...ids,
        errorCode: 'NETWORK_ERROR',
        errorMessage: 'No response from the bank; the outcome is unknown — check with getPayment',
      };
    }
    return {
      status: PaymentStatus.FAILURE,
      ...ids,
      errorMessage: err?.message || fallback,
      rawResponse: err?.response?.data,
    };
  }

  /** Non-3D sale (XML `Auth`). */
  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    const orderId = request.conversationId || `EST-${Date.now()}`;
    try {
      const card = request.paymentCard;
      const { fields } = await this.api({
        Type: 'Auth',
        OrderId: orderId,
        Total: formatEstAmount(request.price),
        Currency: getEstCurrency(request.currency as string),
        Taksit: formatEstInstallment((request as PaymentRequest & { installment?: number }).installment),
        Number: card.cardNumber.replace(/\s/g, ''),
        Expires: `${String(card.expireMonth).padStart(2, '0')}/${String(card.expireYear).slice(-2)}`,
        Cvv2Val: card.cvc,
        Mode: 'P',
        IPAddress: request.buyer?.ip,
        Email: request.buyer?.email,
        BillTo: { Name: card.cardHolderName },
      });
      const ok = isApproved(fields);
      return {
        status: ok ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        paymentId: orderId,
        conversationId: orderId,
        ...(ok ? {} : Est.declined(fields)),
        rawResponse: fields,
      };
    } catch (err) {
      return Est.failed(err, 'EST createPayment failed', { paymentId: orderId, conversationId: orderId });
    }
  }

  /**
   * Self-submitting form to `/fim/est3Dgate`, signed with hash ver3. The
   * hash covers amount/currency/oid, so the bank only accepts the amount
   * signed here. Hosted store types (`3d_pay_hosting`, `3d_host`) get no
   * card fields — the bank asks the customer on its own page.
   */
  async initThreeDSPayment(request: ThreeDSPaymentRequest): Promise<ThreeDSInitResponse> {
    const orderId = request.conversationId || `EST-${Date.now()}`;
    try {
      if (!request.callbackUrl) throw new Error('callbackUrl is required for EST 3D Secure');
      const fields: Record<string, string> = {
        clientid: this.clientId,
        storetype: this.storeType,
        TranType: 'Auth',
        amount: formatEstAmount(request.price),
        currency: getEstCurrency(request.currency as string),
        oid: orderId,
        okUrl: request.callbackUrl,
        failUrl: request.callbackUrl,
        taksit: formatEstInstallment(request.installment),
        rnd: randomNonce(),
        lang: (this.config.locale || 'tr').toLowerCase().startsWith('en') ? 'en' : 'tr',
        hashAlgorithm: 'ver3',
        refreshTime: '0',
      };
      if (request.buyer?.email) fields.Email = request.buyer.email;
      if (!isHostedStoreType(this.storeType)) {
        const card = request.paymentCard;
        if (!card?.cardNumber) throw new Error(`paymentCard is required for storeType ${this.storeType}`);
        // The cardholder name is left out: non-ASCII letters would make the
        // UTF-8 hash differ from the bank's ISO-8859-9 one.
        Object.assign(fields, {
          pan: card.cardNumber.replace(/\s/g, ''),
          Ecom_Payment_Card_ExpDate_Month: String(card.expireMonth).padStart(2, '0'),
          Ecom_Payment_Card_ExpDate_Year: String(card.expireYear).slice(-2),
          cv2: card.cvc,
        });
      }
      fields.hash = buildEstHashV3(fields, this.storeKey);
      return {
        status: PaymentStatus.PENDING,
        threeDSHtmlContent: buildRedirectFormHtml(`${this.config.baseUrl}${GATE_PATH}`, fields),
        paymentId: orderId,
        conversationId: orderId,
      };
    } catch (err: any) {
      return { status: PaymentStatus.FAILURE, errorMessage: err?.message || 'EST 3DS init failed' };
    }
  }

  /**
   * Complete after the bank's POST to the callback URL.
   *
   * Pass the bank's POST **untouched**: the ver3 HASH covers every field, so
   * an added or overwritten key (e.g. merging your own `orderId`/`amount`)
   * fails verification. Compare the returned `paymentId` and the verified
   * `amount`/`currency` to your own record instead.
   *
   * 1. HASH is verified (constant-time) before any status field is read, and
   *    `clientid` must be this store.
   * 2. `3d`/`3d_host`: `mdStatus` must be in `acceptedMdStatuses`, then the
   *    card is charged with XML `Auth` (using `md`) — the bank's answer decides.
   * 3. `3d_pay`/`3d_pay_hosting`: the bank already charged; an approved
   *    callback is confirmed with an ORDERSTATUS query and rejected if the
   *    bank does not show a captured sale for that order.
   *
   * Once the hash and store check pass, every result carries the verified
   * `oid` as `paymentId`; a rejected (unverified) callback never does.
   */
  async completeThreeDSPayment(callbackData: any): Promise<PaymentResponse> {
    const rejected = (errorMessage: string, rawResponse: unknown): PaymentResponse => ({
      status: PaymentStatus.FAILURE,
      errorCode: 'INVALID_HASH',
      errorMessage,
      rawResponse,
    });

    if (!verifyEst3DCallback(callbackData, this.storeKey)) {
      return rejected('EST 3DS callback hash verification failed', callbackData);
    }
    const cb = callbackData as Record<string, string>;
    const orderId = cb.oid;
    if (!orderId || cb.clientid !== this.clientId) {
      return rejected('EST callback belongs to a different store or order', callbackData);
    }

    const ids = { paymentId: orderId, conversationId: orderId };
    try {
      if (isMerchantCharged(this.storeType)) {
        if (!cb.mdStatus || !this.acceptedMdStatuses.includes(cb.mdStatus)) {
          return {
            status: PaymentStatus.FAILURE,
            ...ids,
            errorCode: `MD_STATUS_${cb.mdStatus ?? ''}`,
            errorMessage: cb.mdErrorMsg || cb.ErrMsg || `3D authentication failed (mdStatus=${cb.mdStatus})`,
            rawResponse: callbackData,
          };
        }
        const { fields } = await this.api({
          Type: 'Auth',
          OrderId: orderId,
          Total: cb.amount,
          Currency: cb.currency,
          Taksit: cb.taksit ?? '',
          Number: cb.md,
          PayerTxnId: cb.xid,
          PayerSecurityLevel: cb.eci,
          PayerAuthenticationCode: cb.cavv,
          Mode: 'P',
        });
        const raw = { callback: callbackData, payment: fields };
        if (!isApproved(fields) || (fields.OrderId && fields.OrderId !== orderId)) {
          return { status: PaymentStatus.FAILURE, ...ids, ...Est.declined(fields), rawResponse: raw };
        }
        return { status: PaymentStatus.SUCCESS, ...ids, rawResponse: raw };
      }

      if (!isApproved(cb)) {
        return {
          status: PaymentStatus.FAILURE,
          ...ids,
          ...Est.declined(cb),
          errorCode: cb.ProcReturnCode || `MD_STATUS_${cb.mdStatus ?? ''}`,
          rawResponse: callbackData,
        };
      }
      const inquiry = await this.orderStatus(orderId);
      if (!isCapturedSale(inquiry)) {
        return { ...rejected('EST callback does not match the order at the bank', { callback: callbackData, inquiry }), ...ids };
      }
      return { status: PaymentStatus.SUCCESS, ...ids, rawResponse: { callback: callbackData, inquiry } };
    } catch (err) {
      // No answer → PENDING: check this order with getPayment before failing it.
      return Est.failed(err, 'EST 3DS completion failed', ids);
    }
  }

  /** Refund (XML `Credit`). `paymentId` is the order id. */
  async refund(request: RefundRequest): Promise<RefundResponse> {
    try {
      const { fields } = await this.api({
        Type: 'Credit',
        OrderId: request.paymentId,
        Total: formatEstAmount(request.price),
        Currency: getEstCurrency(request.currency as string),
      });
      const ok = isApproved(fields);
      return {
        status: ok ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        refundId: ok ? fields.TransId || request.paymentId : undefined,
        conversationId: request.conversationId,
        ...(ok ? {} : Est.declined(fields)),
        rawResponse: fields,
      };
    } catch (err) {
      return Est.failed(err, 'EST refund failed', { conversationId: request.conversationId });
    }
  }

  /** Void (XML `Void`) — same day, before settlement. */
  async cancel(request: CancelRequest): Promise<CancelResponse> {
    try {
      const { fields } = await this.api({ Type: 'Void', OrderId: request.paymentId });
      const ok = isApproved(fields);
      return {
        status: ok ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        voidId: ok ? request.paymentId : undefined,
        transactionId: ok ? fields.TransId || undefined : undefined,
        conversationId: request.conversationId,
        ...(ok ? {} : Est.declined(fields)),
        rawResponse: fields,
      };
    } catch (err) {
      return Est.failed(err, 'EST cancel failed', { conversationId: request.conversationId });
    }
  }

  /** Order status (`ORDERSTATUS`). */
  async getPayment(paymentId: string): Promise<PaymentResponse> {
    try {
      const inquiry = await this.orderStatus(paymentId);
      const status = orderStatusToPaymentStatus(inquiry);
      const { fields, extra } = inquiry;
      return {
        status,
        paymentId,
        conversationId: paymentId,
        ...(status !== PaymentStatus.FAILURE
          ? {}
          : extra.TRANS_STAT === 'D'
            ? { errorCode: extra.PROC_RET_CD || undefined, errorMessage: 'Declined by the bank' }
            : Est.declined(fields)),
        rawResponse: inquiry,
      };
    } catch (err) {
      return Est.failed(err, 'EST getPayment failed', { paymentId, conversationId: paymentId });
    }
  }
}

/** Approved answer showing a captured sale (TRANS_STAT S/C/A, charge type S, amount > 0). */
function isCapturedSale({ fields, extra }: EstXmlResult): boolean {
  return (
    isApproved(fields) &&
    ['S', 'C', 'A'].includes(extra.TRANS_STAT) &&
    extra.CHARGE_TYPE_CD === 'S' &&
    Number(extra.CAPTURE_AMT) > 0
  );
}

/**
 * Voided (V) or refunded (charge type C) → CANCELLED, declined (D) or no
 * record → FAILURE, captured sale → SUCCESS, anything else (e.g. a
 * pre-authorization) → PENDING.
 */
function orderStatusToPaymentStatus(inquiry: EstXmlResult): PaymentStatus {
  const { fields, extra } = inquiry;
  if (!extra.TRANS_STAT) return PaymentStatus.FAILURE;
  if (extra.TRANS_STAT === 'V' || extra.CHARGE_TYPE_CD === 'C') return PaymentStatus.CANCELLED;
  if (extra.TRANS_STAT === 'D' || !isApproved(fields)) return PaymentStatus.FAILURE;
  return isCapturedSale(inquiry) ? PaymentStatus.SUCCESS : PaymentStatus.PENDING;
}
