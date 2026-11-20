/** Payment institutions running Sipay's CCPayment platform. */
export type SipayBrand = 'sipay' | 'qnbpay';

/**
 * Sipay / QNBpay credentials (merchant panel → Integration & API).
 * `appId`/`appSecret` fetch the Bearer token and sign/verify every hash_key;
 * `merchantKey` identifies the merchant on each request.
 */
export interface SipayConfig {
  appId: string;
  appSecret: string;
  merchantKey: string;
  /** `sipay` (default) or `qnbpay`. Only names the provider; the host is `baseUrl`. */
  brand?: SipayBrand;
}

/** Decrypted payment-result hash_key. `status` is "1" approved, "0" failed. */
export interface SipayHashFields {
  status: string;
  total: string;
  invoiceId: string;
  orderId: string;
  currency: string;
}

/**
 * Fields Sipay POSTs to return_url / cancel_url after 3D Secure, plus the
 * optional values the caller adds from its own order record.
 */
export interface Sipay3DCallbackData {
  hash_key?: string;
  invoice_id?: string;
  order_id?: string;
  status_code?: string | number;
  status_description?: string;
  error_code?: string | number;
  error?: string;
  md_status?: string | number;
  original_bank_error_code?: string | null;
  original_bank_error_description?: string | null;
  /** Your order id = the init `paymentId` = Sipay `invoice_id`. Checked against the signed invoice id. */
  orderId?: string;
  /**
   * Order total from your records (decimal). Checked against the signed total.
   * NOTE: Sipay's own callback also posts an (unsigned) `amount`; overwrite it
   * with your recorded value — without it, the echo is what gets compared.
   */
  amount?: string | number;
  [key: string]: unknown;
}

/** Common envelope of CCPayment JSON answers. */
export interface SipayResponse {
  status_code?: number | string;
  status_description?: string;
  [key: string]: unknown;
}

export interface SipayPaymentResponse extends SipayResponse {
  data?: {
    payment_status?: number | string;
    invoice_id?: string;
    order_id?: string;
    error_code?: number | string;
    error?: string;
    original_bank_error_code?: string | null;
    original_bank_error_description?: string | null;
    [key: string]: unknown;
  };
}

export interface SipayStatusResponse extends SipayResponse {
  /** "Completed", "Pending", "Failed", "Refunded", "Partial Refund", "Cancelled", "Pre-Authorization" */
  transaction_status?: string;
  transaction_amount?: number | string;
  product_price?: number | string;
  total_refunded_amount?: number | string;
  message?: string;
}

export interface SipayPosOption {
  installments_number?: number;
  card_type?: string;
  card_program?: string;
  card_scheme?: string;
  is_commercial?: string;
  payable_amount?: number;
  amount_to_be_paid?: string;
  card_bank?: string;
  bank_code?: string;
  [key: string]: unknown;
}
