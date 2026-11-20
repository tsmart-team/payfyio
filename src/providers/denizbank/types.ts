/**
 * Denizbank InterVPos credentials. All four come from the bank's VPOS team.
 */
export interface DenizbankConfig {
  /** Mağaza kodu (ShopCode) */
  shopCode: string;
  /** API user (UserCode) */
  userCode: string;
  /** API user password (UserPass) — sent only on server-to-server calls, never in the 3D form */
  userPass: string;
  /** 3D store key (MerchantPass) — signs the 3D form and verifies the callback; never sent */
  merchantPass: string;
}

/**
 * What InterVPos POSTs to OkUrl/FailUrl, plus the values the merchant adds
 * from its own order record before calling `completeThreeDSPayment`.
 */
export interface Denizbank3DCallbackData {
  OrderId?: string;
  ShopCode?: string;
  PurchAmount?: string;
  Currency?: string;
  InstallmentCount?: string;
  '3DStatus'?: string;
  MD?: string;
  PayerTxnId?: string;
  Eci?: string;
  PayerAuthenticationCode?: string;
  ProcReturnCode?: string;
  ErrorMessage?: string;
  HASH?: string;
  HASHPARAMS?: string;
  HASHPARAMSVAL?: string;
  /**
   * REQUIRED — the order total from your own records ('100.00'). The charge
   * leg is sent with this amount; the callback's echoed amount is never used.
   */
  amount?: string | number;
  /** Order currency from your records (ISO alpha, default 'TRY'). */
  currency?: string;
  /** Your order id; when given, the callback's OrderId must equal it. */
  orderId?: string;
  [key: string]: unknown;
}
