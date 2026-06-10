import { PaymentProvider, PaymentProviderConfig } from './PaymentProvider';
import { PayfyioConfig, ProviderType, ProviderInstances, PROVIDER_DEFAULT_URLS } from './PayfyioConfig';
import { ProviderNotEnabledError } from './errors';
import { Iyzico } from '../providers/iyzico';
import { PayTR } from '../providers/paytr';
import { Akbank } from '../providers/akbank';
import { Parampos } from '../providers/parampos';
import { Stripe } from '../providers/stripe';
import { PayPal } from '../providers/paypal';
import { Garanti } from '../providers/garanti';
import { Isbank } from '../providers/isbank';
import { YapiKredi } from '../providers/yapikredi';
import { Ziraat } from '../providers/ziraat';
import { Coinbase } from '../providers/coinbase';
import { Polar } from '../providers/polar';
import { LemonSqueezy } from '../providers/lemonsqueezy';
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
  PayoutRequest,
  PayoutResponse,
  SubmerchantCreateRequest,
  SubmerchantUpdateRequest,
  SubmerchantResponse,
} from '../types';
import { PayfyioHandler } from './PayfyioHandler';
import { SecurityEventEmitter } from './security';

/**
 * Payfyio - Merkezi ödeme yönetim sınıfı
 */
export class Payfyio {
  private config: PayfyioConfig;
  private providers: ProviderInstances = {};
  private defaultProvider?: ProviderType;
  private _handler: PayfyioHandler;
  private security: SecurityEventEmitter;

  constructor(config: PayfyioConfig) {
    this.config = config;
    this.defaultProvider = config.defaultProvider;
    this.security = new SecurityEventEmitter([
      ...(config.onSecurityEvent ? [config.onSecurityEvent] : []),
      ...(config.securityNotifiers ?? []),
    ]);
    this.initializeProviders();
    this._handler = new PayfyioHandler(this);
  }

  get handler(): PayfyioHandler {
    return this._handler;
  }

  /**
   * Alt-satıcı (marketplace submerchant / Connect account) yönetimi. Default
   * provider'a delege eder; yalnızca submerchant destekleyen sağlayıcılarda
   * (iyzico, Stripe) çalışır, diğerleri hata fırlatır.
   */
  get submerchants() {
    return {
      create: (request: SubmerchantCreateRequest): Promise<SubmerchantResponse> =>
        this.getDefaultProvider().createSubmerchant(request),
      update: (request: SubmerchantUpdateRequest): Promise<SubmerchantResponse> =>
        this.getDefaultProvider().updateSubmerchant(request),
      retrieve: (externalId: string): Promise<SubmerchantResponse> =>
        this.getDefaultProvider().retrieveSubmerchant(externalId),
    };
  }

  /** Emit a security signal manually (e.g. from your own callback route). */
  emitSecurityEvent(
    event: Parameters<SecurityEventEmitter['emit']>[0],
  ): void {
    this.security.emit(event);
  }

  private applyDefaultBaseUrl<T extends PaymentProviderConfig>(providerType: ProviderType, config: T): T {
    const mode = this.config.mode || 'production';
    const defaults = PROVIDER_DEFAULT_URLS[providerType];
    const baseUrl = config.baseUrl ?? (defaults ? (defaults[mode] ?? defaults['production']) : undefined);
    return {
      ...config,
      baseUrl,
      logger: config.logger ?? this.config.logger,
      retry: config.retry ?? this.config.retry,
      security: this.security,
      providerName: providerType,
    };
  }

