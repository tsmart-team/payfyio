import { PaymentProviderConfig } from './PaymentProvider';
import type { PayfyioLogger } from './logger';
import type { RetryConfig } from './retry';
import type { SecurityEventHandler } from './security';
export type { RetryConfig } from './retry';
import type { Iyzico } from '../providers/iyzico';
import type { PayTR } from '../providers/paytr';
import type { Akbank } from '../providers/akbank';
import type { Parampos } from '../providers/parampos';
import type { Stripe } from '../providers/stripe';
import type { PayPal } from '../providers/paypal';
import type { Garanti } from '../providers/garanti';
import type { Isbank } from '../providers/isbank';
import type { YapiKredi } from '../providers/yapikredi';
import type { Ziraat } from '../providers/ziraat';
import type { Est } from '../providers/est';
import type { Sipay, QnbPay } from '../providers/sipay';
import type { SipayConfig } from '../providers/sipay/types';
import type { Qnb } from '../providers/qnb';
import type { QnbConfig } from '../providers/qnb/types';
import type { Denizbank } from '../providers/denizbank';
import type { DenizbankConfig } from '../providers/denizbank/types';
import type { VakifBank } from '../providers/vakifbank';
import type { VakifBankConfig } from '../providers/vakifbank/types';
import type { KuveytTurk } from '../providers/kuveytturk';
import type { KuveytTurkConfig } from '../providers/kuveytturk/types';
import type { Albaraka } from '../providers/albaraka';
import type { YapiKrediConfig } from '../providers/yapikredi/types';
import type { AlbarakaConfig } from '../providers/albaraka/types';
import type { EstConfig } from '../providers/est/types';
import type { Coinbase } from '../providers/coinbase';
import type { Polar } from '../providers/polar';
import type { LemonSqueezy } from '../providers/lemonsqueezy';

/**
 * Provider türleri
 */
export enum ProviderType {
  IYZICO = 'iyzico',
  PAYTR = 'paytr',
  AKBANK = 'akbank',
  PARAMPOS = 'parampos',
  STRIPE = 'stripe',
  PAYPAL = 'paypal',
  GARANTI = 'garanti',
  ISBANK = 'isbank',
  YAPIKREDI = 'yapikredi',
  ZIRAAT = 'ziraat',
  HALKBANK = 'halkbank',
  TEB = 'teb',
  SEKERBANK = 'sekerbank',
  ALBARAKA = 'albaraka',
  SIPAY = 'sipay',
  QNBPAY = 'qnbpay',
  QNB = 'qnb',
  DENIZBANK = 'denizbank',
  VAKIFBANK = 'vakifbank',
  KUVEYTTURK = 'kuveytturk',
  COINBASE = 'coinbase',
  POLAR = 'polar',
  LEMONSQUEEZY = 'lemonsqueezy',
}

/**
 * İyzico provider config
 */
export interface IyzicoProviderConfig {
  enabled: boolean;
  config: PaymentProviderConfig;
}

/**
 * PayTR provider config (ek alanlar gerekiyor)
 */
export interface PayTRProviderConfig {
  enabled: boolean;
  config: PaymentProviderConfig & {
    merchantId: string;
    merchantSalt: string;
  };
}

/**
 * Akbank provider config (ek alanlar gerekiyor)
 */
export interface AkbankProviderConfig {
  enabled: boolean;
  config: PaymentProviderConfig & {
    merchantId: string;
    terminalId: string;
    storeKey: string;
    secure3DStoreKey?: string;
    testMode?: boolean;
  };
}

/**
 * Parampos provider config (ek alanlar gerekiyor)
 */
export interface ParamposProviderConfig {
  enabled: boolean;
  config: PaymentProviderConfig & {
    clientCode: string;
    clientUsername: string;
    clientPassword: string;
    guid: string;
    testMode?: boolean;
  };
}

/**
 * Stripe provider config — secretKey is `sk_test_…` / `sk_live_…`. apiKey is unused but
 * carried via PaymentProviderConfig for shape consistency.
 */
export interface StripeProviderConfig {
  enabled: boolean;
  config: PaymentProviderConfig & {
    apiVersion?: string;
  };
}

/**
 * PayPal provider config — apiKey is the OAuth client_id, secretKey is the client_secret.
 */
