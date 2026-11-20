export type QnbSecureType = '3DModel' | '3DPay';

/**
 * QNB (ex QNB Finansbank PayFor) virtual POS credentials, from the bank.
 */
export interface QnbConfig {
  /** Üye işyeri numarası (MerchantId) */
  merchantId: string;
  /** API user (UserCode) — also part of the callback ResponseHash */
  userCode: string;
  /** API user password (UserPass) — server-to-server only, never in the 3D form */
  userPass: string;
  /** 3D password (MerchantPass) — signs the form, verifies the callback; never sent */
  merchantPass: string;
  /**
   * The 3D model your merchant is set up for. Default '3DModel'.
   * - '3DModel': bank authenticates, you charge with `3DModelPayment`
   * - '3DPay': bank authenticates and charges; confirmed with `OrderInquiry`
   */
  secureType?: QnbSecureType;
}

/**
 * What QNB POSTs to OkUrl/FailUrl, plus values the merchant adds from its own
 * order record before calling `completeThreeDSPayment`.
 */
export interface Qnb3DCallbackData {
  OrderId?: string;
  MerchantID?: string;
  SecureType?: string;
  '3DStatus'?: string;
  RequestGuid?: string;
  PurchAmount?: string;
  Currency?: string;
  ProcReturnCode?: string;
  TxnResult?: string;
  ErrMsg?: string;
  AuthCode?: string;
  HostRefNum?: string;
  ResponseRnd?: string;
  ResponseHash?: string;
  /** Order total from your records ('100.00'), as sent at init (`paidPrice || price`). Recommended: when given, the posted and the bank-confirmed (OrderInquiry) amounts must equal it, in both 3D models. */
  amount?: string | number;
  /** Order currency from your records (ISO alpha, default 'TRY'). Used for the confirmation inquiry. */
  currency?: string;
  /** Your order id; when given, the callback's OrderId must equal it. */
  orderId?: string;
  [key: string]: unknown;
}