  private initializeProviders(): void {
    if (this.config.providers[ProviderType.IYZICO]?.enabled) {
      const iyzicoConfig = this.applyDefaultBaseUrl(ProviderType.IYZICO, this.config.providers[ProviderType.IYZICO]!.config);
      this.validateIyzicoConfig(iyzicoConfig);
      this.providers[ProviderType.IYZICO] = new Iyzico(iyzicoConfig);
    }

    if (this.config.providers[ProviderType.PAYTR]?.enabled) {
      const paytrConfig = this.applyDefaultBaseUrl(ProviderType.PAYTR, this.config.providers[ProviderType.PAYTR]!.config);
      this.validatePayTRConfig(paytrConfig);
      this.providers[ProviderType.PAYTR] = new PayTR(paytrConfig as any);
    }

    if (this.config.providers[ProviderType.AKBANK]?.enabled) {
      const akbankConfig = this.applyDefaultBaseUrl(ProviderType.AKBANK, this.config.providers[ProviderType.AKBANK]!.config);
      this.validateAkbankConfig(akbankConfig);
      this.providers[ProviderType.AKBANK] = new Akbank(akbankConfig as any);
    }

    if (this.config.providers[ProviderType.PARAMPOS]?.enabled) {
      const paramposConfig = this.applyDefaultBaseUrl(ProviderType.PARAMPOS, this.config.providers[ProviderType.PARAMPOS]!.config);
      this.validateParamposConfig(paramposConfig);
      this.providers[ProviderType.PARAMPOS] = new Parampos(paramposConfig as any);
    }

    if (this.config.providers[ProviderType.STRIPE]?.enabled) {
      const stripeConfig = this.applyDefaultBaseUrl(ProviderType.STRIPE, this.config.providers[ProviderType.STRIPE]!.config);
      this.validateStripeConfig(stripeConfig);
      this.providers[ProviderType.STRIPE] = new Stripe(stripeConfig as any);
    }

    if (this.config.providers[ProviderType.PAYPAL]?.enabled) {
      const paypalConfig = this.applyDefaultBaseUrl(ProviderType.PAYPAL, this.config.providers[ProviderType.PAYPAL]!.config);
      this.validatePayPalConfig(paypalConfig);
      this.providers[ProviderType.PAYPAL] = new PayPal(paypalConfig as any);
    }

    if (this.config.providers[ProviderType.GARANTI]?.enabled) {
      const garantiConfig = this.applyDefaultBaseUrl(ProviderType.GARANTI, this.config.providers[ProviderType.GARANTI]!.config);
      this.validateGarantiConfig(garantiConfig);
      this.providers[ProviderType.GARANTI] = new Garanti(garantiConfig as any);
    }

    if (this.config.providers[ProviderType.ISBANK]?.enabled) {
      const isbankConfig = this.applyDefaultBaseUrl(ProviderType.ISBANK, this.config.providers[ProviderType.ISBANK]!.config);
      this.validateIsbankConfig(isbankConfig);
      this.providers[ProviderType.ISBANK] = new Isbank(isbankConfig as any);
    }

    if (this.config.providers[ProviderType.YAPIKREDI]?.enabled) {
      const ykbConfig = this.applyDefaultBaseUrl(ProviderType.YAPIKREDI, this.config.providers[ProviderType.YAPIKREDI]!.config);
      this.validateYapiKrediConfig(ykbConfig);
      this.providers[ProviderType.YAPIKREDI] = new YapiKredi(ykbConfig as any);
    }

    if (this.config.providers[ProviderType.ZIRAAT]?.enabled) {
      const ziraatConfig = this.applyDefaultBaseUrl(ProviderType.ZIRAAT, this.config.providers[ProviderType.ZIRAAT]!.config);
      this.validateZiraatConfig(ziraatConfig);
      this.providers[ProviderType.ZIRAAT] = new Ziraat(ziraatConfig as any);
    }

    if (this.config.providers[ProviderType.COINBASE]?.enabled) {
      const coinbaseConfig = this.applyDefaultBaseUrl(ProviderType.COINBASE, this.config.providers[ProviderType.COINBASE]!.config);
      this.validateCoinbaseConfig(coinbaseConfig);
      this.providers[ProviderType.COINBASE] = new Coinbase(coinbaseConfig as any);
    }

    if (this.config.providers[ProviderType.POLAR]?.enabled) {
      const polarConfig = this.applyDefaultBaseUrl(ProviderType.POLAR, this.config.providers[ProviderType.POLAR]!.config);
      this.validatePolarConfig(polarConfig);
      this.providers[ProviderType.POLAR] = new Polar(polarConfig as any);
    }

    if (this.config.providers[ProviderType.LEMONSQUEEZY]?.enabled) {
      const lsConfig = this.applyDefaultBaseUrl(ProviderType.LEMONSQUEEZY, this.config.providers[ProviderType.LEMONSQUEEZY]!.config);
      this.validateLemonSqueezyConfig(lsConfig);
      this.providers[ProviderType.LEMONSQUEEZY] = new LemonSqueezy(lsConfig as any);
    }

    if (this.defaultProvider && !this.providers[this.defaultProvider]) {
      throw new Error(`Default provider '${this.defaultProvider}' is not enabled or configured`);
    }

    if (!this.defaultProvider) {
      const enabledProviders = Object.keys(this.providers) as ProviderType[];
      if (enabledProviders.length === 1) {
        this.defaultProvider = enabledProviders[0];
      }
    }
  }