export interface PayPalProviderConfig {
  enabled: boolean;
  config: PaymentProviderConfig & {
    clientId?: string;
  };
}

/**
 * Garanti BBVA (GVP) provider config.
 */
export interface GarantiProviderConfig {
  enabled: boolean;
  config: PaymentProviderConfig & {
    merchantId: string;
    terminalId: string;
    provisionUser: string;
    provisionPassword: string;
    storeKey: string;
    /** Password of the PROVRFN provision user. Defaults to `provisionPassword`. */
    refundPassword?: string;
    /** Only set this if the bank issued a separate 3D key; defaults to `storeKey`. */
    secure3DStoreKey?: string;
  };
}

/**
 * EST (Asseco/NestPay) bank config — İş Bankası, Ziraat, Halkbank, TEB, Şekerbank.
 */
export interface EstProviderConfig {
  enabled: boolean;
  config: PaymentProviderConfig & EstConfig;
}

/** İş Bankası (EST). */
export type IsbankProviderConfig = EstProviderConfig;

/**
 * Yapı Kredi Posnet provider config.
 */
export interface YapiKrediProviderConfig {
  enabled: boolean;
  config: PaymentProviderConfig & YapiKrediConfig;
}

/**
 * Albaraka Türk e-POS (Posnet JSON API) provider config.
 */
export interface AlbarakaProviderConfig {
  enabled: boolean;
  config: PaymentProviderConfig & AlbarakaConfig;
}

/** KuveytTurk provider config. */
export interface KuveytTurkProviderConfig {
  enabled: boolean;
  config: PaymentProviderConfig & KuveytTurkConfig;
}

/** VakifBank provider config. */
export interface VakifBankProviderConfig {
  enabled: boolean;
  config: PaymentProviderConfig & VakifBankConfig;
}

/** Denizbank provider config. */
export interface DenizbankProviderConfig {
  enabled: boolean;
  config: PaymentProviderConfig & DenizbankConfig;
}

/** Qnb provider config. */
export interface QnbProviderConfig {
  enabled: boolean;
  config: PaymentProviderConfig & QnbConfig;
}

/** Sipay provider config. */
export interface SipayProviderConfig {
  enabled: boolean;
  config: PaymentProviderConfig & SipayConfig;
}

/** Ziraat Bankası (EST). */
export type ZiraatProviderConfig = EstProviderConfig;

/**
 * Coinbase Commerce — hosted crypto checkout (BTC, ETH, USDC, …).
 * apiKey is the Commerce API key; webhookSecret is the shared secret used
 * to verify X-CC-Webhook-Signature on incoming charge webhooks.
 */
export interface CoinbaseProviderConfig {
  enabled: boolean;
  config: PaymentProviderConfig & {
    webhookSecret?: string;
  };
}

/**
 * Polar.sh — hosted checkout for digital products / subscriptions.
 * apiKey is the organization access token; webhookSecret is the endpoint
 * secret (`whsec_…`) used to verify Standard-Webhooks signatures.
 * productId is the default Polar product to bill against (callers can
 * override per-request via metadata.product_id).
 */
export interface PolarProviderConfig {
  enabled: boolean;
  config: PaymentProviderConfig & {
    productId?: string;
    webhookSecret?: string;
  };
}

/**
 * Lemon Squeezy — hosted checkout for digital products / subscriptions
 * with merchant-of-record tax handling.
 * apiKey is the API key from My Account → API. storeId + variantId
 * identify which store and product variant to bill. webhookSecret is the
 * endpoint secret used to verify the X-Signature header.
 */
export interface LemonSqueezyProviderConfig {
  enabled: boolean;
  config: PaymentProviderConfig & {
    storeId?: string;
    variantId?: string;
    webhookSecret?: string;
  };
}

/**
 * Her provider için config (generic type)
 */
export interface ProviderConfig {
  enabled: boolean;
  config:
    | PaymentProviderConfig
    | (PaymentProviderConfig & { merchantId: string; merchantSalt: string })
    | (PaymentProviderConfig & {
        merchantId: string;
        terminalId: string;
        storeKey: string;
        secure3DStoreKey?: string;
        testMode?: boolean;
      })
    | (PaymentProviderConfig & {
        clientCode: string;
        clientUsername: string;
        clientPassword: string;
        guid: string;
        testMode?: boolean;
      });
}

