export { PaymentStatus } from './common';
import { PaymentStatus } from './common';

/**
 * Para birimi
 */
export enum Currency {
  TRY = 'TRY',
  USD = 'USD',
  EUR = 'EUR',
  GBP = 'GBP',
}

/**
 * Ödeme kartı bilgileri
 */
export interface PaymentCard {
  cardHolderName: string;
  cardNumber: string;
  expireMonth: string;
  expireYear: string;
  cvc: string;
  registerCard?: boolean;
}

/**
 * Alıcı bilgileri
 */
export interface Buyer {
  id: string;
  name: string;
  surname: string;
  email: string;
  identityNumber: string;
  registrationAddress: string;
  city: string;
  country: string;
  zipCode?: string;
  ip: string;
  gsmNumber: string;
}

/**
 * Adres bilgileri
 */
export interface Address {
  contactName: string;
  city: string;
  country: string;
  address: string;
  zipCode?: string;
}

/**
 * Sepet item tipi
 */
export enum BasketItemType {
  PHYSICAL = 'PHYSICAL',
  VIRTUAL = 'VIRTUAL',
}

/**
 * Sepet item
 */
export interface BasketItem {
  id: string;
  name: string;
  category1: string;
  category2?: string;
  itemType: BasketItemType | string;
  price: string;
}

/**
 * Ödeme isteği parametreleri
 */
export interface PaymentRequest {
  price: string;
  paidPrice: string;
  currency: Currency | string;
  basketId: string;
  paymentCard: PaymentCard;
  buyer: Buyer;
  shippingAddress: Address;
  billingAddress: Address;
  basketItems: BasketItem[];
  callbackUrl?: string;
  conversationId?: string;
  /**
   * When `false`, only authorizes (pre-auth/provision) — the funds are held on
   * the issuer but not captured. Complete the charge later with
   * `capturePayment`, or release it with `voidAuthorization`. Defaults to
   * `true` (immediate capture). Only honored by providers that support
   * pre-auth (iyzico, Stripe); others ignore it and capture immediately.
   */
  capture?: boolean;
  /** Prevents the same charge from being processed twice. Mapped to the provider's native idempotency key; ignored by providers that lack one. */
  idempotencyKey?: string;
  /**
   * Marketplace split — tutarın bir kısmını alt-satıcılara yönlendirir. PSP
   * parayı tutup böler (custody'siz escrow + komisyon split tek hamlede). Yalnızca
   * submerchant/Connect destekleyen sağlayıcılar (iyzico, Stripe) dikkate alır.
   */
  split?: PaymentSplitItem[];
  /**
   * Platform komisyonu (minor-unit) — split'te platformda kalan tutar. Stripe'da
   * `application_fee_amount`'a, iyzico'da kalem-bazlı komisyon hesabına map'lenir.
   */
  platformCommissionMinor?: number;
}

/**
 * Ödeme yanıtı
 */
export interface PaymentResponse {
  status: PaymentStatus;
  paymentId?: string;
  conversationId?: string;
  errorCode?: string;
  errorMessage?: string;
  errorGroup?: string;
  rawResponse?: any;
}

/**
 * 3D Secure ödeme isteği
 */
export interface ThreeDSPaymentRequest extends PaymentRequest {
  callbackUrl: string;
  installment?: number;
}

/**
 * 3D Secure ödeme başlatma yanıtı
 */
export interface ThreeDSInitResponse {
  status: PaymentStatus;
  threeDSHtmlContent?: string;
  paymentId?: string;
  conversationId?: string;
  errorCode?: string;
  errorMessage?: string;
  rawResponse?: any;
}

/**
 * İade isteği
 */
export interface RefundRequest {
  paymentId: string;
  price: string;
  currency: Currency | string;
  ip: string;
  conversationId?: string;
  /** Aynı iadenin iki kez işlenmesini önler; provider native key'ine map'lenir, desteklemeyen yok sayar. */
  idempotencyKey?: string;
}

/**
 * İade yanıtı
 */
export interface RefundResponse {
  status: PaymentStatus;
  refundId?: string;
  conversationId?: string;
  errorCode?: string;
  errorMessage?: string;
  rawResponse?: any;
}

/**
 * İptal isteği
 */
export interface CancelRequest {
  paymentId: string;
  ip: string;
  conversationId?: string;
  /** Aynı iptalin iki kez işlenmesini önler; provider native key'ine map'lenir, desteklemeyen yok sayar. */
  idempotencyKey?: string;
}

/**
 * İptal yanıtı
 */
