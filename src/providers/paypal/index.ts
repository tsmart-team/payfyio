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
  PayPalConfig,
  PayPalOAuthResponse,
  PayPalOrder,
  PayPalRefund,
  PayPalErrorBody,
} from './types';
import { formatPayPalAmount, findApprovalUrl, buildRedirectHtml } from './utils';

/**
 * PayPal provider — REST v2 (Orders + Captures + Refunds).
 *
 * Auth model: OAuth2 client_credentials → bearer token cached in-memory until
 * 30s before expiry. clientId is `apiKey`, secret is `secretKey`.
 *
 * 3DS model: PayPal handles SCA on its own approval page; Payfyio returns an
 * HTML redirect to that approval URL through `threeDSHtmlContent`. The merchant
 * is expected to capture the order in `completeThreeDSPayment` once the buyer
 * returns from the approval page.
 *
 * Card-present `createPayment` is intentionally not supported (PayPal requires
 * Advanced Card Processing entitlement that varies per merchant). Callers should
 * use `initThreeDSPayment` and the buyer-approval flow.
 */
export class PayPal extends PaymentProvider {
  private client: AxiosInstance;
  private cachedToken?: { value: string; expiresAt: number };

  constructor(config: PaymentProviderConfig & PayPalConfig) {
    super(config);
    this.client = axios.create({
      baseURL: this.config.baseUrl,
      timeout: 30000,
    });
    this.setupAxiosLogging(this.client, 'paypal');
    this.setupAxiosRetry(this.client);
  }