export interface PayfyioConfig {
  providers: {
    [ProviderType.IYZICO]?: IyzicoProviderConfig;
    [ProviderType.PAYTR]?: PayTRProviderConfig;
    [ProviderType.AKBANK]?: AkbankProviderConfig;
    [ProviderType.PARAMPOS]?: ParamposProviderConfig;
    [ProviderType.STRIPE]?: StripeProviderConfig;
    [ProviderType.PAYPAL]?: PayPalProviderConfig;
    [ProviderType.GARANTI]?: GarantiProviderConfig;
    [ProviderType.ISBANK]?: IsbankProviderConfig;
    [ProviderType.YAPIKREDI]?: YapiKrediProviderConfig;
    [ProviderType.ZIRAAT]?: ZiraatProviderConfig;
    [ProviderType.HALKBANK]?: EstProviderConfig;
    [ProviderType.TEB]?: EstProviderConfig;
    [ProviderType.SEKERBANK]?: EstProviderConfig;
    [ProviderType.ALBARAKA]?: AlbarakaProviderConfig;
    [ProviderType.SIPAY]?: SipayProviderConfig;
    /** QNBpay runs on Sipay's platform; `brand` is pinned to 'qnbpay'. */
    [ProviderType.QNBPAY]?: SipayProviderConfig;
    [ProviderType.QNB]?: QnbProviderConfig;
    [ProviderType.DENIZBANK]?: DenizbankProviderConfig;
    [ProviderType.VAKIFBANK]?: VakifBankProviderConfig;
    [ProviderType.KUVEYTTURK]?: KuveytTurkProviderConfig;
    [ProviderType.COINBASE]?: CoinbaseProviderConfig;
    [ProviderType.POLAR]?: PolarProviderConfig;
    [ProviderType.LEMONSQUEEZY]?: LemonSqueezyProviderConfig;
  };
  defaultProvider?: ProviderType;
  mode?: 'sandbox' | 'production';
  logger?: PayfyioLogger;
  retry?: RetryConfig;
  /**
   * Called for every security-relevant signal (forged callback, repeated
   * provider errors, misconfiguration). Runs on your infrastructure; payfyio
   * never sends data anywhere itself. Best-effort — throwing here cannot break
   * a payment. Combine with `securityNotifiers` for ready-made handlers.
   */
  onSecurityEvent?: SecurityEventHandler;
  /**
   * Additional security event handlers (e.g. `webhookNotifier(...)`,
   * `consoleNotifier(...)`). Invoked alongside `onSecurityEvent`.
   */
  securityNotifiers?: SecurityEventHandler[];
}

