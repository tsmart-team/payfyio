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
import { IsbankConfig } from './types';
import {
  buildNestPayV3Hash,
  buildXmlEnvelope,
  parseXmlScalar,
  buildRedirectFormHtml,
  formatIsbankAmount,
  getIsbankCurrency,
  randomNonce,
} from './utils';

const POS_PATH = '/fim/api';
const THREED_PATH = '/fim/est3Dgate';

/**
 * İş Bankası Sanal POS provider (NestPay/CC5 + 3D-Pay Hosting v3 hash).
 */
export class Isbank extends PaymentProvider {
  private client: AxiosInstance;
  private clientId: string;
  private username: string;
  private password: string;
  private storeKey: string;

  constructor(config: PaymentProviderConfig & IsbankConfig) {
    if (!config.clientId) throw new Error('İş Bankası clientId is required');
    if (!config.username) throw new Error('İş Bankası username is required');
    if (!config.password) throw new Error('İş Bankası password is required');
    if (!config.storeKey) throw new Error('İş Bankası storeKey is required');
    super({ ...config, apiKey: config.clientId, secretKey: config.storeKey });
    this.clientId = config.clientId;
    this.username = config.username;
    this.password = config.password;
    this.storeKey = config.storeKey;
    this.client = axios.create({
      baseURL: this.config.baseUrl,
      timeout: 30000,
    });
    this.setupAxiosLogging(this.client, 'isbank');
    this.setupAxiosRetry(this.client);
  }

  protected validateConfig(): void {
    // Validation in constructor.
  }

  private mapStatus(code?: string): PaymentStatus {
    if (!code) return PaymentStatus.PENDING;
    if (code === '00' || code === 'Success') return PaymentStatus.SUCCESS;
    return PaymentStatus.FAILURE;
  }

  private async postXml<T = string>(payload: Record<string, any>): Promise<T> {
    const xml = buildXmlEnvelope(payload);
    const res = await this.client.post<string>(POS_PATH, `DATA=${encodeURIComponent(xml)}`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    return res.data as unknown as T;
  }

  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    const orderId = request.conversationId || `ISB-${Date.now()}`;
    try {
      const data = await this.postXml<string>({
        Name: this.username,
        Password: this.password,
        ClientId: this.clientId,
        OrderId: orderId,
        Type: 'Auth',
        Number: request.paymentCard.cardNumber,
        Expires: `${request.paymentCard.expireMonth}/${String(request.paymentCard.expireYear).slice(-2)}`,
        Cvv2Val: request.paymentCard.cvc,
        Total: formatIsbankAmount(request.price),
        Currency: getIsbankCurrency(request.currency as string),
        BillTo: { Name: request.paymentCard.cardHolderName },
        Email: request.buyer?.email,
      });
      const code = parseXmlScalar(data, 'ProcReturnCode');
      return {
        status: this.mapStatus(code),
        paymentId: parseXmlScalar(data, 'OrderId') || orderId,
        conversationId: orderId,
        errorCode: code,
        errorMessage: parseXmlScalar(data, 'ErrMsg') || parseXmlScalar(data, 'Response'),
        rawResponse: data,
      };
    } catch (err: any) {
      return {
        status: PaymentStatus.FAILURE,
        errorMessage: err?.message || 'İş Bankası createPayment failed',
        rawResponse: err?.response?.data,
      };
    }
  }

  async initThreeDSPayment(request: ThreeDSPaymentRequest): Promise<ThreeDSInitResponse> {
    const orderId = request.conversationId || `ISB-${Date.now()}`;
    const amount = formatIsbankAmount(request.price);
    const currency = getIsbankCurrency(request.currency as string);
    const installment = request.installment && request.installment > 1 ? String(request.installment) : '';
    const rnd = randomNonce();
    const hashFields = [
      this.clientId,
      orderId,
      amount,
      request.callbackUrl,
      request.callbackUrl,
      'Auth',
      installment,
      rnd,
      currency,
      this.storeKey,
    ];
    const hash = buildNestPayV3Hash(hashFields, this.storeKey);
    const fields: Record<string, string> = {
      clientid: this.clientId,
      storetype: '3d_pay_hosting',
      hash,
      hashAlgorithm: 'ver3',
      islemtipi: 'Auth',
      amount,
      currency,
      oid: orderId,
      okUrl: request.callbackUrl,
      failUrl: request.callbackUrl,
      lang: 'tr',
      rnd,
      taksit: installment,
      pan: request.paymentCard.cardNumber,
      Ecom_Payment_Card_ExpDate_Year: String(request.paymentCard.expireYear).slice(-2),
      Ecom_Payment_Card_ExpDate_Month: request.paymentCard.expireMonth,
      cv2: request.paymentCard.cvc,
    };
    const html = buildRedirectFormHtml(`${this.config.baseUrl}${THREED_PATH}`, fields);
    return {
      status: PaymentStatus.PENDING,
      threeDSHtmlContent: html,
      paymentId: orderId,
      conversationId: orderId,
    };
  }

