export interface VakifBankConfig {
  /** 15-digit member merchant number (Üye İşyeri No). */
  merchantId: string;
  /** VPOS API password — also the MPI MerchantPassword. */
  password: string;
  /** Terminal number, e.g. `VP000000`. */
  terminalNo: string;
  /**
   * MPI enrollment endpoint override. By default it is derived from `baseUrl`:
   * `onlineodeme[test].vakifbank.com.tr` → `3dsecure[test].vakifbank.com.tr` +
   * `/MPIAPI/MPI_Enrollment.aspx`, same port.
   */
  mpiUrl?: string;
}

/**
 * What VakıfBank's MPI POSTs to the callback URL, plus the field the caller
 * adds from its own records. Nothing here is signed.
 */
export interface VakifBankCallback {
  MerchantId?: string;
  /** Your order id, as sent at init (= the init `paymentId`). */
  VerifyEnrollmentRequestId?: string;
  /** `Y` = fully authenticated. Anything else is not charged. */
  Status?: string;
  Eci?: string;
  Cavv?: string;
  InstallmentCount?: string;
  /** Echoes the buyer IP sent at init. */
  SessionInfo?: string;
  ErrorCode?: string;
  ErrorMessage?: string;
  /**
   * Your stored order id. When set, it must equal `VerifyEnrollmentRequestId`
   * or the callback is rejected — stops order A's callback completing order B.
   */
  orderId?: string;
  /**
   * Your stored order total as a decimal string (`'100.00'`, the init `price`).
   * Checked against the amount VPOS reports it charged; a mismatch is FAILURE
   * `AMOUNT_MISMATCH` (with `paymentId`, so you can cancel it).
   */
  amount?: string;
  [key: string]: unknown;
}
