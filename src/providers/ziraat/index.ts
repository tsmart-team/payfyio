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
import { ZiraatConfig } from './types';
import {
  buildNestPayV3Hash,
  buildXmlEnvelope,
  parseXmlScalar,
  buildRedirectFormHtml,
  formatZiraatAmount,
  getZiraatCurrency,
  randomNonce,
} from './utils';

const POS_PATH = '/fim/api';
const THREED_PATH = '/fim/est3Dgate';

/**
 * Ziraat Bankası Sanal POS provider (NestPay/CC5 + 3D-Pay Hosting v3 hash).
 */
export class Ziraat extends PaymentProvider {
  private client: AxiosInstance;
  private clientId: string;
  private username: string;
  private password: string;
  private storeKey: string;

  constructor(config: PaymentProviderConfig & ZiraatConfig) {
    if (!config.clientId) throw new Error('Ziraat clientId is required');
    if (!config.username) throw new Error('Ziraat username is required');
    if (!config.password) throw new Error('Ziraat password is required');
    if (!config.storeKey) throw new Error('Ziraat storeKey is required');
    super({ ...config, apiKey: config.clientId, secretKey: config.storeKey });
    this.clientId = config.clientId;
    this.username = config.username;
    this.password = config.password;
    this.storeKey = config.storeKey;
    this.client = axios.create({ baseURL: this.config.baseUrl, timeout: 30000 });
    this.setupAxiosLogging(this.client, 'ziraat');
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

  private async postXml(payload: Record<string, any>): Promise<string> {
    const xml = buildXmlEnvelope(payload);
    const res = await this.client.post<string>(POS_PATH, `DATA=${encodeURIComponent(xml)}`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    return res.data;
  }

  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    const orderId = request.conversationId || `ZRT-${Date.now()}`;
    try {
      const data = await this.postXml({
        Name: this.username,
        Password: this.password,
        ClientId: this.clientId,
        OrderId: orderId,
        Type: 'Auth',
        Number: request.paymentCard.cardNumber,
        Expires: `${request.paymentCard.expireMonth}/${String(request.paymentCard.expireYear).slice(-2)}`,
        Cvv2Val: request.paymentCard.cvc,
        Total: formatZiraatAmount(request.price),
        Currency: getZiraatCurrency(request.currency as string),
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
        errorMessage: err?.message || 'Ziraat createPayment failed',
        rawResponse: err?.response?.data,
      };
    }
  }

  async initThreeDSPayment(request: ThreeDSPaymentRequest): Promise<ThreeDSInitResponse> {
    const orderId = request.conversationId || `ZRT-${Date.now()}`;
    const amount = formatZiraatAmount(request.price);
    const currency = getZiraatCurrency(request.currency as string);
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
    return {
      status: this.mapStatus(callbackData?.ProcReturnCode || '00'),
      paymentId: orderId,
      conversationId: orderId,
      rawResponse: callbackData,
    };
  }

  async refund(request: RefundRequest): Promise<RefundResponse> {
    try {
      const data = await this.postXml({
        Name: this.username,
        Password: this.password,
        ClientId: this.clientId,
        OrderId: request.paymentId,
        Type: 'Credit',
        Total: formatZiraatAmount(request.price),
        Currency: getZiraatCurrency(request.currency as string),
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
        errorMessage: err?.message || 'Ziraat refund failed',
        rawResponse: err?.response?.data,
      };
    }
  }

  async cancel(request: CancelRequest): Promise<CancelResponse> {
    try {
      const data = await this.postXml({
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
        errorMessage: err?.message || 'Ziraat cancel failed',
        rawResponse: err?.response?.data,
      };
    }
  }

  async getPayment(paymentId: string): Promise<PaymentResponse> {
    try {
      const data = await this.postXml({
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
        errorMessage: err?.message || 'Ziraat getPayment failed',
        rawResponse: err?.response?.data,
      };
    }
  }
}

