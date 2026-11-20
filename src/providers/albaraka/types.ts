export interface AlbarakaConfig {
  merchantId: string;
  terminalId: string;
  posnetId: string;
  /** e-POS ENC key — only ever used for MACs, never sent. */
  encKey: string;
  /**
   * `MdStatus` values that get charged after 3D Secure. Default `['1']` (full
   * authentication). 2/3/4 are half-secure and can leave chargeback liability
   * with the merchant.
   */
  acceptedMdStatuses?: string[];
}

/**
 * What `completeThreeDSPayment` takes: the bank's POST to `MerchantReturnURL`
 * plus the order from the merchant's own records. The signed callback fields
 * don't include the order number or amount, so the charge is sent for the
 * values you pass here — spread the callback first so they win:
 * `{ ...callbackBody, orderId, amount, currency }`.
 */
export interface AlbarakaCallbackData {
  MdStatus?: string;
  MdErrorMessage?: string;
  SecureTransactionId?: string;
  CAVV?: string;
  ECI?: string;
  MD?: string;
  /** Colon-separated names of the fields the bank signed, e.g. `ECI:CAVV:MdStatus:…` */
  MacParams?: string;
  Mac?: string;
  /** Order number from your records = `paymentId` returned by `initThreeDSPayment`. */
  orderId?: string;
  /** Order amount from your records, decimal string ('100.00'). */
  amount?: string;
  /** Order currency from your records. Default TRY. */
  currency?: string;
  /** Installment count used at init. Default 1. */
  installment?: number | string;
  [key: string]: unknown;
}

/** JSON API answer (only the fields payfyio reads). */
export interface AlbarakaResponse {
  ServiceResponseData?: { ResponseCode?: string; ResponseDescription?: string };
  ReferenceCode?: string | null;
  AuthCode?: string | null;
  TransactionData?: unknown;
  [key: string]: unknown;
}
