import type { AxiosInstance } from 'axios';
import {
  PaymentRequest,
  PaymentResponse,
  ThreeDSPaymentRequest,
  ThreeDSInitResponse,
  RefundRequest,
  RefundResponse,
  CancelRequest,
  CancelResponse,
  BinCheckResponse,
  InstallmentInfoRequest,
  InstallmentInfoResponse,
} from '../types';
import { PayfyioLogger } from './logger';
import type { RetryConfig } from './retry';
import type { SecurityEventEmitter, SecurityEventType, SecuritySeverity } from './security';

/**
 * Ödeme sağlayıcısı yapılandırması
 */
export interface PaymentProviderConfig {
  apiKey: string;
  secretKey: string;
  baseUrl?: string;
  locale?: string;
  logger?: PayfyioLogger;
  retry?: RetryConfig;
  /** Wired by Payfyio; providers emit security signals through it. */
  security?: SecurityEventEmitter;
  /** Set by Payfyio so emitted events carry their provider name. */
  providerName?: string;
}

/**
 * Tüm ödeme sağlayıcıları için temel abstract sınıf
 */
export abstract class PaymentProvider {
  protected config: PaymentProviderConfig;

  constructor(config: PaymentProviderConfig) {
    this.config = {
      locale: 'tr',
      ...config,
    };
    this.validateConfig();
  }

  /**
   * Emit a security signal to the configured handlers. No-op when none are
   * configured. Best-effort; never throws. Providers (and integrators via a
   * subclass) call this for forged callbacks, repeated errors, etc.
   *
   * Do NOT pass PAN/CVV/secrets in `metadata`.
   */
  protected emitSecurityEvent(
    type: SecurityEventType,
    message: string,
    opts: { severity?: SecuritySeverity; metadata?: Record<string, unknown> } = {},
  ): void {
    this.config.security?.emit({
      type,
      message,
      severity: opts.severity,
      provider: this.config.providerName,
      metadata: opts.metadata,
    });
  }

  /**
   * Yapılandırmayı doğrula
   */
  protected validateConfig(): void {
    if (!this.config.apiKey) {
      throw new Error('API Key is required');
    }
    if (!this.config.secretKey) {
      throw new Error('Secret Key is required');
    }
  }

  /**
   * Direkt ödeme (3D Secure olmadan)
   */
  abstract createPayment(request: PaymentRequest): Promise<PaymentResponse>;

  /**
   * 3D Secure ödeme başlat
   */
  abstract initThreeDSPayment(request: ThreeDSPaymentRequest): Promise<ThreeDSInitResponse>;

  /**
   * 3D Secure ödeme tamamla (callback'ten sonra)
   */
  abstract completeThreeDSPayment(callbackData: any): Promise<PaymentResponse>;

  /**
   * İade işlemi
   */
  abstract refund(request: RefundRequest): Promise<RefundResponse>;

  /**
   * İptal işlemi
   */
  abstract cancel(request: CancelRequest): Promise<CancelResponse>;

  /**
   * Ödeme sorgulama
   */
  abstract getPayment(paymentId: string): Promise<PaymentResponse>;

  /**
   * Attaches request/response logging interceptors to an axios instance.
   * No-op when no logger is configured.
   */
  protected setupAxiosLogging(client: AxiosInstance, provider: string): void {
    const logger = this.config.logger;
    if (!logger) return;

    client.interceptors.request.use((config) => {
      logger.debug(`[${provider}] ${config.method?.toUpperCase()} ${config.url}`, {
        provider,
        method: config.method,
        url: config.url,
      });
      return config;
    });

    client.interceptors.response.use(
      (response) => {
        logger.debug(`[${provider}] ${response.status} ${response.config.url}`, {
          provider,
          status: response.status,
          url: response.config.url,
        });
        return response;
      },
      (error) => {
        logger.error(
          `[${provider}] Request failed: ${error?.message}`,
          error instanceof Error ? error : new Error(String(error)),
          {
            provider,
            url: error?.config?.url,
            status: error?.response?.status,
          }
        );
        return Promise.reject(error);
      }
    );
  }

  /**
   * Attaches a security-event interceptor that emits `provider_http_error` on
   * failed provider calls. Separate from logging so it runs even when no logger
   * is configured. No-op when no security emitter is wired.
   */
  protected setupAxiosSecurity(client: AxiosInstance, provider: string): void {
    const security = this.config.security;
    if (!security) return;
    client.interceptors.response.use(undefined, (error) => {
      const status: number | undefined = error?.response?.status;
      // 5xx and transport failures are the noisy "is the provider/our config
      // healthy?" signal; 401/403 specifically can indicate credential probing.
      const severity: SecuritySeverity = status === 401 || status === 403 ? 'warn' : 'info';
      security.emit({
        type: 'provider_http_error',
        severity,
        provider,
        message: `${provider} request failed${status ? ` (HTTP ${status})` : ''}`,
        metadata: {
          status: status ?? null,
          // Path only — never the query string (it can carry tokens).
          url: typeof error?.config?.url === 'string' ? error.config.url.split('?')[0] : null,
        },
      });
      return Promise.reject(error);
    });
  }

  /**
   * Attaches retry logic to an axios instance.
   * No-op when retry.attempts <= 1 or retry is not configured.
   */
  protected setupAxiosRetry(client: AxiosInstance): void {
    const retry = this.config.retry;
    if (!retry || retry.attempts <= 1) return;

    // Only auto-retry HTTP-idempotent methods. A POST/PATCH that creates a
    // charge or refund must never be silently re-sent: a network timeout
    // often means the provider DID process the request but the response was
    // lost, so retrying would double-charge. (Matches axios-retry's safe
    // default of GET/HEAD/OPTIONS/PUT/DELETE.)
    const IDEMPOTENT_METHODS = new Set(['get', 'head', 'options', 'put', 'delete']);

    client.interceptors.response.use(undefined, async (error) => {
      const config = error.config as Record<string, unknown> | undefined;
      if (!config) return Promise.reject(error);

      const method = String(config.method ?? '').toLowerCase();
      if (!IDEMPOTENT_METHODS.has(method)) return Promise.reject(error);

      const retryCount = (config.__retryCount as number | undefined) ?? 0;

      const networkError = !error.response;
      const statusMatch =
        error.response &&
        retry.statusCodes &&
        retry.statusCodes.includes(error.response.status as number);

      const shouldRetry =
        retryCount < retry.attempts - 1 && (networkError || !!statusMatch);

      if (!shouldRetry) return Promise.reject(error);

      config.__retryCount = retryCount + 1;
      await new Promise<void>((resolve) => setTimeout(resolve, retry.delay ?? 1000));
      return client(config as any);
    });
  }

  /**
   * BIN sorgulama
   */
  async binCheck(binNumber: string): Promise<BinCheckResponse> {
    throw new Error(`BIN check for ${binNumber} not supported by this provider`);
  }

  /**
   * Taksit sorgulama
   */
  async installmentInfo(_request: InstallmentInfoRequest): Promise<InstallmentInfoResponse> {
    throw new Error(`Installment info not supported by this provider`);
  }
}
