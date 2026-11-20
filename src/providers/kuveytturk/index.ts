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
import {
  KuveytTurkConfig,
  KuveytTurkEnvelope,
  KuveytTurkTransaction,
  KuveytTurkCallback,
} from './types';
import {
  getKuveytTurkCurrency,
  formatKuveytTurkAmount,
  signKuveytTurk,
  splitKuveytTurkPhone,
  readKuveytTurkFormFields,
  kuveytTurkStatusNumber,
} from './utils';

export type { KuveytTurkConfig, KuveytTurkCallback } from './types';
export { signKuveytTurk, kuveytTurkHashPassword } from './utils';

const PATH = {
  payment: '/KTPay/Payment',
  provision: '/KTPay/Provision',
  reversal: '/KTPay/SaleReversal',
  transactions: '/KTPay/GetTransactions',
} as const;

type ReversalType = 'Cancel' | 'Drawback' | 'PartialDrawback';

/** Unknown outcome only when a money-moving request got no answer at all. */
function errorStatus(err: any, moneyInFlight: boolean): { status: PaymentStatus; errorCode?: string } {
  return moneyInFlight && axios.isAxiosError(err) && !err.response
    ? { status: PaymentStatus.PENDING, errorCode: 'NETWORK_ERROR' }
    : { status: PaymentStatus.FAILURE };
}

/**
 * Kuveyt Türk Sanal POS — KT Pay Gate (JSON API).
 *
 * 3D Secure only: `initThreeDSPayment` sends the card to `/KTPay/Payment` and
 * returns the bank's verification page; the bank POSTs the result to
 * `callbackUrl`, and `completeThreeDSPayment` charges it with `/KTPay/Provision`.
 *
 * `paymentId` everywhere is the merchant order id (`conversationId`, or a
 * generated `KT-…`). The bank's own order id is looked up with GetTransactions.
 */
export class KuveytTurk extends PaymentProvider {
  private client: AxiosInstance;
  private kt: Required<KuveytTurkConfig>;

  constructor(config: PaymentProviderConfig & KuveytTurkConfig) {
    if (!config.merchantId) throw new Error('Kuveyt Türk merchantId is required');
    if (!config.customerId) throw new Error('Kuveyt Türk customerId is required');
    if (!config.username) throw new Error('Kuveyt Türk username is required');
    if (!config.password) throw new Error('Kuveyt Türk password is required');
    super({ ...config, apiKey: config.merchantId, secretKey: config.password });
    this.kt = {
      merchantId: config.merchantId,
      customerId: config.customerId,
      username: config.username,
      password: config.password,
      paymentType: config.paymentType ?? 1,
    };
    this.client = axios.create({
      baseURL: this.config.baseUrl,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      // 4xx bodies are regular KT envelopes (validation errors) — read them, don't throw.
      validateStatus: (s) => s < 500,
    });
    this.setupAxiosLogging(this.client, 'kuveytturk');
    this.setupAxiosRetry(this.client);
  }

  protected validateConfig(): void {
    // Checked in the constructor; apiKey/secretKey are synthesized for the base class.
  }

  private get account() {
    return { merchantId: this.kt.merchantId, customerId: this.kt.customerId, username: this.kt.username };
  }

  private sign(...fields: string[]): string {
    return signKuveytTurk([this.kt.merchantId, ...fields, this.kt.username], this.kt.password);
  }

  private async call<T = unknown>(path: string, body: Record<string, unknown>): Promise<KuveytTurkEnvelope<T>> {
    const res = await this.client.post<KuveytTurkEnvelope<T>>(path, body);
    return res.data && typeof res.data === 'object' ? res.data : {};
  }

  /**
   * Transactions of one merchant order. With `bankOrderId`, only that one;
   * otherwise the successful sale (or the latest attempt).
   */
  private async findTransaction(merchantOrderId: string, bankOrderId?: string) {
    const envelope = await this.call<{ Transactions?: KuveytTurkTransaction[] }>(PATH.transactions, {
      ...this.account,
      merchantOrderId,
      hashData: this.sign(merchantOrderId),
    });
    // Never trust the filter blindly — a row for another order must not be picked.
    const rows = (envelope.Result?.Transactions ?? []).filter((t) => t.MerchantOrderId === merchantOrderId);
    const tx = bankOrderId
      ? rows.find((t) => String(t.OrderId) === bankOrderId)
      : rows.find((t) => kuveytTurkStatusNumber(t.TransactionStatus) === 1) ?? rows[0];
    return { envelope, tx };
  }

