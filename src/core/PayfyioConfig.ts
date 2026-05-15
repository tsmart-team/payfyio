import { PaymentProviderConfig } from './PaymentProvider';
import type { PayfyioLogger } from './logger';
import type { RetryConfig } from './retry';
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
    secure3DStoreKey?: string;
  };
}

/**
 * İş Bankası NestPay provider config.
 */
export interface IsbankProviderConfig {
  enabled: boolean;
  config: PaymentProviderConfig & {
    clientId: string;
    username: string;
    password: string;
    storeKey: string;
  };
}

/**
 * Yapı Kredi Posnet provider config.
 */
export interface YapiKrediProviderConfig {
  enabled: boolean;
  config: PaymentProviderConfig & {
    merchantId: string;
    terminalId: string;
    posnetId: string;
    encKey: string;
  };
}

/**
 * Ziraat NestPay provider config.
 */
export interface ZiraatProviderConfig {
  enabled: boolean;
  config: PaymentProviderConfig & {
    clientId: string;
    username: string;
    password: string;
    storeKey: string;
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
  };
  defaultProvider?: ProviderType;
  mode?: 'sandbox' | 'production';
  logger?: PayfyioLogger;
  retry?: RetryConfig;
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
    production: 'https://sanalposprov.garantibbva.com.tr',
  },
  [ProviderType.ISBANK]: {
    sandbox: 'https://entegrasyon.asseco-see.com.tr',
    production: 'https://spos.isbank.com.tr',
  },
  [ProviderType.YAPIKREDI]: {
    sandbox: 'https://setmpos.ykb.com',
    production: 'https://posnet.ykb.com',
  },
  [ProviderType.ZIRAAT]: {
    sandbox: 'https://preprod.ziraatpay.com.tr',
    production: 'https://sanalpos2.ziraatbank.com.tr',
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
}
