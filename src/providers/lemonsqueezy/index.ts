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
  CreateLSCheckoutBody,
  LSApiResponse,
  LSCheckout,
  LSOrder,
  LSWebhookEvent,
} from './types';
import { mapLemonSqueezyOrderStatus, verifyLemonSqueezyWebhookSignature } from './utils';

const LS_PROD_BASE_URL = 'https://api.lemonsqueezy.com';

export interface LemonSqueezyConfig {
  /** Store id (numeric) from your Lemon Squeezy dashboard. Required. */
  storeId?: string;
  /** Variant id (numeric) used as the default product for hosted checkouts.
   *  Optional — callers can pass it per-request via `request.metadata.variant_id`. */
  variantId?: string;
  /** Webhook endpoint secret used to verify the `X-Signature` header. */
  webhookSecret?: string;
}

/**
 * Lemon Squeezy — hosted checkout for digital products and subscriptions
 * with merchant-of-record tax handling.
 *
 * Flow:
 *   initThreeDSPayment(request)
 *     → POST /v1/checkouts  (creates a JSON:API checkout under your store + variant)
 *     → returns redirect HTML pointing at the hosted `url`.
 *   After payment, Lemon Squeezy fires `order_created` (and later
 *   `subscription_created` for recurring products). Callers verify each
 *   webhook with verifyWebhookSignature() against the raw body + X-Signature.
 *
 * createPayment() is intentionally unsupported — LS does not expose a
 * direct-card flow; checkout is always hosted.
 */
export class LemonSqueezy extends PaymentProvider {
  private client: AxiosInstance;
  private apiKey: string;
  private webhookSecret: string;
  private storeId?: string;
  private defaultVariantId?: string;

