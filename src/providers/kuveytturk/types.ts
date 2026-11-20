export interface KuveytTurkConfig {
  /** Sanal POS merchant number (MerchantId). */
  merchantId: string;
  /** Account number the POS settles to (CustomerId). */
  customerId: string;
  /** API-role user created in the Kuveyt Türk corporate panel. */
  username: string;
  /** That user's password — every request is signed with SHA1 of it. */
  password: string;
  /** `paymentType` on the Payment call. The API rejects requests without it; defaults to 1. */
  paymentType?: number;
}

/** Envelope every KT Pay Gate JSON endpoint answers with (Payment answers HTML instead). */
export interface KuveytTurkEnvelope<T = unknown> {
  Success?: boolean;
  ResponseCode?: string;
  ResponseMessage?: string;
  BusinessKey?: string | null;
  Result?: T | null;
  [key: string]: unknown;
}

/** One row of GetTransactions. Amounts are in minor units (kuruş). */
export interface KuveytTurkTransaction {
  /** The bank's order id — needed by Provision and SaleReversal. */
  OrderId?: number | string;
  MerchantOrderId?: string;
  /** e.g. "Başarılı (1)", "Başarısız (2)", "Zaman Aşımı (3)". */
  TransactionStatus?: string;
  FirstAmount?: number;
  CancelAmount?: number;
  DrawbackAmount?: number;
  ResponseCode?: string;
  ResponseExplain?: string;
  [key: string]: unknown;
}

/**
 * What the bank POSTs to the callback URL after card verification, plus the
 * two fields the caller adds from its own records.
 *
 * Nothing here is signed: completion confirms the order at the bank
 * (GetTransactions) and charges with Provision.
 */
export interface KuveytTurkCallback {
  Success?: string;
  ResponseCode?: string;
  ResponseMessage?: string;
  MD?: string;
  /** The BANK's order id. Not the same thing as `orderId` below — keys are case-sensitive. */
  OrderId?: string;
  /** Your order id, as sent at init (= the init `paymentId`). */
  MerchantOrderId?: string;
  /**
   * Your stored order id. When set, it must equal `MerchantOrderId` or the
   * callback is rejected — stops order A's callback completing order B.
   */
  orderId?: string;
  /**
   * Your stored order total as a decimal string (`'100.00'`, the init `price`).
   * When set, it must equal the amount the bank recorded for the order.
   */
  amount?: string;
  [key: string]: unknown;
}