  private validateIyzicoConfig(config: PaymentProviderConfig): void {
    const missing: string[] = [];
    if (!config.apiKey) missing.push('apiKey (IYZICO_API_KEY)');
    if (!config.secretKey) missing.push('secretKey (IYZICO_SECRET_KEY)');
    if (missing.length) throw new Error(`Iyzico configuration is missing required fields:\n  - ${missing.join('\n  - ')}`);
  }

  private validatePayTRConfig(config: PaymentProviderConfig & { merchantId: string; merchantSalt: string }): void {
    const missing: string[] = [];
    if (!config.merchantId) missing.push('merchantId (PAYTR_MERCHANT_ID)');
    if (!config.secretKey) missing.push('merchantKey (PAYTR_MERCHANT_KEY)');
    if (!config.merchantSalt) missing.push('merchantSalt (PAYTR_MERCHANT_SALT)');
    if (missing.length) throw new Error(`PayTR configuration is missing required fields:\n  - ${missing.join('\n  - ')}`);
  }

  private validateAkbankConfig(config: PaymentProviderConfig & { merchantId: string; terminalId: string; storeKey: string }): void {
    const missing: string[] = [];
    if (!config.merchantId) missing.push('merchantId (AKBANK_MERCHANT_ID)');
    if (!config.terminalId) missing.push('terminalId (AKBANK_TERMINAL_ID)');
    if (!config.storeKey) missing.push('storeKey (AKBANK_STORE_KEY)');
    if (missing.length) throw new Error(`Akbank configuration is missing required fields:\n  - ${missing.join('\n  - ')}`);
  }

  private validateParamposConfig(config: PaymentProviderConfig & { clientCode: string; clientUsername: string; clientPassword: string; guid: string }): void {
    const missing: string[] = [];
    if (!config.clientCode) missing.push('clientCode (PARAMPOS_CLIENT_CODE)');
    if (!config.clientUsername) missing.push('clientUsername (PARAMPOS_CLIENT_USERNAME)');
    if (!config.clientPassword) missing.push('clientPassword (PARAMPOS_CLIENT_PASSWORD)');
    if (!config.guid) missing.push('guid (PARAMPOS_GUID)');
    if (missing.length) throw new Error(`Parampos configuration is missing required fields:\n  - ${missing.join('\n  - ')}`);
  }

  private validateStripeConfig(config: PaymentProviderConfig): void {
    if (!config.secretKey) throw new Error('Stripe configuration is missing required field: secretKey (STRIPE_SECRET_KEY)');
  }

  private validatePayPalConfig(config: PaymentProviderConfig): void {
    const missing: string[] = [];
    if (!config.apiKey) missing.push('apiKey (PAYPAL_CLIENT_ID)');
    if (!config.secretKey) missing.push('secretKey (PAYPAL_CLIENT_SECRET)');
    if (missing.length) throw new Error(`PayPal configuration is missing required fields:\n  - ${missing.join('\n  - ')}`);
  }

  private validateGarantiConfig(config: PaymentProviderConfig & {
    merchantId: string; terminalId: string; provisionUser: string; provisionPassword: string; storeKey: string;
  }): void {
    const missing: string[] = [];
    if (!config.merchantId) missing.push('merchantId (GARANTI_MERCHANT_ID)');
    if (!config.terminalId) missing.push('terminalId (GARANTI_TERMINAL_ID)');
    if (!config.provisionUser) missing.push('provisionUser (GARANTI_PROVISION_USER)');
    if (!config.provisionPassword) missing.push('provisionPassword (GARANTI_PROVISION_PASSWORD)');
    if (!config.storeKey) missing.push('storeKey (GARANTI_STORE_KEY)');
    if (missing.length) throw new Error(`Garanti configuration is missing required fields:\n  - ${missing.join('\n  - ')}`);
  }

  private validateIsbankConfig(config: PaymentProviderConfig & {
    clientId: string; username: string; password: string; storeKey: string;
  }): void {
    const missing: string[] = [];
    if (!config.clientId) missing.push('clientId (ISBANK_CLIENT_ID)');
    if (!config.username) missing.push('username (ISBANK_USERNAME)');
    if (!config.password) missing.push('password (ISBANK_PASSWORD)');
    if (!config.storeKey) missing.push('storeKey (ISBANK_STORE_KEY)');
    if (missing.length) throw new Error(`İş Bankası configuration is missing required fields:\n  - ${missing.join('\n  - ')}`);
  }

