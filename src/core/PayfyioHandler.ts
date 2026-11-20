import { Payfyio } from './Payfyio';
import { ProviderType } from './PayfyioConfig';
import {
  PaymentRequest,
  ThreeDSPaymentRequest,
  RefundRequest,
  CancelRequest,
  CheckoutFormRequest,
  PWIPaymentRequest,
  InstallmentInfoRequest,
  SubscriptionInitializeRequest,
  SubscriptionCancelRequest,
  SubscriptionUpgradeRequest,
  SubscriptionRetrieveRequest,
  SubscriptionCardUpdateRequest,
  SubscriptionProductCreateRequest,
  PricingPlanCreateRequest,
} from '../types';
import { Iyzico } from '../providers/iyzico';

/**
 * HTTP Request interface for framework-agnostic handling
 */
export interface PayfyioRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: any;
}

/**
 * HTTP Response interface for framework-agnostic handling
 */
export interface PayfyioResponse {
  status: number;
  headers: Record<string, string>;
  body: any;
}

/**
 * Route handler için context
 */
interface RouteContext {
  provider: ProviderType;
  action: string;
  params: Record<string, string>;
}

/**
 * PayfyioHandler - Otomatik API endpoint'leri için merkezi handler.
 *
 * Tüm ödeme işlemlerini otomatik olarak HTTP endpoint'lerine çevirir.
 *
 * Desteklenen endpoint'ler:
 * - POST /api/pay/:provider/payment           -> createPayment()
 * - POST /api/pay/:provider/payment/init-3ds  -> initThreeDSPayment()
 * - POST /api/pay/:provider/payment/complete-3ds -> completeThreeDSPayment()
 * - POST /api/pay/:provider/refund            -> refund()
 * - POST /api/pay/:provider/cancel            -> cancel()
 * - GET  /api/pay/:provider/payment/:id       -> getPayment()
 * - POST /api/pay/:provider/callback          -> 3DS callback handler
 * - GET  /api/pay/health                      -> Health check
 *
 * @example
 * ```typescript
 * const payfyio = new Payfyio({ ... });
 * const handler = new PayfyioHandler(payfyio);
 *
 * // Framework adapter kullanımı:
 * // Next.js: toNextJsHandler(handler)
 * // Express: toNodeHandler(handler)
 * ```
 */
export class PayfyioHandler {
  constructor(private payfyio: Payfyio) {}

  /**
   * Ana request handler - tüm framework'ler için ortak
   */
  async handle(request: PayfyioRequest): Promise<PayfyioResponse> {
    try {
      // Clean URL - remove query string and trailing slash
      const cleanUrl = request.url.split('?')[0].replace(/\/$/, '');

      // Health check
      if (cleanUrl.endsWith('/health') || cleanUrl.endsWith('/ok')) {
        return this.healthCheck();
      }

      // Route parsing
      const context = this.parseRoute(request.url);
      if (!context) {
        return this.errorResponse(404, 'Route not found');
      }

      // Provider validation
      if (!this.payfyio.isProviderEnabled(context.provider)) {
        return this.errorResponse(
          400,
          `Provider '${context.provider}' is not enabled or configured`
        );
      }

      // Route action handler'ı çağır
      return await this.handleAction(request, context);
    } catch (error: any) {
      return this.errorResponse(500, error.message || 'Internal server error');
    }
  }

  /**
   * URL'den route bilgilerini parse et
   *
   * Pattern: /api/pay/:provider/:action
   * Örnekler:
   * - /api/pay/iyzico/payment
   * - /api/pay/paytr/payment/init-3ds
   * - /api/pay/iyzico/payment/123
   */
  private parseRoute(url: string): RouteContext | null {
    // Query string'i temizle
    const cleanUrl = url.split('?')[0];

    // Trailing slash'i kaldır
    const normalizedUrl = cleanUrl.replace(/\/$/, '');

    // /api/pay/ prefix'ini kaldır
    const pathMatch = normalizedUrl.match(/\/api\/pay\/(.+)/);
    if (!pathMatch) {
      return null;
    }

    const segments = pathMatch[1].split('/');
    if (segments.length === 0) {
      return null;
    }

    // Provider (iyzico, paytr)
    const provider = segments[0] as ProviderType;

    // Validate provider
    if (!Object.values(ProviderType).includes(provider)) {
      return null;
    }

    // Action ve params
    const action = segments.slice(1).join('/');
    const params: Record<string, string> = {};

    // Payment ID extraction (/payment/:id)
    const paymentIdMatch = action.match(/^payment\/([^/]+)$/);
    if (paymentIdMatch) {
      params.paymentId = paymentIdMatch[1];
    }

    return { provider, action, params };
  }