  /**
   * Not offered by KT Pay Gate — every card payment goes through 3D Secure.
   * Returns FAILURE (`NOT_SUPPORTED`) without contacting the bank.
   */
  async createPayment(_request: PaymentRequest): Promise<PaymentResponse> {
    return {
      status: PaymentStatus.FAILURE,
      errorCode: 'NOT_SUPPORTED',
      errorMessage: 'Kuveyt Türk KT Pay Gate only processes 3D Secure payments — use initThreeDSPayment',
    };
  }

  /**
   * Card verification request. Requires `buyer.ip`, `buyer.email` and a
   * Turkish `buyer.gsmNumber`. `callbackUrl` is used as both success and fail
   * URL and must not contain `&` (the bank rejects it).
   */
  async initThreeDSPayment(request: ThreeDSPaymentRequest): Promise<ThreeDSInitResponse> {
    const merchantOrderId = request.conversationId || `KT-${Date.now()}`;
    try {
      const url = request.callbackUrl;
      if (!url) throw new Error('callbackUrl is required');
      if (url.includes('&')) throw new Error('Kuveyt Türk rejects "&" in callback URLs');
      const amount = formatKuveytTurkAmount(request.price);
      const installment = request.installment ?? 1;
      if (!Number.isInteger(installment) || installment < 1 || installment > 12) {
        throw new Error(`Kuveyt Türk supports 1-12 installments, got ${request.installment}`);
      }
      const phone = splitKuveytTurkPhone(request.buyer?.gsmNumber);
      const card = request.paymentCard;
      const res = await this.client.post<string>(
        PATH.payment,
        {
          language: /^en/i.test(this.config.locale || '') ? 2 : 1,
          merchantOrderId,
          successUrl: url,
          failUrl: url,
          ...this.account,
          hashData: this.sign(merchantOrderId, amount, url, url),
          amount,
          currency: getKuveytTurkCurrency(request.currency as string),
          installmentCount: installment,
          paymentType: this.kt.paymentType,
          customer: {
            fullName: `${request.buyer.name} ${request.buyer.surname}`.trim(),
            cc: phone.cc,
            subscriber: phone.subscriber,
            email: request.buyer.email,
            identityNumber: request.buyer.identityNumber || undefined,
            ipAddress: request.buyer.ip,
          },
          card: {
            cardHolderName: card.cardHolderName,
            cardNumber: card.cardNumber.replace(/\s/g, ''),
            expireMonth: String(card.expireMonth).padStart(2, '0'),
            expireYear: String(card.expireYear).slice(-2),
            securityCode: card.cvc,
          },
        },
        { responseType: 'text' },
      );
      const html = typeof res.data === 'string' ? res.data : '';
      if (res.status >= 300 || /^\s*\{/.test(html)) {
        // A 4xx page or a JSON error envelope is not a 3D page — never hand it to the browser.
        let envelope: KuveytTurkEnvelope = {};
        try { envelope = JSON.parse(html); } catch { /* not JSON */ }
        return {
          status: PaymentStatus.FAILURE,
          errorCode: envelope.ResponseCode || `HTTP_${res.status}`,
          errorMessage: envelope.ResponseMessage || 'Kuveyt Türk rejected the payment request',
          rawResponse: envelope.ResponseCode ? envelope : html,
        };
      }
      const fields = readKuveytTurkFormFields(html);
      if (!html.trim() || fields.Success?.toLowerCase() === 'false') {
        return {
          status: PaymentStatus.FAILURE,
          errorCode: fields.ResponseCode || 'EMPTY_RESPONSE',
          errorMessage: fields.ResponseMessage || 'Kuveyt Türk rejected the payment request',
          rawResponse: fields,
        };
      }
      return {
        status: PaymentStatus.PENDING,
        threeDSHtmlContent: html,
        paymentId: merchantOrderId,
        conversationId: merchantOrderId,
      };
    } catch (err: any) {
      return {
        status: PaymentStatus.FAILURE,
        errorMessage: err?.message || 'Kuveyt Türk initThreeDSPayment failed',
        rawResponse: err?.response?.data,
      };
    }
  }

  /**
   * Complete a 3D Secure payment from the callback POST.
   *
   * The callback is NOT signed, so none of its values are trusted on their own:
   * 1. `Success` must be "True" and `MerchantOrderId`/`OrderId`/`MD` present;
   * 2. if you pass `orderId` (your record), it must equal `MerchantOrderId`;
   * 3. the order is looked up at the bank and its `OrderId` must match;
   * 4. if you pass `amount` (your record, decimal), it must equal the amount
   *    the bank recorded — which is the amount you signed at init;
   * 5. Provision charges that bank-recorded amount; SUCCESS only if it succeeds.
   *
   * Failures never carry `paymentId`. A Provision call that got no answer
   * returns PENDING / `NETWORK_ERROR` with `paymentId` — confirm with `getPayment`.
   */
  async completeThreeDSPayment(callbackData: KuveytTurkCallback): Promise<PaymentResponse> {
    const cb = (callbackData || {}) as KuveytTurkCallback;
    const str = (v: unknown) => (v == null ? '' : String(v));
    const reject = (errorCode: string, errorMessage: string, rawResponse: unknown = cb): PaymentResponse => ({
      status: PaymentStatus.FAILURE,
      errorCode,
      errorMessage,
      rawResponse,
    });

    if (str(cb.Success).toLowerCase() !== 'true') {
      return reject(str(cb.ResponseCode) || '3DS_FAILED', str(cb.ResponseMessage) || '3D Secure verification failed');
    }
    const merchantOrderId = str(cb.MerchantOrderId);
    const bankOrderId = str(cb.OrderId);
    const md = str(cb.MD);
    if (!merchantOrderId || !bankOrderId || !md) {
      return reject('INVALID_CALLBACK', 'Callback is missing MerchantOrderId, OrderId or MD');
    }
    if (cb.orderId != null && str(cb.orderId) !== merchantOrderId) {
      return reject('ORDER_MISMATCH', 'Callback belongs to a different order');
    }

    let provisionSent = false;
    try {
      const { envelope, tx } = await this.findTransaction(merchantOrderId, bankOrderId);
      if (!tx || typeof tx.FirstAmount !== 'number') {
        return reject('INVALID_CALLBACK', 'No matching Kuveyt Türk transaction for this callback', {
          callback: cb,
          transactions: envelope,
        });
      }
      const amount = String(Math.round(tx.FirstAmount));
      if (cb.amount != null && formatKuveytTurkAmount(str(cb.amount)) !== amount) {
        return reject('AMOUNT_MISMATCH', `Bank recorded ${amount} (minor units), expected ${cb.amount}`, {
          callback: cb,
          transaction: tx,
        });
      }

      provisionSent = true;
      const provision = await this.call(PATH.provision, {
        ...this.account,
        merchantOrderId,
        orderId: bankOrderId,
        amount,
        md,
        hashData: this.sign(merchantOrderId, amount),
      });
      if (provision.Success !== true) {
        return reject(provision.ResponseCode || 'PROVISION_FAILED', provision.ResponseMessage || 'Provision declined', {
          callback: cb,
          provision,
        });
      }
      return {
        status: PaymentStatus.SUCCESS,
        paymentId: merchantOrderId,
        conversationId: merchantOrderId,
        rawResponse: { callback: cb, provision },
      };
    } catch (err: any) {
      const { status, errorCode } = errorStatus(err, provisionSent);
      return {
        status,
        errorCode,
        // The order was confirmed at the bank before Provision went out.
        ...(status === PaymentStatus.PENDING ? { paymentId: merchantOrderId, conversationId: merchantOrderId } : {}),
        errorMessage: err?.message || 'Kuveyt Türk completeThreeDSPayment failed',
        rawResponse: err?.response?.data,
      };
    }
  }

  private async reverse(merchantOrderId: string, type: ReversalType, amount: string, tx: KuveytTurkTransaction) {
    return this.call(PATH.reversal, {
      ...this.account,
      merchantOrderId,
      orderId: String(tx.OrderId),
      saleReversalType: type,
      amount,
      // The bank signs amount "0" for Cancel and Drawback.
      hashData: this.sign(merchantOrderId, type === 'PartialDrawback' ? amount : '0'),
    });
  }

  private static notFound(envelope: KuveytTurkEnvelope) {
    return {
      status: PaymentStatus.FAILURE,
      errorCode: envelope.Success === false ? envelope.ResponseCode : 'ORDER_NOT_FOUND',
      errorMessage: envelope.Success === false ? envelope.ResponseMessage : 'No Kuveyt Türk transaction for this order',
      rawResponse: envelope,
    };
  }

  /**
   * Refund after end of day. The full amount sends `Drawback`, a lower one
   * `PartialDrawback`. Same day, use `cancel`.
   */
  async refund(request: RefundRequest): Promise<RefundResponse> {
    let sent = false;
    try {
      const amount = formatKuveytTurkAmount(request.price);
      const { envelope, tx } = await this.findTransaction(request.paymentId);
      if (!tx) return { ...KuveytTurk.notFound(envelope), conversationId: request.conversationId };
      const full = !tx.DrawbackAmount && Number(amount) === Math.round(tx.FirstAmount ?? NaN);
      sent = true;
      const res = await this.reverse(request.paymentId, full ? 'Drawback' : 'PartialDrawback', amount, tx);
      const ok = res.Success === true;
      return {
        status: ok ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        refundId: ok ? res.BusinessKey || request.paymentId : undefined,
        conversationId: request.conversationId,
        errorCode: ok ? undefined : res.ResponseCode,
        errorMessage: ok ? undefined : res.ResponseMessage,
        rawResponse: res,
      };
    } catch (err: any) {
      return {
        ...errorStatus(err, sent),
        conversationId: request.conversationId,
        errorMessage: err?.message || 'Kuveyt Türk refund failed',
        rawResponse: err?.response?.data,
      };
    }
  }

  /** Same-day void of the whole sale (`Cancel`), before end of day. */
  async cancel(request: CancelRequest): Promise<CancelResponse> {
    let sent = false;
    try {
      const { envelope, tx } = await this.findTransaction(request.paymentId);
      if (!tx) return { ...KuveytTurk.notFound(envelope), conversationId: request.conversationId };
      sent = true;
      const res = await this.reverse(request.paymentId, 'Cancel', String(Math.round(tx.FirstAmount ?? 0)), tx);
      const ok = res.Success === true;
      return {
        status: ok ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        voidId: ok ? res.BusinessKey || request.paymentId : undefined,
        conversationId: request.conversationId,
        errorCode: ok ? undefined : res.ResponseCode,
        errorMessage: ok ? undefined : res.ResponseMessage,
        rawResponse: res,
      };
    } catch (err: any) {
      return {
        ...errorStatus(err, sent),
        conversationId: request.conversationId,
        errorMessage: err?.message || 'Kuveyt Türk cancel failed',
        rawResponse: err?.response?.data,
      };
    }
  }

  /**
   * Order status from GetTransactions. "Başarılı (1)" → SUCCESS (CANCELLED once
   * cancels + refunds cover the full amount), "(2)"/"(3)" → FAILURE, no row → PENDING.
   */
  async getPayment(paymentId: string): Promise<PaymentResponse> {
    try {
      const { envelope, tx } = await this.findTransaction(paymentId);
      if (envelope.Success !== true) {
        return {
          status: PaymentStatus.FAILURE,
          paymentId,
          errorCode: envelope.ResponseCode,
          errorMessage: envelope.ResponseMessage,
          rawResponse: envelope,
        };
      }
      let status = PaymentStatus.PENDING;
      const code = kuveytTurkStatusNumber(tx?.TransactionStatus);
      if (tx && code === 1) {
        const first = tx.FirstAmount ?? 0;
        const reversed = (tx.CancelAmount ?? 0) + (tx.DrawbackAmount ?? 0);
        status = first > 0 && reversed >= first ? PaymentStatus.CANCELLED : PaymentStatus.SUCCESS;
      } else if (code === 2 || code === 3) {
        status = PaymentStatus.FAILURE;
      }
      return {
        status,
        paymentId,
        conversationId: paymentId,
        errorCode: status === PaymentStatus.FAILURE ? tx?.ResponseCode : undefined,
        errorMessage: status === PaymentStatus.FAILURE ? tx?.ResponseExplain : undefined,
        rawResponse: envelope,
      };
    } catch (err: any) {
      return {
        status: PaymentStatus.FAILURE,
        paymentId,
        errorMessage: err?.message || 'Kuveyt Türk getPayment failed',
        rawResponse: err?.response?.data,
      };
    }
  }
}
