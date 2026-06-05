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
  CreatePolarCheckoutRequest,
  PolarCheckout,
  PolarErrorBody,
  PolarRefund,
  PolarWebhookEvent,
} from './types';
import { mapPolarCheckoutStatus, verifyPolarWebhookSignature } from './utils';

const POLAR_PROD_BASE_URL = 'https://api.polar.sh';

export interface PolarConfig {
  /** A pre-existing Polar product id used as the default for hosted checkouts.
   *  Optional — callers can pass it per-request via `ThreeDSPaymentRequest.metadata.product_id`. */
  productId?: string;
  /** Webhook endpoint secret (`whsec_…`) for verifyWebhookSignature(). */
  webhookSecret?: string;
}

/**
 * Polar.sh — hosted checkout for digital products and subscriptions.
 *
 * Flow:
 *   initThreeDSPayment(request)
 *     → POST /v1/checkouts/  (creates a checkout)
 *     → returns redirect HTML pointing the buyer at the hosted `url`.
 *   After payment, Polar fires a `checkout.updated` webhook and an
 *   `order.created` event. Callers verify with verifyWebhookSignature()
 *   against the raw body + standard-webhooks headers.
 *
 * createPayment() is intentionally unsupported — Polar does not expose a
 * direct-card flow; checkout is always hosted.
 */
export class Polar extends PaymentProvider {
  private client: AxiosInstance;
  private apiKey: string;
  private webhookSecret: string;
  private defaultProductId?: string;

  constructor(config: PaymentProviderConfig & PolarConfig) {
    if (!config.apiKey) {
      throw new Error('Polar.sh organization access token (apiKey) is required');
    }
    super(config);
    this.apiKey = config.apiKey;
    this.webhookSecret = config.webhookSecret ?? '';
    this.defaultProductId = config.productId;

    this.client = axios.create({
      baseURL: this.config.baseUrl || POLAR_PROD_BASE_URL,
      timeout: 30_000,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
    });
    this.setupAxiosLogging(this.client, 'polar');
    this.setupAxiosRetry(this.client);
  }

  async createPayment(_request: PaymentRequest): Promise<PaymentResponse> {
    return {
      status: PaymentStatus.FAILURE,
      errorMessage:
        'Direct card payment is not supported by the Payfyio Polar provider. ' +
        'Polar.sh requires a hosted checkout — use initThreeDSPayment.',
    };
  }