  /**
   * Action'a göre ilgili provider metodunu çağır
   */
  private async handleAction(
    request: PayfyioRequest,
    context: RouteContext
  ): Promise<PayfyioResponse> {
    const provider = this.payfyio.use(context.provider);
    const { action, params } = context;

    try {
      switch (action) {
        case 'payment':
          return await this.handleCreatePayment(request, provider);

        case 'payment/init-3ds':
          return await this.handleInitThreeDS(request, provider);

        case 'payment/token':
          return await this.handleTokenPayment(request, provider);

        case 'payment/complete-3ds':
        case 'callback':
          return await this.handleCompleteThreeDS(request, provider);

        case 'refund':
          return await this.handleRefund(request, provider);

        case 'cancel':
          return await this.handleCancel(request, provider);

        // Iyzico-specific routes
        case 'checkout/init':
          return await this.handleCheckoutInit(request, provider);

        case 'checkout/retrieve':
          return await this.handleCheckoutRetrieve(request, provider);

        case 'pwi/init':
          return await this.handlePWIInit(request, provider);

        case 'pwi/retrieve':
          return await this.handlePWIRetrieve(request, provider);

        case 'installment':
          return await this.handleInstallmentInfo(request, provider);

        case 'bin-check':
          return await this.handleBinCheck(request, provider);

        case 'subscription/initialize':
          return await this.handleSubscriptionInitialize(request, provider);

        case 'subscription/cancel':
          return await this.handleSubscriptionCancel(request, provider);

        case 'subscription/upgrade':
          return await this.handleSubscriptionUpgrade(request, provider);

        case 'subscription/retrieve':
          return await this.handleSubscriptionRetrieve(request, provider);

        case 'subscription/card-update':
          return await this.handleSubscriptionCardUpdate(request, provider);

        case 'subscription/product':
          return await this.handleSubscriptionProduct(request, provider);

        case 'subscription/pricing-plan':
          return await this.handlePricingPlan(request, provider);

        default:
          // GET /payment/:id için
          if (params.paymentId && request.method === 'GET') {
            return await this.handleGetPayment(params.paymentId, provider);
          }

          return this.errorResponse(404, `Action '${action}' not found`);
      }
    } catch (error: any) {
      return this.errorResponse(500, error.message || 'Payment operation failed');
    }
  }

  /**
   * POST /api/pay/:provider/payment - Ödeme oluştur
   */
  private async handleCreatePayment(
    request: PayfyioRequest,
    provider: any
  ): Promise<PayfyioResponse> {
    if (request.method !== 'POST') {
      return this.errorResponse(405, 'Method not allowed');
    }

    const paymentRequest: PaymentRequest = request.body;
    const result = await provider.createPayment(paymentRequest);

    return this.successResponse(result);
  }

  /**
   * POST /api/pay/:provider/payment/init-3ds - 3DS ödeme başlat
   */
  private async handleInitThreeDS(
    request: PayfyioRequest,
    provider: any
  ): Promise<PayfyioResponse> {
    if (request.method !== 'POST') {
      return this.errorResponse(405, 'Method not allowed');
    }

    const paymentRequest: ThreeDSPaymentRequest = request.body;
    const result = await provider.initThreeDSPayment(paymentRequest);

    return this.successResponse(result);
  }

  /**
   * POST /api/pay/:provider/payment/complete-3ds - 3DS ödeme tamamla
   * POST /api/pay/:provider/callback - Provider callback (alias)
   */
  private async handleCompleteThreeDS(
    request: PayfyioRequest,
    provider: any
  ): Promise<PayfyioResponse> {
    if (request.method !== 'POST') {
      return this.errorResponse(405, 'Method not allowed');
    }

    let callbackData = request.body;
    const contentType = (request.headers['content-type'] || request.headers['Content-Type'] || '').toLowerCase();
    if (contentType.includes('application/x-www-form-urlencoded') && typeof callbackData === 'string') {
      callbackData = Object.fromEntries(new URLSearchParams(callbackData));
    }

    const result = await provider.completeThreeDSPayment(callbackData);

    return this.successResponse(result);
  }

