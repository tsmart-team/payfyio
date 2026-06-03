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
  CoinbaseApiResponse,
  CoinbaseCharge,
  CoinbaseWebhookEvent,
  CreateCoinbaseChargeRequest,
} from './types';
import { mapCoinbaseStatus, verifyCoinbaseWebhookSignature } from './utils';

const COMMERCE_BASE_URL = 'https://api.commerce.coinbase.com';
const COMMERCE_API_VERSION = '2018-03-22';

export interface CoinbaseConfig {
  /** Webhook shared secret used by verifyWebhookSignature(). Optional but
   *  strongly recommended — without it, callbacks cannot be authenticated. */
  webhookSecret?: string;
}

/**
 * Coinbase Commerce — hosted crypto checkout (BTC, ETH, USDC, …).
 *
 * Flow: caller invokes initThreeDSPayment() → we create a Charge and return
 * a redirect-HTML pointing the buyer at Coinbase's hosted_url. After the
 * buyer pays in crypto, Coinbase fires a webhook AND adds an entry to the
 * charge's `timeline[]`. Callers complete the flow either by:
 *   - re-polling getPayment(chargeCode) on their `redirect_url` page, OR
 *   - handling a webhook server-side and calling verifyWebhookSignature()
 *     against the raw request body.
 *
 * createPayment() (direct card-style) is intentionally unsupported because
 * there is no card data in a crypto flow.
 */
export class Coinbase extends PaymentProvider {
  private client: AxiosInstance;
  private apiKey: string;
  private webhookSecret: string;

  constructor(config: PaymentProviderConfig & CoinbaseConfig) {
    if (!config.apiKey) {
      throw new Error('Coinbase Commerce API key (apiKey) is required');
    }
    super(config);
    this.apiKey = config.apiKey;
    this.webhookSecret = config.webhookSecret ?? '';

    this.client = axios.create({
      baseURL: this.config.baseUrl || COMMERCE_BASE_URL,
      timeout: 30_000,
      headers: {
        'X-CC-Api-Key': this.apiKey,
        'X-CC-Version': COMMERCE_API_VERSION,
        'Content-Type': 'application/json',
      },
    });
    this.setupAxiosLogging(this.client, 'coinbase');
    this.setupAxiosRetry(this.client);
  }

  async createPayment(_request: PaymentRequest): Promise<PaymentResponse> {
    return {
      status: PaymentStatus.FAILURE,
      errorMessage:
        'Direct card payment is not supported by the Payfyio Coinbase provider. ' +
        'Crypto checkout requires a hosted flow — use initThreeDSPayment.',
    };
  }

  async initThreeDSPayment(request: ThreeDSPaymentRequest): Promise<ThreeDSInitResponse> {
    try {
      const body: CreateCoinbaseChargeRequest = {
        name: request.basketId || request.conversationId || 'Payment',
        description: request.conversationId,
        local_price: {
          amount: String(request.price),
          currency: (request.currency as string) || 'USD',
        },
        pricing_type: 'fixed_price',
        metadata: {
          conversationId: request.conversationId || '',
          buyerEmail: request.buyer?.email || '',
        },
        redirect_url: request.callbackUrl,
        cancel_url: request.callbackUrl,
      };
      const res = await this.client.post<CoinbaseApiResponse<CoinbaseCharge>>('/charges', body);
      const charge = res.data?.data;
      if (!charge?.hosted_url) {
        return {
          status: PaymentStatus.FAILURE,
          errorMessage: 'Coinbase did not return a hosted_url for the charge',
          rawResponse: res.data,
        };
      }
      return {
        status: PaymentStatus.PENDING,
        threeDSHtmlContent: this.buildRedirectHtml(charge.hosted_url),
        paymentId: charge.code,           // `code` is the public id used in subsequent calls
        conversationId: request.conversationId,
        rawResponse: charge,
      };
    } catch (err) {
      const e = this.extractError(err);
      return {
        status: PaymentStatus.FAILURE,
        errorCode: e.code,
        errorMessage: e.message,
        rawResponse: e.raw,
      };
    }
  }