  async completeThreeDSPayment(callbackData: any): Promise<PaymentResponse> {
    const md = callbackData?.mdStatus || callbackData?.MdStatus;
    const orderId = callbackData?.oid || callbackData?.OrderId;
    if (!md || !['1', '2', '3', '4'].includes(String(md))) {
      return {
        status: PaymentStatus.FAILURE,
        paymentId: orderId,
        errorMessage: `3D authentication failed (mdStatus=${md})`,
        rawResponse: callbackData,
      };
    }
    // SECURITY (fail-closed): the NestPay 3D response carries a HASH /
    // HASHPARAMS (HMAC-SHA512 over the param list + storeKey) that MUST be
    // recomputed and constant-time compared before trusting mdStatus /
    // ProcReturnCode. Not implemented yet, so refuse to confirm — a forged
    // callback would otherwise mark an unpaid order paid. Do NOT remove
    // until response-hash verification + amount binding are implemented and
    // tested against the bank sandbox.
    return {
      status: PaymentStatus.FAILURE,
      paymentId: orderId,
      errorMessage:
        'İş Bankası (NestPay) 3DS callback hash verification is not implemented; refusing to confirm payment. ' +
        'Implement response-HASH (HMAC-SHA512) verification before enabling this provider in production.',
      rawResponse: callbackData,
    };
  }

  async refund(request: RefundRequest): Promise<RefundResponse> {
    try {
      const data = await this.postXml<string>({
        Name: this.username,
        Password: this.password,
        ClientId: this.clientId,
        OrderId: request.paymentId,
        Type: 'Credit',
        Total: formatIsbankAmount(request.price),
        Currency: getIsbankCurrency(request.currency as string),
      });
      const code = parseXmlScalar(data, 'ProcReturnCode');
      return {
        status: this.mapStatus(code),
        refundId: parseXmlScalar(data, 'OrderId') || request.paymentId,
        conversationId: request.conversationId,
        errorCode: code,
        errorMessage: parseXmlScalar(data, 'ErrMsg'),
        rawResponse: data,
      };
    } catch (err: any) {
      return {
        status: PaymentStatus.FAILURE,
        errorMessage: err?.message || 'İş Bankası refund failed',
        rawResponse: err?.response?.data,
      };
    }
  }

  async cancel(request: CancelRequest): Promise<CancelResponse> {
    try {
      const data = await this.postXml<string>({
        Name: this.username,
        Password: this.password,
        ClientId: this.clientId,
        OrderId: request.paymentId,
        Type: 'Void',
      });
      const code = parseXmlScalar(data, 'ProcReturnCode');
      return {
        status: this.mapStatus(code),
        voidId: request.paymentId,
        conversationId: request.conversationId,
        errorCode: code,
        errorMessage: parseXmlScalar(data, 'ErrMsg'),
        rawResponse: data,
      };
    } catch (err: any) {
      return {
        status: PaymentStatus.FAILURE,
        errorMessage: err?.message || 'İş Bankası cancel failed',
        rawResponse: err?.response?.data,
      };
    }
  }

  async getPayment(paymentId: string): Promise<PaymentResponse> {
    try {
      const data = await this.postXml<string>({
        Name: this.username,
        Password: this.password,
        ClientId: this.clientId,
        OrderId: paymentId,
        Extra: { ORDERSTATUS: 'QUERY' },
      });
      const code = parseXmlScalar(data, 'ProcReturnCode');
      return {
        status: this.mapStatus(code),
        paymentId,
        errorCode: code,
        errorMessage: parseXmlScalar(data, 'ErrMsg'),
        rawResponse: data,
      };
    } catch (err: any) {
      return {
        status: PaymentStatus.FAILURE,
        errorMessage: err?.message || 'İş Bankası getPayment failed',
        rawResponse: err?.response?.data,
      };
    }
  }
}