export interface CancelResponse {
  status: PaymentStatus;
  transactionId?: string;
  voidId?: string;
  conversationId?: string;
  errorCode?: string;
  errorMessage?: string;
  rawResponse?: unknown;
}

/**
 * Capture (post-auth) isteği — bir pre-auth (provizyon) ile tutulan tutarın
 * tamamını veya bir kısmını çeker. Karşılığı: iyzico PostAuth, Stripe manual
 * capture. Yalnızca `capture: false` ile başlatılmış ödemeler için geçerlidir.
 */
export interface CaptureRequest {
  paymentId: string;
  /**
   * Kısmi capture için minor-unit (kuruş/cent) tutar. Verilmezse provizyonun
   * tamamı çekilir. Provizyondan büyük olamaz.
   */
  amountMinor?: number;
  /** `amountMinor` verildiğinde minor-unit dönüşümü için gerekir. */
  currency?: Currency | string;
  ip?: string;
  conversationId?: string;
  /** Aynı capture'ın iki kez işlenmesini önler; provider native key'ine map'lenir. */
  idempotencyKey?: string;
}

/**
 * Capture (post-auth) yanıtı.
 */
export interface CaptureResponse {
  status: PaymentStatus;
  paymentId?: string;
  /** Gerçekte çekilen minor-unit tutar (kısmi capture'da istenenle aynı olur). */
  capturedAmountMinor?: number;
  currency?: string;
  conversationId?: string;
  errorCode?: string;
  errorMessage?: string;
  rawResponse?: unknown;
}

/**
 * Void (provizyon iptali) isteği — henüz capture edilmemiş bir pre-auth'u
 * serbest bırakır; tutulan tutar müşteriye geri açılır. Capture edilmiş bir
 * ödeme için `refund` kullanın.
 */
export interface VoidAuthorizationRequest {
  paymentId: string;
  ip?: string;
  conversationId?: string;
  /** Aynı void'in iki kez işlenmesini önler; provider native key'ine map'lenir. */
  idempotencyKey?: string;
}

/**
 * Void (provizyon iptali) yanıtı.
 */
export interface VoidAuthorizationResponse {
  status: PaymentStatus;
  paymentId?: string;
  voidId?: string;
  conversationId?: string;
  errorCode?: string;
  errorMessage?: string;
  rawResponse?: unknown;
}

/**
 * Payout hedefi — para 3. tarafa ya bir IBAN/banka hesabına ya da sağlayıcı
 * tarafındaki bir bağlı hesaba/alt-satıcıya (connected account / submerchant)
 * gönderilir.
 */
export type PayoutDestination =
  | { iban: string; name?: string }
  | { accountId: string };

/**
 * Payout / Transfer isteği — para-OUT, 3. tarafa (carrier/satıcı). `refund`
 * yalnızca ödeyene döner; bu primitif platformdan başka bir tarafa ödeme yapar.
 *
 * ⚠️ Gerçek para çıkışı custody/lisans gerektirir (bkz.
 * docs/PSP-DONUSUM-YOL-HARITASI.md). Kütüphane yüzeyi hazırdır; etkinleştirme
 * lisanslı sağlayıcı/sponsor banka anlaşmasına bağlıdır.
 */
export interface PayoutRequest {
  /** Default provider dışında bir sağlayıcı kullanılacaksa (provider adı). */
  provider?: string;
  to: PayoutDestination;
  /** Minor-unit (kuruş/cent) tutar. */
  amountMinor: number;
  currency: Currency | string;
  /** Mutabakat/ledger referansı (idempotency'den ayrı). */
  reference: string;
  description?: string;
  /** Aynı payout'un iki kez gönderilmesini önler; provider native key'ine map'lenir. */
  idempotencyKey?: string;
}

/**
 * Payout / Transfer yanıtı.
 */
export interface PayoutResponse {
  status: PaymentStatus;
  payoutId?: string;
  /** Gönderilen minor-unit tutar. */
  amountMinor?: number;
  currency?: string;
  reference?: string;
  errorCode?: string;
  errorMessage?: string;
  rawResponse?: unknown;
}

/**
 * Alt-satıcı (submerchant / connected account) türü. iyzico bu sınıflandırmayı
 * KYC için ister; Stripe Connect'te karşılığı hesap tipi/iş bilgisidir.
 */
export type SubmerchantType =
  | 'PERSONAL'
  | 'PRIVATE_COMPANY'
  | 'LIMITED_OR_JOINT_STOCK_COMPANY'
  | string;