  /**
   * Coinbase does not POST signed data back to your `redirect_url` — the
   * buyer is simply returned there after the hosted page. Source-of-truth
   * for status is either a webhook event or a fresh GET /charges/{code}.
   * We re-poll here and trust only the API-reported status.
   */
  async completeThreeDSPayment(callbackData: any): Promise<PaymentResponse> {
    const chargeCode: string | undefined =
      callbackData?.code || callbackData?.paymentId || callbackData?.id;
    if (!chargeCode) {
      return {
        status: PaymentStatus.FAILURE,
        errorMessage: 'Missing Coinbase charge code in callback data',
        rawResponse: callbackData,
      };
    }
    return this.getPayment(chargeCode);
  }

  async refund(_request: RefundRequest): Promise<RefundResponse> {
    return {
      status: PaymentStatus.FAILURE,
      errorMessage:
        'Coinbase Commerce does not support programmatic refunds — issue a manual refund ' +
        'from the Coinbase dashboard or send crypto back to the customer wallet.',
    };
  }

  async cancel(request: CancelRequest): Promise<CancelResponse> {
    try {
      const res = await this.client.post<CoinbaseApiResponse<CoinbaseCharge>>(
        `/charges/${encodeURIComponent(request.paymentId)}/cancel`,
      );
      const charge = res.data?.data;
      const latest = charge?.timeline?.[charge.timeline.length - 1]?.status;
      return {
        status: mapCoinbaseStatus(latest) === 'cancelled'
          ? PaymentStatus.CANCELLED
          : PaymentStatus.FAILURE,
        transactionId: charge?.code,
        rawResponse: charge,
      };
    } catch (err) {
      const e = this.extractError(err);
      return {
        status: PaymentStatus.FAILURE,
        errorCode: e.code,
        errorMessage: e.message,
        rawResponse: e.raw,
      };
    }
  }

  async getPayment(paymentId: string): Promise<PaymentResponse> {
    try {
      const res = await this.client.get<CoinbaseApiResponse<CoinbaseCharge>>(
        `/charges/${encodeURIComponent(paymentId)}`,
      );
      const charge = res.data?.data;
      const latest = charge?.timeline?.[charge.timeline.length - 1]?.status;
      const mapped = mapCoinbaseStatus(latest);
      return {
        status:
          mapped === 'success'
            ? PaymentStatus.SUCCESS
            : mapped === 'cancelled'
              ? PaymentStatus.CANCELLED
              : mapped === 'failed'
                ? PaymentStatus.FAILURE
                : PaymentStatus.PENDING,
        paymentId: charge?.code,
        rawResponse: charge,
      };
    } catch (err) {
      const e = this.extractError(err);
      return {
        status: PaymentStatus.FAILURE,
        errorCode: e.code,
        errorMessage: e.message,
        rawResponse: e.raw,
      };
    }
  }

  /**
   * Verify a webhook callback's `X-CC-Webhook-Signature` against `rawBody`.
   * `rawBody` MUST be the unparsed request body string — re-serializing JSON
   * before hashing produces a different digest and the check fails.
   */
  verifyWebhookSignature(rawBody: string, signatureHeader: string): boolean {
    return verifyCoinbaseWebhookSignature(rawBody, signatureHeader, this.webhookSecret);
  }

  /** Parse a webhook event. Does NOT verify the signature — call verifyWebhookSignature() first. */
  parseWebhookEvent(rawBody: string): CoinbaseWebhookEvent | null {
    try {
      const outer = JSON.parse(rawBody);
      return outer?.event ?? null;
    } catch {
      return null;
    }
  }

  private buildRedirectHtml(url: string): string {
    const safe = String(url).replace(/"/g, '&quot;');
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${safe}"></head><body><script>location.replace(${JSON.stringify(url)});</script><p>Redirecting to <a href="${safe}">Coinbase Commerce</a>…</p></body></html>`;
  }

  private extractError(err: unknown): { code: string; message: string; raw: unknown } {
    if (axios.isAxiosError(err)) {
      const body = err.response?.data as { error?: { type?: string; message?: string } } | undefined;
      return {
        code: body?.error?.type || String(err.response?.status ?? 'NETWORK_ERROR'),
        message: body?.error?.message || err.message,
        raw: body ?? null,
      };
    }
    return { code: 'UNKNOWN_ERROR', message: err instanceof Error ? err.message : String(err), raw: null };
  }
}