  protected validateConfig(): void {
    if (!this.config.apiKey) throw new Error('PayPal client ID (apiKey) is required');
    if (!this.config.secretKey) throw new Error('PayPal client secret is required');
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAt > now + 5_000) {
      return this.cachedToken.value;
    }
    const basic = Buffer.from(`${this.config.apiKey}:${this.config.secretKey}`).toString('base64');
    const res = await this.client.post<PayPalOAuthResponse>(
      '/v1/oauth2/token',
      'grant_type=client_credentials',
      {
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
      },
    );
    this.cachedToken = {
      value: res.data.access_token,
      expiresAt: now + (res.data.expires_in - 30) * 1000,
    };
    return this.cachedToken.value;
  }

  private async authedHeaders(): Promise<Record<string, string>> {
    return {
      Authorization: `Bearer ${await this.getAccessToken()}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  private extractError(err: unknown): { code?: string; message: string; raw: unknown } {
    if (axios.isAxiosError(err) && err.response?.data) {
      const data = err.response.data as PayPalErrorBody;
      return {
        code: data.name,
        message: data.message || data.details?.[0]?.description || err.message,
        raw: err.response.data,
      };
    }
    const e = err as Error;
    return { message: e?.message || 'PayPal request failed', raw: err };
  }

  private mapOrderStatus(status: PayPalOrder['status']): PaymentStatus {
    switch (status) {
      case 'COMPLETED':
        return PaymentStatus.SUCCESS;
      case 'VOIDED':
        return PaymentStatus.FAILURE;
      case 'CREATED':
      case 'SAVED':
      case 'APPROVED':
      case 'PAYER_ACTION_REQUIRED':
        return PaymentStatus.PENDING;
      default:
        return PaymentStatus.FAILURE;
    }
  }

  /**
   * Direct card payment is not exposed; merchants without Advanced Card
   * Processing entitlement cannot use it, and we do not want to silently fall
   * back to a redirect flow when the caller asked for a synchronous charge.
   */
  async createPayment(_request: PaymentRequest): Promise<PaymentResponse> {
    return {
      status: PaymentStatus.FAILURE,
      errorMessage:
        'Direct card payment is not supported by the Payfyio PayPal provider. Use initThreeDSPayment to start the buyer-approval flow.',
    };
  }

  async initThreeDSPayment(request: ThreeDSPaymentRequest): Promise<ThreeDSInitResponse> {
    try {
      const body = {
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: request.conversationId || request.basketId,
            amount: {
              currency_code: (request.currency as string) || 'USD',
              value: formatPayPalAmount(request.price),
            },
          },
        ],
        application_context: {
          return_url: request.callbackUrl,
          cancel_url: request.callbackUrl,
          shipping_preference: 'NO_SHIPPING',
          user_action: 'PAY_NOW',
        },
      };
      const res = await this.client.post<PayPalOrder>('/v2/checkout/orders', body, {
        headers: await this.authedHeaders(),
      });
      const order = res.data;
      const approveUrl = findApprovalUrl(order.links);
      if (!approveUrl) {
        return {
          status: PaymentStatus.FAILURE,
          paymentId: order.id,
          conversationId: request.conversationId,
          errorMessage: 'PayPal did not return an approval URL',
          rawResponse: order,
        };
      }
      return {
        status: PaymentStatus.PENDING,
        threeDSHtmlContent: buildRedirectHtml(approveUrl),
        paymentId: order.id,
        conversationId: request.conversationId,
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

  async completeThreeDSPayment(callbackData: any): Promise<PaymentResponse> {
    try {
      const orderId: string =
        callbackData?.token || callbackData?.orderId || callbackData?.paymentId;
      if (!orderId) {
        return {
          status: PaymentStatus.FAILURE,
          errorMessage: 'Missing PayPal order id (token) in callback data',
          rawResponse: callbackData,
        };
      }
      const res = await this.client.post<PayPalOrder>(
        `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
        {},
        { headers: await this.authedHeaders() },
      );
      const order = res.data;
      return {
        status: this.mapOrderStatus(order.status),
        paymentId: order.id,
        conversationId: order.purchase_units?.[0]?.reference_id,
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

  async refund(request: RefundRequest): Promise<RefundResponse> {
    try {
      const orderRes = await this.client.get<PayPalOrder>(
        `/v2/checkout/orders/${encodeURIComponent(request.paymentId)}`,
        { headers: await this.authedHeaders() },
      );
      const captureId = orderRes.data.purchase_units?.[0]?.payments?.captures?.[0]?.id;
      if (!captureId) {
        return {
          status: PaymentStatus.FAILURE,
          conversationId: request.conversationId,
          errorMessage: 'No capture found on order; cannot refund',
          rawResponse: orderRes.data,
        };
      }
      const res = await this.client.post<PayPalRefund>(
        `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`,
        {
          amount: {
            currency_code: (request.currency as string) || 'USD',
            value: formatPayPalAmount(request.price),
          },
        },
        { headers: await this.authedHeaders() },
      );
      const r = res.data;
      return {
        status:
          r.status === 'COMPLETED'
            ? PaymentStatus.SUCCESS
            : r.status === 'PENDING'
              ? PaymentStatus.PENDING
              : PaymentStatus.FAILURE,
        refundId: r.id,
        conversationId: request.conversationId,
        rawResponse: r,
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

  async cancel(request: CancelRequest): Promise<CancelResponse> {
    try {
      // PayPal Orders API has no explicit cancel; voiding only applies to
      // authorizations. For an unsettled CREATED/SAVED order we treat the
      // absence of capture as a no-op success so callers get a uniform shape.
      const orderRes = await this.client.get<PayPalOrder>(
        `/v2/checkout/orders/${encodeURIComponent(request.paymentId)}`,
        { headers: await this.authedHeaders() },
      );
      const order = orderRes.data;
      const hasCapture = !!order.purchase_units?.[0]?.payments?.captures?.length;
      if (hasCapture) {
        return {
          status: PaymentStatus.FAILURE,
          conversationId: request.conversationId,
          errorMessage: 'Order already captured; use refund instead of cancel',
          rawResponse: order,
        };
      }
      return {
        status: PaymentStatus.SUCCESS,
        voidId: order.id,
        conversationId: request.conversationId,
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

  async getPayment(paymentId: string): Promise<PaymentResponse> {
    try {
      const res = await this.client.get<PayPalOrder>(
        `/v2/checkout/orders/${encodeURIComponent(paymentId)}`,
        { headers: await this.authedHeaders() },
      );
      const order = res.data;
      return {
        status: this.mapOrderStatus(order.status),
        paymentId: order.id,
        conversationId: order.purchase_units?.[0]?.reference_id,
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
}