/**
 * Alt-satıcı oluşturma isteği — pazar yerinde paranın bölüneceği 3. taraf
 * (carrier/satıcı). PSP parayı tutup bu tarafa hak edişini öder.
 */
export interface SubmerchantCreateRequest {
  type: SubmerchantType;
  name: string;
  email: string;
  /** Bizim tarafımızdaki kalıcı kimlik (carrier id); idempotent eşleme için. */
  externalId: string;
  gsmNumber?: string;
  /** Hak edişin yatırılacağı IBAN. */
  iban?: string;
  address?: string;
  /** Tüzel kişi alt-satıcılar için. */
  legalCompanyTitle?: string;
  taxOffice?: string;
  taxNumber?: string;
  /** Şahıs alt-satıcılar için. */
  identityNumber?: string;
  currency?: Currency | string;
  conversationId?: string;
}

/**
 * Alt-satıcı güncelleme isteği — `submerchantKey` (provider referansı) zorunlu;
 * değiştirilecek alanlar opsiyonel.
 */
export interface SubmerchantUpdateRequest extends Partial<SubmerchantCreateRequest> {
  /** Provider tarafındaki alt-satıcı referansı (create yanıtından). */
  submerchantKey: string;
}

/**
 * Alt-satıcı yanıtı.
 */
export interface SubmerchantResponse {
  status: PaymentStatus;
  /** Provider tarafı alt-satıcı referansı; sonraki split/payout çağrılarında kullanılır. */
  submerchantKey?: string;
  externalId?: string;
  conversationId?: string;
  errorCode?: string;
  errorMessage?: string;
  rawResponse?: unknown;
}

/**
 * Ödeme bölme kalemi — tutarın bir kısmı bir alt-satıcıya yönlendirilir.
 */
export interface PaymentSplitItem {
  /** Alt-satıcı referansı (`SubmerchantResponse.submerchantKey`). */
  submerchantId: string;
  /** Bu alt-satıcıya gidecek minor-unit tutar. */
  amountMinor: number;
}

/**
 * BIN sorgulama yanıtı
 */
export interface BinCheckResponse {
  binNumber: string;
  cardType: string;
  cardAssociation: string;
  cardFamily: string;
  bankName: string;
  bankCode: number;
  commercial: boolean;
  rawResponse?: unknown;
}

/**
 * Checkout Form isteği
 */
export interface CheckoutFormRequest {
  price: string;
  paidPrice: string;
  currency: Currency | string;
  basketId: string;
  callbackUrl: string;
  enabledInstallments?: number[];
  buyer: Buyer;
  shippingAddress: Address;
  billingAddress: Address;
  basketItems: BasketItem[];
  conversationId?: string;
}

/**
 * Checkout Form başlatma yanıtı
 */
export interface CheckoutFormInitResponse {
  status: PaymentStatus;
  checkoutFormContent?: string;
  paymentPageUrl?: string;
  token?: string;
  tokenExpireTime?: number;
  conversationId?: string;
  errorCode?: string;
  errorMessage?: string;
  rawResponse?: any;
}

/**
 * Checkout Form sonuç yanıtı
 */
export interface CheckoutFormRetrieveResponse {
  status: PaymentStatus;
  paymentId?: string;
  paymentStatus?: string;
  price?: number;
  paidPrice?: number;
  currency?: string;
  basketId?: string;
  installment?: number;
  binNumber?: string;
  lastFourDigits?: string;
  cardType?: string;
  cardAssociation?: string;
  cardFamily?: string;
  cardToken?: string;
  cardUserKey?: string;
  fraudStatus?: number;
  merchantCommissionRate?: number;
  merchantCommissionRateAmount?: number;
  iyziCommissionRateAmount?: number;
  iyziCommissionFee?: number;
  paymentTransactionId?: string;
  conversationId?: string;
  errorCode?: string;
  errorMessage?: string;
  rawResponse?: any;
}

/**
 * PWI (Payment With IBAN - Korumalı Havale/EFT) İsteği
 */
export interface PWIPaymentRequest {
  price: string;
  paidPrice: string;
  currency: Currency | string;
  basketId: string;
  callbackUrl: string;
  buyer: Buyer;
  shippingAddress: Address;
  billingAddress: Address;
  basketItems: BasketItem[];
  conversationId?: string;
}

/**
 * PWI Ödeme Başlatma Yanıtı
 */
export interface PWIPaymentInitResponse {
  status: PaymentStatus;
  htmlContent?: string; // Müşteriye gösterilecek HTML içeriği
  token?: string;
  tokenExpireTime?: number;
  paymentPageUrl?: string; // Ödeme sayfası URL'i
  conversationId?: string;
  errorCode?: string;
  errorMessage?: string;
  rawResponse?: any;
}