  private validateYapiKrediConfig(config: PaymentProviderConfig & {
    merchantId: string; terminalId: string; posnetId: string; encKey: string;
  }): void {
    const missing: string[] = [];
    if (!config.merchantId) missing.push('merchantId (YAPIKREDI_MERCHANT_ID)');
    if (!config.terminalId) missing.push('terminalId (YAPIKREDI_TERMINAL_ID)');
    if (!config.posnetId) missing.push('posnetId (YAPIKREDI_POSNET_ID)');
    if (!config.encKey) missing.push('encKey (YAPIKREDI_ENC_KEY)');
    if (missing.length) throw new Error(`Yapı Kredi configuration is missing required fields:\n  - ${missing.join('\n  - ')}`);
  }

  private validateZiraatConfig(config: PaymentProviderConfig & {
    clientId: string; username: string; password: string; storeKey: string;
  }): void {
    const missing: string[] = [];
    if (!config.clientId) missing.push('clientId (ZIRAAT_CLIENT_ID)');
    if (!config.username) missing.push('username (ZIRAAT_USERNAME)');
    if (!config.password) missing.push('password (ZIRAAT_PASSWORD)');
    if (!config.storeKey) missing.push('storeKey (ZIRAAT_STORE_KEY)');
    if (missing.length) throw new Error(`Ziraat configuration is missing required fields:\n  - ${missing.join('\n  - ')}`);
  }

  private validateCoinbaseConfig(config: PaymentProviderConfig): void {
    if (!config.apiKey) {
      throw new Error('Coinbase configuration is missing required field: apiKey (COINBASE_COMMERCE_API_KEY)');
    }
  }

  private validatePolarConfig(config: PaymentProviderConfig): void {
    if (!config.apiKey) {
      throw new Error('Polar configuration is missing required field: apiKey (POLAR_ACCESS_TOKEN)');
    }
  }

  private validateLemonSqueezyConfig(config: PaymentProviderConfig & { storeId?: string }): void {
    const missing: string[] = [];
    if (!config.apiKey) missing.push('apiKey (LEMONSQUEEZY_API_KEY)');
    if (!config.storeId) missing.push('storeId (LEMONSQUEEZY_STORE_ID)');
    if (missing.length) {
      throw new Error(`Lemon Squeezy configuration is missing required fields:\n  - ${missing.join('\n  - ')}`);
    }
  }

  use(provider: ProviderType.IYZICO | 'iyzico'): Iyzico;
  use(provider: ProviderType.PAYTR | 'paytr'): PayTR;
  use(provider: ProviderType.AKBANK | 'akbank'): Akbank;
  use(provider: ProviderType.PARAMPOS | 'parampos'): Parampos;
  use(provider: ProviderType.STRIPE | 'stripe'): Stripe;
  use(provider: ProviderType.PAYPAL | 'paypal'): PayPal;
  use(provider: ProviderType.GARANTI | 'garanti'): Garanti;
  use(provider: ProviderType.ISBANK | 'isbank'): Isbank;
  use(provider: ProviderType.YAPIKREDI | 'yapikredi'): YapiKredi;
  use(provider: ProviderType.COINBASE | 'coinbase'): Coinbase;
  use(provider: ProviderType.POLAR | 'polar'): Polar;
  use(provider: ProviderType.LEMONSQUEEZY | 'lemonsqueezy'): LemonSqueezy;
  use(provider: ProviderType.ZIRAAT | 'ziraat'): Ziraat;
  use(provider: ProviderType | string): PaymentProvider;
  use(providerType: ProviderType | string): PaymentProvider {
    const provider = this.providers[providerType as ProviderType];
    if (!provider) {
      throw new ProviderNotEnabledError(providerType);
    }
    return provider;
  }

  private getDefaultProvider(): PaymentProvider {
    if (!this.defaultProvider) {
      throw new Error(
        'No default provider set. Please specify a provider using .use() method or set defaultProvider in configuration.',
      );
    }
    return this.use(this.defaultProvider);
  }

  getEnabledProviders(): ProviderType[] {
    return Object.keys(this.providers) as ProviderType[];
  }