  constructor(config: PaymentProviderConfig & LemonSqueezyConfig) {
    if (!config.apiKey) {
      throw new Error('Lemon Squeezy API key (apiKey) is required');
    }
    super(config);
    this.apiKey = config.apiKey;
    this.webhookSecret = config.webhookSecret ?? '';
    this.storeId = config.storeId;
    this.defaultVariantId = config.variantId;

    this.client = axios.create({
      baseURL: this.config.baseUrl || LS_PROD_BASE_URL,
      timeout: 30_000,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
      },
    });
    this.setupAxiosLogging(this.client, 'lemonsqueezy');
    this.setupAxiosRetry(this.client);
  }

  async createPayment(_request: PaymentRequest): Promise<PaymentResponse> {
    return {
      status: PaymentStatus.FAILURE,
      errorMessage:
        'Direct card payment is not supported by the Payfyio Lemon Squeezy provider. ' +
        'Lemon Squeezy requires a hosted checkout — use initThreeDSPayment.',
    };
  }

  async initThreeDSPayment(request: ThreeDSPaymentRequest): Promise<ThreeDSInitResponse> {
    try {
      const variantId = this.defaultVariantId;
      if (!this.storeId || !variantId) {
        return {
          status: PaymentStatus.FAILURE,
          errorMessage:
            'Lemon Squeezy requires both storeId and variantId in LemonSqueezyConfig.',
        };
      }
      const body: CreateLSCheckoutBody = {
        data: {
          type: 'checkouts',
          attributes: {
            // Lemon Squeezy uses `custom_price` in cents to override the
            // variant's listed price (handy for pay-what-you-want or
            // pre-priced orders coming from payfyio's unified request).
            custom_price: Math.round(Number(request.price) * 100),
            checkout_data: {
              email: request.buyer?.email,
              name:
                request.buyer?.name && request.buyer?.surname
                  ? `${request.buyer.name} ${request.buyer.surname}`
                  : request.buyer?.name,
              custom: {
                conversationId: request.conversationId || '',
                basketId: request.basketId || '',
              },
            },
            checkout_options: {
              embed: false,
            },
          },
          relationships: {
            store: { data: { type: 'stores', id: this.storeId } },
            variant: { data: { type: 'variants', id: variantId } },
          },
        },
      };
      const res = await this.client.post<LSApiResponse<LSCheckout>>('/v1/checkouts', body);
      const checkout = res.data?.data;
      const url = checkout?.attributes?.url;
      if (!url) {
        return {
          status: PaymentStatus.FAILURE,
          errorMessage: 'Lemon Squeezy did not return a checkout URL',
          rawResponse: res.data,
        };
      }
      return {
        status: PaymentStatus.PENDING,
        threeDSHtmlContent: this.buildRedirectHtml(url),
        paymentId: checkout!.id,
        conversationId: request.conversationId,
        rawResponse: checkout,
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
   * LS does not POST signed data back to your checkout's `success_url` — the
   * buyer is simply returned there after the hosted page. Source-of-truth is a
   * webhook event (`order_created`) or a re-poll of GET /v1/orders/{id}. We
   * re-poll here against the **order id** (NOT the checkout id) — pass that as
   * `payload.id` / `payload.orderId` from your callback handler.
   */
  async completeThreeDSPayment(callbackData: any): Promise<PaymentResponse> {
    const orderId: string | undefined =
      callbackData?.order_id || callbackData?.orderId || callbackData?.id || callbackData?.paymentId;
    if (!orderId) {
      return {
        status: PaymentStatus.FAILURE,
        errorMessage: 'Missing Lemon Squeezy order id in callback data',
        rawResponse: callbackData,
      };
    }
    return this.getPayment(orderId);
  }

  /**
   * Issue a refund on an order. Lemon Squeezy currently exposes refunds via
   * the dashboard and through a POST /v1/orders/{id}/refund endpoint (public
   * beta). The `paymentId` here is the order id.
   */
  async refund(request: RefundRequest): Promise<RefundResponse> {
    try {
      const res = await this.client.post<LSApiResponse<LSOrder>>(
        `/v1/orders/${encodeURIComponent(request.paymentId)}/refund`,
        {},
      );
      const order = res.data?.data;
      const refunded = order?.attributes?.refunded === true;
      return {
        status: refunded ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        refundId: order?.id,
        rawResponse: order,
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
   * Lemon Squeezy does not expose a "cancel checkout" endpoint — an unpaid
   * checkout simply expires. For paid orders, use refund(). This method
   * therefore returns a NOT_SUPPORTED-style failure rather than silently
   * succeeding.
   */
  async cancel(_request: CancelRequest): Promise<CancelResponse> {
    return {
      status: PaymentStatus.FAILURE,
      errorMessage:
        'Lemon Squeezy does not support cancelling a paid order. ' +
        'Use refund() for paid orders; unpaid checkouts expire on their own.',
    };
  }

  /**
   * Treats `paymentId` as a Lemon Squeezy ORDER id (the canonical entity for
   * paid transactions). If you want to look up a checkout instead, hit
   * /v1/checkouts/{id} directly — that returns a different shape and isn't
   * used by our public `PaymentStatus` mapping.
   */
  async getPayment(paymentId: string): Promise<PaymentResponse> {
    try {
      const res = await this.client.get<LSApiResponse<LSOrder>>(
        `/v1/orders/${encodeURIComponent(paymentId)}`,
      );
      const order = res.data?.data;
      const mapped = mapLemonSqueezyOrderStatus(order?.attributes?.status);
      return {
        status:
          mapped === 'success'
            ? PaymentStatus.SUCCESS
            : mapped === 'cancelled'
              ? PaymentStatus.CANCELLED
              : mapped === 'failed'
                ? PaymentStatus.FAILURE
                : PaymentStatus.PENDING,
        paymentId: order?.id,
        rawResponse: order,
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
   * Verify a Lemon Squeezy webhook against its `X-Signature` header.
   * `rawBody` MUST be the unparsed request body — re-serializing breaks the digest.
   */
  verifyWebhookSignature(rawBody: string, signatureHeader: string): boolean {
    return verifyLemonSqueezyWebhookSignature(rawBody, signatureHeader, this.webhookSecret);
  }

  /** Parse a webhook event. Does NOT verify the signature — call verifyWebhookSignature() first. */
  parseWebhookEvent(rawBody: string): LSWebhookEvent | null {
    try {
      return JSON.parse(rawBody) as LSWebhookEvent;
    } catch {
      return null;
    }
  }

  private buildRedirectHtml(url: string): string {
    const safe = String(url).replace(/"/g, '&quot;');
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${safe}"></head><body><script>location.replace(${JSON.stringify(url)});</script><p>Redirecting to <a href="${safe}">Lemon Squeezy</a>…</p></body></html>`;
  }

  private extractError(err: unknown): { code: string; message: string; raw: unknown } {
    if (axios.isAxiosError(err)) {
      const body = err.response?.data as { errors?: Array<{ status?: string; title?: string; detail?: string }> } | undefined;
      const first = body?.errors?.[0];
      return {
        code: first?.status || String(err.response?.status ?? 'NETWORK_ERROR'),
        message: first?.detail || first?.title || err.message,
        raw: body ?? null,
      };
    }
    return { code: 'UNKNOWN_ERROR', message: err instanceof Error ? err.message : String(err), raw: null };
  }
}