/**
 * PWI Ödeme Durumu
 */
export enum PWIPaymentStatus {
  WAITING = 'WAITING', // Havale bekleniyor
  SUCCESS = 'SUCCESS', // Havale başarılı
  FAILURE = 'FAILURE', // Havale başarısız/iptal edildi
}

/**
 * PWI Ödeme Sorgulama Yanıtı
 */
export interface PWIPaymentRetrieveResponse {
  status: PaymentStatus;
  token?: string;
  callbackUrl?: string;
  paymentStatus?: PWIPaymentStatus | string;
  paymentId?: string;
  price?: number;
  paidPrice?: number;
  currency?: string;
  basketId?: string;
  merchantCommissionRate?: number;
  merchantCommissionRateAmount?: number;
  iyziCommissionRateAmount?: number;
  iyziCommissionFee?: number;
  iban?: string; // Havale yapılacak IBAN
  bankName?: string; // Banka adı
  buyerName?: string;
  buyerSurname?: string;
  buyerEmail?: string;
  conversationId?: string;
  errorCode?: string;
  errorMessage?: string;
  rawResponse?: any;
}

/**
 * Taksit Detay Bilgisi
 */
export interface InstallmentDetail {
  installmentNumber: number; // Taksit sayısı (1 = tek çekim)
  totalPrice: number; // Toplam tutar
  installmentPrice: number; // Taksit başına tutar
}

/**
 * Taksit Bilgisi (Banka Bazında)
 */
export interface InstallmentPrice {
  binNumber: string; // Kart BIN numarası
  price: number; // Fiyat
  cardType: string; // Kart tipi (CREDIT_CARD, DEBIT_CARD)
  cardAssociation: string; // Kart kuruluşu (VISA, MASTER_CARD, TROY, AMEX)
  cardFamilyName: string; // Kart ailesi adı (Bonus, Maximum, Axess, World, vb.)
  force3ds?: number; // 3DS zorunluluğu (0: hayır, 1: evet)
  bankCode: number; // Banka kodu
  bankName: string; // Banka adı
  forceCvc?: number; // CVC zorunluluğu (0: hayır, 1: evet)
  commercial: number; // Ticari kart mı (0: hayır, 1: evet)
  installmentPrices: InstallmentDetail[]; // Taksit detayları
}

/**
 * Taksit Sorgulama İsteği
 */
export interface InstallmentInfoRequest {
  binNumber: string; // Kredi kartı BIN numarası (ilk 6-8 hane)
  price: string; // Ödeme tutarı
  conversationId?: string; // İsteğe bağlı conversation ID
}

/**
 * Taksit Sorgulama Yanıtı
 */
export interface InstallmentInfoResponse {
  status: PaymentStatus;
  installmentDetails?: InstallmentPrice[]; // Taksit detayları
  conversationId?: string;
  errorCode?: string;
  errorMessage?: string;
  rawResponse?: any;
}

/**
 * Normalize edilmiş webhook olayı — tüm sağlayıcıların kendi olay tiplerinden
 * tek bir ayrık (discriminated) union'a indirgenmiş hali. `type` ile ayrışır;
 * her zaman ham gövde `raw`'da taşınır. Ledger mutabakatı bunun üstüne kurulur.
 */
export type PayfyioEvent =
  | { type: 'payment.succeeded'; provider: string; paymentId: string; amountMinor?: number; currency?: string; raw: unknown }
  | { type: 'payment.failed'; provider: string; paymentId: string; reason?: string; raw: unknown }
  | { type: 'payment.pending'; provider: string; paymentId: string; raw: unknown }
  | { type: 'payment.cancelled'; provider: string; paymentId: string; raw: unknown }
  | { type: 'refund.completed'; provider: string; paymentId?: string; refundId?: string; amountMinor?: number; raw: unknown }
  | { type: 'subscription.renewed'; provider: string; subscriptionId: string; raw: unknown }
  | { type: 'subscription.canceled'; provider: string; subscriptionId: string; raw: unknown }
  | { type: 'payout.paid'; provider: string; payoutId: string; amountMinor?: number; raw: unknown }
  | { type: 'payout.failed'; provider: string; payoutId: string; raw: unknown }
  | { type: 'dispute.opened'; provider: string; paymentId?: string; disputeId?: string; raw: unknown }
  | { type: 'unknown'; provider: string; raw: unknown };

// Export subscription types
export * from './subscription';
