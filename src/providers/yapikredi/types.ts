export interface YapiKrediConfig {
  merchantId: string;
  terminalId: string;
  posnetId: string;
  /** Posnet ENC key — only ever used for MACs, never sent. */
  encKey: string;
  /**
   * `mdStatus` values that get charged after 3D Secure. Default `['1']` (full
   * authentication). 2/3/4 are half-secure and can leave chargeback liability
   * with the merchant.
   */
  acceptedMdStatuses?: string[];
}

/**
 * What `completeThreeDSPayment` takes: the bank's POST to `merchantReturnURL`
 * plus the order from the merchant's own records. The callback carries the
 * order only encrypted, and the MAC is computed over the merchant's order
 * number + amount, so these two MUST come from your records — spread the
 * callback first so they win: `{ ...callbackBody, orderId, amount, currency }`.
 */
export interface YapiKrediCallbackData {
  MerchantPacket?: string;
  BankPacket?: string;
  Sign?: string;
  /** Order number from your records = `paymentId` returned by `initThreeDSPayment`. */
  orderId?: string;
  /** Order amount from your records, decimal string ('100.00'). */
  amount?: string;
  /** Order currency from your records. Default TRY. */
  currency?: string;
  [key: string]: unknown;
}