  isProviderEnabled(providerType: ProviderType): boolean {
    return !!this.providers[providerType];
  }

  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    return this.getDefaultProvider().createPayment(request);
  }

  async initThreeDSPayment(request: ThreeDSPaymentRequest): Promise<ThreeDSInitResponse> {
    return this.getDefaultProvider().initThreeDSPayment(request);
  }

  async completeThreeDSPayment(callbackData: any): Promise<PaymentResponse> {
    return this.getDefaultProvider().completeThreeDSPayment(callbackData);
  }

  async refund(request: RefundRequest): Promise<RefundResponse> {
    return this.getDefaultProvider().refund(request);
  }

  async cancel(request: CancelRequest): Promise<CancelResponse> {
    return this.getDefaultProvider().cancel(request);
  }

  /**
   * Capture (post-auth) — `capture: false` ile başlatılmış bir provizyonu çeker.
   * Tutarı `amountMinor` ile kısmen çekebilirsiniz. Yalnızca pre-auth destekleyen
   * sağlayıcılarda (iyzico, Stripe) çalışır; diğerleri hata fırlatır.
   */
  async capturePayment(request: CaptureRequest): Promise<CaptureResponse> {
    return this.getDefaultProvider().capturePayment(request);
  }

  /**
   * Void — henüz capture edilmemiş bir provizyonu serbest bırakır.
   */
  async voidAuthorization(
    request: VoidAuthorizationRequest,
  ): Promise<VoidAuthorizationResponse> {
    return this.getDefaultProvider().voidAuthorization(request);
  }

  /**
   * Payout / Transfer — para-OUT, 3. tarafa. `request.provider` ile sağlayıcı
   * seçilebilir; verilmezse default provider kullanılır. Yalnızca payout
   * destekleyen sağlayıcılarda çalışır; diğerleri hata fırlatır.
   *
   * ⚠️ Gerçek para çıkışı custody/lisans gerektirir (bkz. PSP yol haritası).
   */
  async payout(request: PayoutRequest): Promise<PayoutResponse> {
    const provider = request.provider
      ? this.use(request.provider)
      : this.getDefaultProvider();
    return provider.payout(request);
  }

  async getPayment(paymentId: string): Promise<PaymentResponse> {
    return this.getDefaultProvider().getPayment(paymentId);
  }

  get iyzico(): Iyzico {
    const provider = this.providers[ProviderType.IYZICO];
    if (!provider) throw new ProviderNotEnabledError('iyzico');
    return provider as Iyzico;
  }

  get paytr(): PayTR {
    const provider = this.providers[ProviderType.PAYTR];
    if (!provider) throw new ProviderNotEnabledError('paytr');
    return provider as PayTR;
  }

  get akbank(): Akbank {
    const provider = this.providers[ProviderType.AKBANK];
    if (!provider) throw new ProviderNotEnabledError('akbank');
    return provider as Akbank;
  }

  get parampos(): Parampos {
    const provider = this.providers[ProviderType.PARAMPOS];
    if (!provider) throw new ProviderNotEnabledError('parampos');
    return provider as Parampos;
  }

  get stripe(): Stripe {
    const provider = this.providers[ProviderType.STRIPE];
    if (!provider) throw new ProviderNotEnabledError('stripe');
    return provider as Stripe;
  }

  get paypal(): PayPal {
    const provider = this.providers[ProviderType.PAYPAL];
    if (!provider) throw new ProviderNotEnabledError('paypal');
    return provider as PayPal;
  }

  get garanti(): Garanti {
    const provider = this.providers[ProviderType.GARANTI];
    if (!provider) throw new ProviderNotEnabledError('garanti');
    return provider as Garanti;
  }

  get isbank(): Isbank {
    const provider = this.providers[ProviderType.ISBANK];
    if (!provider) throw new ProviderNotEnabledError('isbank');
    return provider as Isbank;
  }

  get yapikredi(): YapiKredi {
    const provider = this.providers[ProviderType.YAPIKREDI];
    if (!provider) throw new ProviderNotEnabledError('yapikredi');
    return provider as YapiKredi;
  }

  get ziraat(): Ziraat {
    const provider = this.providers[ProviderType.ZIRAAT];
    if (!provider) throw new ProviderNotEnabledError('ziraat');
    return provider as Ziraat;
  }

  get coinbase(): Coinbase {
    const provider = this.providers[ProviderType.COINBASE];
    if (!provider) throw new ProviderNotEnabledError('coinbase');
    return provider as Coinbase;
  }

  get polar(): Polar {
    const provider = this.providers[ProviderType.POLAR];
    if (!provider) throw new ProviderNotEnabledError('polar');
    return provider as Polar;
  }

  get lemonsqueezy(): LemonSqueezy {
    const provider = this.providers[ProviderType.LEMONSQUEEZY];
    if (!provider) throw new ProviderNotEnabledError('lemonsqueezy');
    return provider as LemonSqueezy;
  }
}