  /**
   * POST /api/pay/:provider/refund - İade işlemi
   */
  private async handleRefund(request: PayfyioRequest, provider: any): Promise<PayfyioResponse> {
    if (request.method !== 'POST') {
      return this.errorResponse(405, 'Method not allowed');
    }

    const refundRequest: RefundRequest = request.body;
    const result = await provider.refund(refundRequest);

    return this.successResponse(result);
  }

  /**
   * POST /api/pay/:provider/cancel - İptal işlemi
   */
  private async handleCancel(request: PayfyioRequest, provider: any): Promise<PayfyioResponse> {
    if (request.method !== 'POST') {
      return this.errorResponse(405, 'Method not allowed');
    }

    const cancelRequest: CancelRequest = request.body;
    const result = await provider.cancel(cancelRequest);

    return this.successResponse(result);
  }

  /**
   * GET /api/pay/:provider/payment/:id - Ödeme sorgula
   */
  private async handleGetPayment(paymentId: string, provider: any): Promise<PayfyioResponse> {
    const result = await provider.getPayment(paymentId);
    return this.successResponse(result);
  }

  private async handleTokenPayment(
    request: PayfyioRequest,
    provider: any
  ): Promise<PayfyioResponse> {
    if (request.method !== 'POST') return this.errorResponse(405, 'Method not allowed');
    if (typeof provider.createPaymentWithToken !== 'function') {
      return this.errorResponse(400, 'This provider does not support token payments');
    }
    const result = await provider.createPaymentWithToken(request.body);
    return this.successResponse(result);
  }

  private requireIyzico(provider: any): Iyzico | null {
    if (!(provider instanceof Iyzico)) {
      return null;
    }
    return provider;
  }

  private async handleCheckoutInit(
    request: PayfyioRequest,
    provider: any
  ): Promise<PayfyioResponse> {
    if (request.method !== 'POST') return this.errorResponse(405, 'Method not allowed');
    const iyzico = this.requireIyzico(provider);
    if (!iyzico) return this.errorResponse(400, 'Route only available for iyzico provider');
    const result = await iyzico.initCheckoutForm(request.body as CheckoutFormRequest);
    return this.successResponse(result);
  }

  private async handleCheckoutRetrieve(
    request: PayfyioRequest,
    provider: any
  ): Promise<PayfyioResponse> {
    if (request.method !== 'POST') return this.errorResponse(405, 'Method not allowed');
    const iyzico = this.requireIyzico(provider);
    if (!iyzico) return this.errorResponse(400, 'Route only available for iyzico provider');
    const { token, conversationId } = request.body;
    const result = await iyzico.retrieveCheckoutForm(token, conversationId);
    return this.successResponse(result);
  }

  private async handlePWIInit(
    request: PayfyioRequest,
    provider: any
  ): Promise<PayfyioResponse> {
    if (request.method !== 'POST') return this.errorResponse(405, 'Method not allowed');
    const iyzico = this.requireIyzico(provider);
    if (!iyzico) return this.errorResponse(400, 'Route only available for iyzico provider');
    const result = await iyzico.initPWIPayment(request.body as PWIPaymentRequest);
    return this.successResponse(result);
  }

  private async handlePWIRetrieve(
    request: PayfyioRequest,
    provider: any
  ): Promise<PayfyioResponse> {
    if (request.method !== 'POST') return this.errorResponse(405, 'Method not allowed');
    const iyzico = this.requireIyzico(provider);
    if (!iyzico) return this.errorResponse(400, 'Route only available for iyzico provider');
    const { token, conversationId } = request.body;
    const result = await iyzico.retrievePWIPayment(token, conversationId);
    return this.successResponse(result);
  }

  private async handleInstallmentInfo(
    request: PayfyioRequest,
    provider: any
  ): Promise<PayfyioResponse> {
    if (request.method !== 'POST') return this.errorResponse(405, 'Method not allowed');
    if (typeof provider.installmentInfo !== 'function') {
      return this.errorResponse(400, 'This provider does not support installment info');
    }
    const result = await provider.installmentInfo(request.body as InstallmentInfoRequest);
    return this.successResponse(result);
  }

