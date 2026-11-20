import axios, { AxiosInstance } from 'axios';
import { PaymentProvider, PaymentProviderConfig } from '../../core/PaymentProvider';
import {
  PaymentRequest,
  PaymentResponse,
  ThreeDSPaymentRequest,
  ThreeDSInitResponse,
  RefundRequest,
  RefundResponse,
  CancelRequest,
  CancelResponse,
  PaymentStatus,
} from '../../types';
import { VakifBankConfig, VakifBankCallback } from './types';
import {
  getVakifBankCurrency,
  formatVakifBankAmount,
  vakifBankExpiry,
  vakifBankBrand,
  assertVakifBankOrderId,
  deriveVakifBankMpiUrl,
  buildVposBody,
  readVakifBankXml,
  buildAutoPostForm,
} from './utils';

export type { VakifBankConfig, VakifBankCallback } from './types';

const VPOS_PATH = '/VposService/v3/Vposreq.aspx';
const APPROVED = '0000';

const isIp = (v: unknown): v is string => typeof v === 'string' && /^[0-9A-Fa-f:.]{3,45}$/.test(v);

/**
 * VakıfBank VPOS 7/24.
 *
 * - `createPayment`: VPOS `Sale` (non-3D)
 * - `initThreeDSPayment`: MPI enrollment (second host, see `mpiUrl`), then an
 *   auto-post to the issuer's ACS
 * - `completeThreeDSPayment`: VPOS `Sale` with `MpiTransactionId` — VPOS takes
 *   card, amount and the 3DS result from its own MPI record
 * - `refund` / `cancel`: VPOS `Refund` / `Cancel`
 * - `getPayment`: not supported (throws)
 *
 * `paymentId` is the order id (`conversationId` or a generated `VB…`): the MPI
 * VerifyEnrollmentRequestId and the VPOS TransactionId at once, so it must be
 * new for every attempt.
 */
export class VakifBank extends PaymentProvider {
  private client: AxiosInstance;
  private merchantId: string;
  private password: string;
  private terminalNo: string;
  private mpiUrl: string;

  constructor(config: PaymentProviderConfig & VakifBankConfig) {
    if (!config.merchantId) throw new Error('VakıfBank merchantId is required');
    if (!config.password) throw new Error('VakıfBank password is required');
    if (!config.terminalNo) throw new Error('VakıfBank terminalNo is required');
    if (!config.baseUrl) throw new Error('VakıfBank baseUrl is required');
    super({ ...config, apiKey: config.merchantId, secretKey: config.password });
    this.merchantId = config.merchantId;
    this.password = config.password;
    this.terminalNo = config.terminalNo;
    this.mpiUrl = config.mpiUrl || deriveVakifBankMpiUrl(config.baseUrl);
    this.client = axios.create({
      baseURL: this.config.baseUrl,
      timeout: 30000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      responseType: 'text',
    });
    this.setupAxiosLogging(this.client, 'vakifbank');
    this.setupAxiosRetry(this.client);
  }

  protected validateConfig(): void {
    // Checked in the constructor; apiKey/secretKey are synthesized for the base class.
  }

  private async vpos(fields: Record<string, string | number | undefined>) {
    const res = await this.client.post<string>(
      VPOS_PATH,
      buildVposBody({ MerchantId: this.merchantId, Password: this.password, TerminalNo: this.terminalNo, ...fields }),
    );
    return readVakifBankXml(res.data, 'VposResponse');
  }

  /** Unknown outcome only when a money-moving request got no answer at all. */
  private static failed(err: any, fallback: string, moneyInFlight: boolean) {
    const pending = moneyInFlight && axios.isAxiosError(err) && !err.response;
    return {
      status: pending ? PaymentStatus.PENDING : PaymentStatus.FAILURE,
      errorCode: pending ? 'NETWORK_ERROR' : undefined,
      errorMessage: err?.message || fallback,
      rawResponse: err?.response?.data,
    };
  }