export const PROVIDER_DEFAULT_URLS: Record<string, Record<string, string>> = {
  [ProviderType.IYZICO]: {
    sandbox: 'https://sandbox-api.iyzipay.com',
    production: 'https://api.iyzipay.com',
  },
  [ProviderType.PAYTR]: {
    sandbox: 'https://www.paytr.com',
    production: 'https://www.paytr.com',
  },
  [ProviderType.AKBANK]: {
    sandbox: 'https://entegrasyon.akbank.com',
    production: 'https://apiprod.akbank.com',
  },
  [ProviderType.PARAMPOS]: {
    sandbox: 'https://testposws.param.com.tr/turkpos.ws/service_turkpos_prod.asmx',
    production: 'https://posws.param.com.tr/turkpos.ws/service_turkpos_prod.asmx',
  },
  [ProviderType.STRIPE]: {
    sandbox: 'https://api.stripe.com',
    production: 'https://api.stripe.com',
  },
  [ProviderType.PAYPAL]: {
    sandbox: 'https://api-m.sandbox.paypal.com',
    production: 'https://api-m.paypal.com',
  },
  [ProviderType.GARANTI]: {
    sandbox: 'https://sanalposprovtest.garantibbva.com.tr',
    // DİKKAT: production host'ta "bbva" YOK. Bankanın dokümanı bu adresi
    // veriyor; garantibbva.com.tr varyantı canlıda çalışmıyor.
    production: 'https://sanalposprov.garanti.com.tr',
  },
  [ProviderType.ISBANK]: {
    sandbox: 'https://entegrasyon.asseco-see.com.tr',
    production: 'https://sanalpos.isbank.com.tr',
  },
  [ProviderType.YAPIKREDI]: {
    sandbox: 'https://setmpos.ykb.com',
    production: 'https://posnet.yapikredi.com.tr',
  },
  [ProviderType.KUVEYTTURK]: {
    sandbox: 'https://boatest.kuveytturk.com.tr/boa.virtualpos.services',
    production: 'https://sanalpos.kuveytturk.com.tr/ServiceGateWay',
  },
  [ProviderType.VAKIFBANK]: {
    sandbox: 'https://onlineodemetest.vakifbank.com.tr:4443',
    production: 'https://onlineodeme.vakifbank.com.tr:4443',
  },
  [ProviderType.DENIZBANK]: {
    sandbox: 'https://test.inter-vpos.com.tr',
    production: 'https://inter-vpos.com.tr',
  },
  [ProviderType.QNB]: {
    sandbox: 'https://vpostest.qnb.com.tr',
    production: 'https://vpos.qnb.com.tr',
  },
  [ProviderType.QNBPAY]: {
    sandbox: 'https://test.qnbpay.com.tr',
    production: 'https://portal.qnbpay.com.tr',
  },
  [ProviderType.SIPAY]: {
    sandbox: 'https://provisioning.sipay.com.tr',
    production: 'https://app.sipay.com.tr',
  },
  [ProviderType.ALBARAKA]: {
    sandbox: 'https://epostest.albarakaturk.com.tr',
    production: 'https://epos.albarakaturk.com.tr',
  },
  // EST bankaları Asseco'nun ortak test host'unu kullanır.
  [ProviderType.ZIRAAT]: {
    sandbox: 'https://entegrasyon.asseco-see.com.tr',
    production: 'https://sanalpos2.ziraatbank.com.tr',
  },
  [ProviderType.HALKBANK]: {
    sandbox: 'https://entegrasyon.asseco-see.com.tr',
    production: 'https://sanalpos.halkbank.com.tr',
  },
  [ProviderType.TEB]: {
    sandbox: 'https://entegrasyon.asseco-see.com.tr',
    production: 'https://sanalpos.teb.com.tr',
  },
  [ProviderType.SEKERBANK]: {
    sandbox: 'https://entegrasyon.asseco-see.com.tr',
    production: 'https://sanalpos.sekerbank.com.tr',
  },
  [ProviderType.COINBASE]: {
    sandbox: 'https://api.commerce.coinbase.com',
    production: 'https://api.commerce.coinbase.com',
  },
  [ProviderType.POLAR]: {
    sandbox: 'https://sandbox-api.polar.sh',
    production: 'https://api.polar.sh',
  },
  [ProviderType.LEMONSQUEEZY]: {
    // Lemon Squeezy uses the same host for live and test — the API key prefix
    // (test_… vs prod) plus the store's test mode toggle determine routing.
    sandbox: 'https://api.lemonsqueezy.com',
    production: 'https://api.lemonsqueezy.com',
  },
};

/**
 * Provider instance map
 */
export interface ProviderInstances {
  [ProviderType.IYZICO]?: Iyzico;
  [ProviderType.PAYTR]?: PayTR;
  [ProviderType.AKBANK]?: Akbank;
  [ProviderType.PARAMPOS]?: Parampos;
  [ProviderType.STRIPE]?: Stripe;
  [ProviderType.PAYPAL]?: PayPal;
  [ProviderType.GARANTI]?: Garanti;
  [ProviderType.ISBANK]?: Isbank;
  [ProviderType.YAPIKREDI]?: YapiKredi;
  [ProviderType.ZIRAAT]?: Ziraat;
  [ProviderType.HALKBANK]?: Est;
  [ProviderType.TEB]?: Est;
  [ProviderType.SEKERBANK]?: Est;
  [ProviderType.ALBARAKA]?: Albaraka;
  [ProviderType.SIPAY]?: Sipay;
  [ProviderType.QNBPAY]?: QnbPay;
  [ProviderType.QNB]?: Qnb;
  [ProviderType.DENIZBANK]?: Denizbank;
  [ProviderType.VAKIFBANK]?: VakifBank;
  [ProviderType.KUVEYTTURK]?: KuveytTurk;
  [ProviderType.COINBASE]?: Coinbase;
  [ProviderType.POLAR]?: Polar;
  [ProviderType.LEMONSQUEEZY]?: LemonSqueezy;
}