  async initThreeDSPayment(request: ThreeDSPaymentRequest): Promise<ThreeDSInitResponse> {
    try {
      // Polar bills against a pre-existing product. The product id comes from
      // PolarConfig.productId; for multi-product accounts, instantiate
      // multiple Payfyio instances (one per product) or pre-create the
      // checkout via the dashboard.
      const productId = this.defaultProductId;
      if (!productId) {
        return {
          status: PaymentStatus.FAILURE,
          errorMessage:
            'Polar.sh requires a product_id — set PolarConfig.productId at Payfyio init time.',
        };
      }
      const body: CreatePolarCheckoutRequest = {
        product_id: productId,
        success_url: request.callbackUrl,
        customer_email: request.buyer?.email,
        customer_name:
          request.buyer?.name && request.buyer?.surname
            ? `${request.buyer.name} ${request.buyer.surname}`
            : undefined,
        // Amount is only used for pay-what-you-want products; in cents.
        amount: Math.round(Number(request.price) * 100),
        metadata: {
          conversationId: request.conversationId || '',
          basketId: request.basketId || '',
        },
      };
      const res = await this.client.post<PolarCheckout>('/v1/checkouts/', body);
      const checkout = res.data;
      if (!checkout?.url) {
        return {
          status: PaymentStatus.FAILURE,
          errorMessage: 'Polar did not return a checkout URL',
          rawResponse: checkout,
        };
      }
      return {
        status: PaymentStatus.PENDING,
        threeDSHtmlContent: this.buildRedirectHtml(checkout.url),
        paymentId: checkout.id,
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
   * Polar does NOT POST signed data back to your `success_url` — the buyer
   * is simply returned there after the hosted page. Source-of-truth is a
   * webhook event (`checkout.updated`, `order.created`) or a re-poll of
   * GET /v1/checkouts/{id}. We re-poll here.
   */
  async completeThreeDSPayment(callbackData: any): Promise<PaymentResponse> {
    const checkoutId: string | undefined =
      callbackData?.checkout_id || callbackData?.id || callbackData?.paymentId;
    if (!checkoutId) {
      return {
        status: PaymentStatus.FAILURE,
        errorMessage: 'Missing Polar checkout id in callback data',
        rawResponse: callbackData,
      };
    }
    return this.getPayment(checkoutId);
  }

  /**
   * Issue a refund on an order. The `paymentId` here MUST be a Polar order
   * id (not a checkout id) — orders are created server-side once payment
   * confirms. Pass `metadata.order_id` if a separate id is needed.
   */
  async refund(request: RefundRequest): Promise<RefundResponse> {
    try {
      const orderId = request.paymentId;
      const amount = Math.round(Number(request.price) * 100);
      const body = { order_id: orderId, amount, reason: 'requested_by_customer' };
      const res = await this.client.post<PolarRefund>('/v1/refunds/', body);
      const refund = res.data;
      const ok = refund?.status === 'succeeded' || refund?.status === 'pending';
      return {
        status: ok ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        refundId: refund?.id,
        rawResponse: refund,
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
   * Cancel an open (unpaid) checkout. Polar does not support voiding paid
   * orders — refund those via refund() instead.
   */
  async cancel(request: CancelRequest): Promise<CancelResponse> {
    try {
      const res = await this.client.delete<PolarCheckout>(
        `/v1/checkouts/${encodeURIComponent(request.paymentId)}`,
      );
      const checkout = res.data;
      return {
        status:
          mapPolarCheckoutStatus(checkout?.status) === 'failed'
            ? PaymentStatus.CANCELLED
            : PaymentStatus.SUCCESS,
        transactionId: checkout?.id,
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

  async getPayment(paymentId: string): Promise<PaymentResponse> {
    try {
      const res = await this.client.get<PolarCheckout>(
        `/v1/checkouts/${encodeURIComponent(paymentId)}`,
      );
      const checkout = res.data;
      const mapped = mapPolarCheckoutStatus(checkout?.status);
      return {
        status:
          mapped === 'success'
            ? PaymentStatus.SUCCESS
            : mapped === 'failed'
              ? PaymentStatus.FAILURE
              : PaymentStatus.PENDING,
        paymentId: checkout?.id,
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
   * Verify a Polar webhook against its standard-webhooks headers.
   * `rawBody` MUST be the unparsed request body — re-serializing breaks the digest.
   */
  verifyWebhookSignature(
    rawBody: string,
    headers: { id: string; timestamp: string; signature: string },
  ): boolean {
    return verifyPolarWebhookSignature(rawBody, headers, this.webhookSecret);
  }

  /** Parse a webhook event. Does NOT verify the signature — call verifyWebhookSignature() first. */
  parseWebhookEvent(rawBody: string): PolarWebhookEvent | null {
    try {
      return JSON.parse(rawBody) as PolarWebhookEvent;
    } catch {
      return null;
    }
  }

  private buildRedirectHtml(url: string): string {
    const safe = String(url).replace(/"/g, '&quot;');
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${safe}"></head><body><script>location.replace(${JSON.stringify(url)});</script><p>Redirecting to <a href="${safe}">Polar.sh</a>…</p></body></html>`;
  }

  private extractError(err: unknown): { code: string; message: string; raw: unknown } {
    if (axios.isAxiosError(err)) {
      const body = err.response?.data as PolarErrorBody | undefined;
      return {
        code: body?.type || body?.error || String(err.response?.status ?? 'NETWORK_ERROR'),
        message: body?.detail || body?.error_description || err.message,
        raw: body ?? null,
      };
    }
    return { code: 'UNKNOWN_ERROR', message: err instanceof Error ? err.message : String(err), raw: null };
  }
}