  private async handleBinCheck(
    request: PayfyioRequest,
    provider: any
  ): Promise<PayfyioResponse> {
    if (request.method !== 'POST') return this.errorResponse(405, 'Method not allowed');
    if (typeof provider.binCheck !== 'function') {
      return this.errorResponse(400, 'This provider does not support BIN check');
    }
    const { binNumber } = request.body;
    const result = await provider.binCheck(binNumber);
    return this.successResponse(result);
  }

  private async handleSubscriptionInitialize(
    request: PayfyioRequest,
    provider: any
  ): Promise<PayfyioResponse> {
    if (request.method !== 'POST') return this.errorResponse(405, 'Method not allowed');
    const iyzico = this.requireIyzico(provider);
    if (!iyzico) return this.errorResponse(400, 'Route only available for iyzico provider');
    const result = await iyzico.initializeSubscription(request.body as SubscriptionInitializeRequest);
    return this.successResponse(result);
  }

  private async handleSubscriptionCancel(
    request: PayfyioRequest,
    provider: any
  ): Promise<PayfyioResponse> {
    if (request.method !== 'POST') return this.errorResponse(405, 'Method not allowed');
    const iyzico = this.requireIyzico(provider);
    if (!iyzico) return this.errorResponse(400, 'Route only available for iyzico provider');
    const result = await iyzico.cancelSubscription(request.body as SubscriptionCancelRequest);
    return this.successResponse(result);
  }

  private async handleSubscriptionUpgrade(
    request: PayfyioRequest,
    provider: any
  ): Promise<PayfyioResponse> {
    if (request.method !== 'POST') return this.errorResponse(405, 'Method not allowed');
    const iyzico = this.requireIyzico(provider);
    if (!iyzico) return this.errorResponse(400, 'Route only available for iyzico provider');
    const result = await iyzico.upgradeSubscription(request.body as SubscriptionUpgradeRequest);
    return this.successResponse(result);
  }

  private async handleSubscriptionRetrieve(
    request: PayfyioRequest,
    provider: any
  ): Promise<PayfyioResponse> {
    if (request.method !== 'POST') return this.errorResponse(405, 'Method not allowed');
    const iyzico = this.requireIyzico(provider);
    if (!iyzico) return this.errorResponse(400, 'Route only available for iyzico provider');
    const result = await iyzico.retrieveSubscription(request.body as SubscriptionRetrieveRequest);
    return this.successResponse(result);
  }

  private async handleSubscriptionCardUpdate(
    request: PayfyioRequest,
    provider: any
  ): Promise<PayfyioResponse> {
    if (request.method !== 'POST') return this.errorResponse(405, 'Method not allowed');
    const iyzico = this.requireIyzico(provider);
    if (!iyzico) return this.errorResponse(400, 'Route only available for iyzico provider');
    const result = await iyzico.updateSubscriptionCard(request.body as SubscriptionCardUpdateRequest);
    return this.successResponse(result);
  }

  private async handleSubscriptionProduct(
    request: PayfyioRequest,
    provider: any
  ): Promise<PayfyioResponse> {
    if (request.method !== 'POST') return this.errorResponse(405, 'Method not allowed');
    const iyzico = this.requireIyzico(provider);
    if (!iyzico) return this.errorResponse(400, 'Route only available for iyzico provider');
    const result = await iyzico.createSubscriptionProduct(request.body as SubscriptionProductCreateRequest);
    return this.successResponse(result);
  }

  private async handlePricingPlan(
    request: PayfyioRequest,
    provider: any
  ): Promise<PayfyioResponse> {
    if (request.method !== 'POST') return this.errorResponse(405, 'Method not allowed');
    const iyzico = this.requireIyzico(provider);
    if (!iyzico) return this.errorResponse(400, 'Route only available for iyzico provider');
    const result = await iyzico.createPricingPlan(request.body as PricingPlanCreateRequest);
    return this.successResponse(result);
  }

  /**
   * GET /api/pay/health - Health check
   */
  private healthCheck(): PayfyioResponse {
    const enabledProviders = this.payfyio.getEnabledProviders();

    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: {
        status: 'ok',
        service: 'payfyio',
        version: '1.0.0',
        providers: enabledProviders,
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Success response helper
   */
  private successResponse(data: any): PayfyioResponse {
    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: data,
    };
  }

  /**
   * Error response helper
   */
  private errorResponse(status: number, message: string): PayfyioResponse {
    return {
      status,
      headers: { 'Content-Type': 'application/json' },
      body: {
        error: true,
        message,
        timestamp: new Date().toISOString(),
      },
    };
  }
}