  /** Non-3D sale. Only for terminals allowed to take non-3D traffic. */
  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    const orderId = request.conversationId || `VB${Date.now()}`;
    let sent = false;
    try {
      assertVakifBankOrderId(orderId);
      const card = request.paymentCard;
      const installment = (request as any).installment as number | undefined;
      const fields = {
        TransactionType: 'Sale',
        TransactionId: orderId,
        OrderId: orderId,
        CurrencyAmount: formatVakifBankAmount(request.price),
        CurrencyCode: getVakifBankCurrency(request.currency as string),
        Pan: card.cardNumber.replace(/\s/g, ''),
        Cvv: card.cvc,
        Expiry: vakifBankExpiry(card.expireMonth, card.expireYear, 'YYYYMM'),
        NumberOfInstallments: installment && installment > 1 ? installment : undefined,
        CardHoldersName: card.cardHolderName,
        ClientIp: request.buyer?.ip || '127.0.0.1',
        TransactionDeviceSource: '0',
      };
      sent = true;
      const res = await this.vpos(fields);
      const ok = res.ResultCode === APPROVED;
      return {
        status: ok ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        paymentId: orderId,
        conversationId: orderId,
        errorCode: ok ? undefined : res.ResultCode,
        errorMessage: ok ? undefined : res.ResultDetail,
        rawResponse: res,
      };
    } catch (err: any) {
      const out = VakifBank.failed(err, 'VakıfBank createPayment failed', sent);
      return out.status === PaymentStatus.PENDING ? { ...out, paymentId: orderId, conversationId: orderId } : out;
    }
  }

  /**
   * MPI enrollment. Only cards the MPI reports as enrolled (`Status=Y`) get a
   * form; the amount sent here is recorded by the MPI and is what VPOS later
   * charges in `completeThreeDSPayment`.
   */
  async initThreeDSPayment(request: ThreeDSPaymentRequest): Promise<ThreeDSInitResponse> {
    const orderId = request.conversationId || `VB${Date.now()}`;
    try {
      assertVakifBankOrderId(orderId);
      if (!request.callbackUrl) throw new Error('callbackUrl is required');
      const card = request.paymentCard;
      const pan = card.cardNumber.replace(/\s/g, '');
      const form = new URLSearchParams({
        MerchantId: this.merchantId,
        MerchantPassword: this.password,
        VerifyEnrollmentRequestId: orderId,
        Pan: pan,
        ExpiryDate: vakifBankExpiry(card.expireMonth, card.expireYear, 'YYMM'),
        PurchaseAmount: formatVakifBankAmount(request.price),
        Currency: getVakifBankCurrency(request.currency as string),
        BrandName: vakifBankBrand(pan),
        SuccessUrl: request.callbackUrl,
        FailureUrl: request.callbackUrl,
      });
      if (request.installment && request.installment > 1) form.set('InstallmentCount', String(request.installment));
      // Echoed back in the callback; VPOS needs the buyer IP for the sale.
      if (isIp(request.buyer?.ip)) form.set('SessionInfo', request.buyer.ip);

      const res = await this.client.post<string>(this.mpiUrl, form.toString());
      const e = readVakifBankXml(res.data, 'IPaySecure');
      const paReq = e.PaReq ?? e.PAReq;
      if (e.Status !== 'Y' || !paReq || !e.ACSUrl || !e.TermUrl || !e.MD) {
        return {
          status: PaymentStatus.FAILURE,
          errorCode:
            e.MessageErrorCode && e.MessageErrorCode !== '200' ? e.MessageErrorCode : e.ErrorCode || `VERES_${e.Status ?? ''}`,
          errorMessage: e.ErrorMessage || (e.Status === 'N' ? 'Card is not enrolled in 3D Secure' : 'MPI enrollment failed'),
          rawResponse: e,
        };
      }
      return {
        status: PaymentStatus.PENDING,
        threeDSHtmlContent: buildAutoPostForm(e.ACSUrl, { PaReq: paReq, TermUrl: e.TermUrl, MD: e.MD }),
        paymentId: orderId,
        conversationId: orderId,
      };
    } catch (err: any) {
      return VakifBank.failed(err, 'VakıfBank initThreeDSPayment failed', false);
    }
  }

  /**
   * Charge after the MPI callback.
   *
   * The callback is NOT signed and is never used for what gets charged: the
   * VPOS `Sale` carries only `MpiTransactionId` (+ ECI/CAVV), and VPOS reads
   * the card, the amount and the 3DS outcome from its own MPI record — the
   * amount being the one you sent at enrollment. A forged `Status=Y` for an
   * order the MPI did not authenticate is declined by VPOS.
   *
   * Checks before the charge: `MerchantId` (if present) is ours, `orderId`
   * (if you pass it) equals `VerifyEnrollmentRequestId`, `Status` is `Y`.
   * After: if you pass `amount`, it must match the `CurrencyAmount` VPOS reports.
   *
   * Failures before VPOS approves never carry `paymentId`. No answer from VPOS
   * → PENDING / `NETWORK_ERROR` with `paymentId`; there is no status query, so
   * check the order in the VakıfBank merchant panel.
   */
  async completeThreeDSPayment(callbackData: VakifBankCallback): Promise<PaymentResponse> {
    const cb = (callbackData || {}) as VakifBankCallback;
    const str = (v: unknown) => (v == null ? '' : String(v));
    const reject = (errorCode: string, errorMessage: string, rawResponse: unknown = cb): PaymentResponse => ({
      status: PaymentStatus.FAILURE,
      errorCode,
      errorMessage,
      rawResponse,
    });

    const orderId = str(cb.VerifyEnrollmentRequestId);
    if (!orderId || (cb.MerchantId != null && str(cb.MerchantId) !== this.merchantId)) {
      return reject('INVALID_CALLBACK', 'Callback has no order id or belongs to another merchant');
    }
    if (cb.orderId != null && str(cb.orderId) !== orderId) {
      return reject('ORDER_MISMATCH', 'Callback belongs to a different order');
    }
    if (cb.Status !== 'Y') {
      return reject(str(cb.ErrorCode) || `MPI_STATUS_${str(cb.Status)}`, str(cb.ErrorMessage) || '3D Secure authentication failed');
    }

    let sent = false;
    try {
      assertVakifBankOrderId(orderId);
      // Normalised before the charge: a bad stored amount must fail here, not after VPOS approved.
      const expected = cb.amount != null ? formatVakifBankAmount(str(cb.amount)) : undefined;
      // The merchant's own count wins: the callback's InstallmentCount is unsigned.
      const installment = Number((cb as { installment?: unknown }).installment ?? cb.InstallmentCount);
      const fields = {
        TransactionType: 'Sale',
        TransactionId: orderId,
        OrderId: orderId,
        MpiTransactionId: orderId,
        ECI: str(cb.Eci ?? cb.ECI) || undefined,
        CAVV: str(cb.Cavv ?? cb.CAVV) || undefined,
        NumberOfInstallments: installment > 1 ? installment : undefined,
        ClientIp: isIp(cb.SessionInfo) ? cb.SessionInfo : '127.0.0.1',
        TransactionDeviceSource: '0',
      };
      sent = true;
      const res = await this.vpos(fields);
      if (res.ResultCode !== APPROVED) {
        return reject(res.ResultCode || 'DECLINED', res.ResultDetail || 'VakıfBank declined the sale', { callback: cb, payment: res });
      }
      const charged = parseFloat(res.CurrencyAmount ?? '');
      if (expected && isFinite(charged) && charged.toFixed(2) !== expected) {
        // Charged, but not what the order says — keep the id so the caller can cancel it.
        return {
          status: PaymentStatus.FAILURE,
          paymentId: orderId,
          conversationId: orderId,
          errorCode: 'CHARGED_AMOUNT_MISMATCH',
          errorMessage: `VakıfBank charged ${res.CurrencyAmount}, expected ${cb.amount}`,
          rawResponse: { callback: cb, payment: res },
        };
      }
      return {
        status: PaymentStatus.SUCCESS,
        paymentId: orderId,
        conversationId: orderId,
        rawResponse: { callback: cb, payment: res },
      };
    } catch (err: any) {
      const out = VakifBank.failed(err, 'VakıfBank completeThreeDSPayment failed', sent);
      return out.status === PaymentStatus.PENDING ? { ...out, paymentId: orderId, conversationId: orderId } : out;
    }
  }

  /** Full or partial refund (`Refund`). Several partials may add up to the sale. */
  async refund(request: RefundRequest): Promise<RefundResponse> {
    let sent = false;
    try {
      const fields = {
        TransactionType: 'Refund',
        ReferenceTransactionId: request.paymentId,
        CurrencyAmount: formatVakifBankAmount(request.price),
        ClientIp: request.ip,
      };
      sent = true;
      const res = await this.vpos(fields);
      const ok = res.ResultCode === APPROVED;
      return {
        status: ok ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        refundId: ok ? res.TransactionId || undefined : undefined,
        conversationId: request.conversationId,
        errorCode: ok ? undefined : res.ResultCode,
        errorMessage: ok ? undefined : res.ResultDetail,
        rawResponse: res,
      };
    } catch (err: any) {
      return { ...VakifBank.failed(err, 'VakıfBank refund failed', sent), conversationId: request.conversationId };
    }
  }

  /** Same-day void (`Cancel`), before end of day. */
  async cancel(request: CancelRequest): Promise<CancelResponse> {
    try {
      const res = await this.vpos({
        TransactionType: 'Cancel',
        ReferenceTransactionId: request.paymentId,
        ClientIp: request.ip,
      });
      const ok = res.ResultCode === APPROVED;
      return {
        status: ok ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        voidId: ok ? res.TransactionId || undefined : undefined,
        conversationId: request.conversationId,
        errorCode: ok ? undefined : res.ResultCode,
        errorMessage: ok ? undefined : res.ResultDetail,
        rawResponse: res,
      };
    } catch (err: any) {
      return { ...VakifBank.failed(err, 'VakıfBank cancel failed', true), conversationId: request.conversationId };
    }
  }

  /**
   * Not supported — throws. VakıfBank's search by order id returns the sale
   * but not the cancel/refund records (they carry no order id), so it cannot
   * say whether a paid order was later reversed. A FAILURE result here would
   * read as "payment failed" to a reconciler, hence the throw.
   */
  async getPayment(_paymentId: string): Promise<PaymentResponse> {
    throw new Error(
      'VakıfBank getPayment is not supported: the record search cannot see cancels or refunds — keep status from cancel()/refund() results',
    );
  }
}
