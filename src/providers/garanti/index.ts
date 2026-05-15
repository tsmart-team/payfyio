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
import { GarantiConfig } from './types';
import {
  buildSecurityData,
  buildHashData,
  build3DHashData,
  buildXmlRequest,
  parseXmlScalar,
  buildRedirectFormHtml,
  formatGarantiAmount,
  getGarantiCurrency,
} from './utils';

const THREE_D_GATE_PATH = '/servlet/gt3dengine';
const POS_PATH = '/VPServlet';

/**
 * Garanti BBVA Sanal POS (GVP) provider.
 *
 * Auth model: MerchantID + TerminalID + ProvisionUser/Password + StoreKey for
 * direct calls, plus a separate Secure3DStoreKey for 3DS hash. XML over HTTPS
 * to /VPServlet for direct ops, form-POST to /servlet/gt3dengine for 3DS init.
 */
export class Garanti extends PaymentProvider {
  private client: AxiosInstance;
  private merchantId: string;
  private terminalId: string;
  private provisionUser: string;
  private provisionPassword: string;
  private secure3DStoreKey?: string;

  constructor(config: PaymentProviderConfig & GarantiConfig) {
    if (!config.merchantId) throw new Error('Garanti merchantId is required');
    if (!config.terminalId) throw new Error('Garanti terminalId is required');
    if (!config.provisionUser) throw new Error('Garanti provisionUser is required');
    if (!config.provisionPassword) throw new Error('Garanti provisionPassword is required');
    if (!config.storeKey) throw new Error('Garanti storeKey is required');
    super({ ...config, apiKey: config.merchantId, secretKey: config.storeKey });
    this.merchantId = config.merchantId;
    this.terminalId = config.terminalId;
    this.provisionUser = config.provisionUser;
    this.provisionPassword = config.provisionPassword;
    this.secure3DStoreKey = config.secure3DStoreKey;
    this.client = axios.create({
      baseURL: this.config.baseUrl,
      timeout: 30000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    this.setupAxiosLogging(this.client, 'garanti');
    this.setupAxiosRetry(this.client);
  }

  protected validateConfig(): void {
    // Provider-specific validation runs in constructor; base apiKey/secretKey are
    // synthesized so the parent validator passes.
  }

  private mapStatus(code?: string): PaymentStatus {
    if (!code) return PaymentStatus.PENDING;
    if (code === '00' || code === 'Success') return PaymentStatus.SUCCESS;
    return PaymentStatus.FAILURE;
  }

  private buildPayload(opts: {
    request: PaymentRequest;
    txnType: 'sales' | 'refund' | 'void';
    orderId: string;
  }): string {
    const { request, txnType, orderId } = opts;
    const amount = formatGarantiAmount(request.price);
    const currency = getGarantiCurrency(request.currency as string);
    const securityData = buildSecurityData(this.provisionPassword, this.terminalId);
    const hashData = buildHashData({
      orderId,
      terminalId: this.terminalId,
      cardNumber: request.paymentCard.cardNumber,
      amount,
      securityData,
    });
    return buildXmlRequest({
      Mode: 'PROD',
      Version: 'v1.0',
      Terminal: {
        ProvUserID: this.provisionUser,
        UserID: this.provisionUser,
        HashData: hashData,
        ID: this.terminalId,
        MerchantID: this.merchantId,
      },
      Customer: {
        IPAddress: request.buyer?.ip || '127.0.0.1',
        EmailAddress: request.buyer?.email,
      },
      Card: {
        Number: request.paymentCard.cardNumber,
        ExpireDate: `${request.paymentCard.expireMonth}${String(request.paymentCard.expireYear).slice(-2)}`,
        CVV2: request.paymentCard.cvc,
      },
      Order: { OrderID: orderId, GroupID: '', Description: request.basketId },
      Transaction: {
        Type: txnType,
        InstallmentCnt: '',
        Amount: amount,
        CurrencyCode: currency,
        CardholderPresentCode: '0',
        MotoInd: 'N',
      },
    });
  }

  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    const orderId = request.conversationId || `GAR-${Date.now()}`;
    try {
      const xml = this.buildPayload({ request, txnType: 'sales', orderId });
      const res = await this.client.post<string>(POS_PATH, `data=${encodeURIComponent(xml)}`);
      const code = parseXmlScalar(res.data, 'ReasonCode');
      const message = parseXmlScalar(res.data, 'Message') || parseXmlScalar(res.data, 'ErrorMsg');
      return {
        status: this.mapStatus(code),
        paymentId: orderId,
        conversationId: orderId,
        errorCode: code,
        errorMessage: message,
        rawResponse: res.data,
      };
    } catch (err: any) {
      return {
        status: PaymentStatus.FAILURE,
        errorMessage: err?.message || 'Garanti createPayment failed',
        rawResponse: err?.response?.data,
      };
    }
  }

  async initThreeDSPayment(request: ThreeDSPaymentRequest): Promise<ThreeDSInitResponse> {
    if (!this.secure3DStoreKey) {
      return {
        status: PaymentStatus.FAILURE,
        errorMessage: 'secure3DStoreKey is required for Garanti 3DS',
      };
    }
    const orderId = request.conversationId || `GAR-${Date.now()}`;
    const amount = formatGarantiAmount(request.price);
    const currency = getGarantiCurrency(request.currency as string);
    const installment = request.installment && request.installment > 1 ? String(request.installment) : '';
    const securityData = buildSecurityData(this.provisionPassword, this.terminalId);
    const hash = build3DHashData({
      terminalId: this.terminalId,
      orderId,
      amount,
      successUrl: request.callbackUrl,
      failUrl: request.callbackUrl,
      txnType: 'sales',
      installment,
      storeKey: this.secure3DStoreKey,
      securityData,
    });
    const fields: Record<string, string> = {
      mode: 'PROD',
      apiversion: 'v0.01',
      terminalprovuserid: this.provisionUser,
      terminaluserid: this.provisionUser,
      terminalmerchantid: this.merchantId,
      terminalid: this.terminalId,
      txntype: 'sales',
      txnamount: amount,
      txncurrencycode: currency,
      txninstallmentcount: installment,
      orderid: orderId,
      successurl: request.callbackUrl,
      errorurl: request.callbackUrl,
      customeremailaddress: request.buyer?.email || '',
      customeripaddress: request.buyer?.ip || '127.0.0.1',
      cardnumber: request.paymentCard.cardNumber,
      cardexpiredatemonth: request.paymentCard.expireMonth,
      cardexpiredateyear: String(request.paymentCard.expireYear).slice(-2),
      cardcvv2: request.paymentCard.cvc,
      secure3dhash: hash,
      secure3dsecuritylevel: '3D',
    };
    const html = buildRedirectFormHtml(`${this.config.baseUrl}${THREE_D_GATE_PATH}`, fields);
    return {
      status: PaymentStatus.PENDING,
      threeDSHtmlContent: html,
      paymentId: orderId,
      conversationId: orderId,
    };
  }

  async completeThreeDSPayment(callbackData: any): Promise<PaymentResponse> {
    const md = callbackData?.mdstatus || callbackData?.MDSTATUS;
    const orderId = callbackData?.orderid || callbackData?.OrderId;
    if (!md || !['1', '2', '3', '4'].includes(String(md))) {
      return {
        status: PaymentStatus.FAILURE,
        paymentId: orderId,
        errorMessage: `3D authentication failed (mdStatus=${md})`,
        rawResponse: callbackData,
      };
    }
    return {
      status: PaymentStatus.SUCCESS,
      paymentId: orderId,
      conversationId: orderId,
      rawResponse: callbackData,
    };
  }

  async refund(request: RefundRequest): Promise<RefundResponse> {
    try {
      const amount = formatGarantiAmount(request.price);
      const securityData = buildSecurityData(this.provisionPassword, this.terminalId);
      const hashData = buildHashData({
        orderId: request.paymentId,
        terminalId: this.terminalId,
        cardNumber: '',
        amount,
        securityData,
      });
      const xml = buildXmlRequest({
        Mode: 'PROD',
        Version: 'v1.0',
        Terminal: {
          ProvUserID: 'PROVRFN',
          UserID: this.provisionUser,
          HashData: hashData,
          ID: this.terminalId,
          MerchantID: this.merchantId,
        },
        Order: { OrderID: request.paymentId },
        Transaction: {
          Type: 'refund',
          Amount: amount,
          CurrencyCode: getGarantiCurrency(request.currency as string),
        },
      });
      const res = await this.client.post<string>(POS_PATH, `data=${encodeURIComponent(xml)}`);
      const code = parseXmlScalar(res.data, 'ReasonCode');
      return {
        status: this.mapStatus(code),
        refundId: request.paymentId,
        conversationId: request.conversationId,
        errorCode: code,
        errorMessage: parseXmlScalar(res.data, 'ErrorMsg'),
        rawResponse: res.data,
      };
    } catch (err: any) {
      return {
        status: PaymentStatus.FAILURE,
        errorMessage: err?.message || 'Garanti refund failed',
        rawResponse: err?.response?.data,
      };
    }
  }

  async cancel(request: CancelRequest): Promise<CancelResponse> {
    try {
      const securityData = buildSecurityData(this.provisionPassword, this.terminalId);
      const hashData = buildHashData({
        orderId: request.paymentId,
        terminalId: this.terminalId,
        cardNumber: '',
        amount: '0',
        securityData,
      });
      const xml = buildXmlRequest({
        Mode: 'PROD',
        Version: 'v1.0',
        Terminal: {
          ProvUserID: 'PROVRFN',
          UserID: this.provisionUser,
          HashData: hashData,
          ID: this.terminalId,
          MerchantID: this.merchantId,
        },
        Order: { OrderID: request.paymentId },
        Transaction: { Type: 'void', Amount: '0', CurrencyCode: '949' },
      });
      const res = await this.client.post<string>(POS_PATH, `data=${encodeURIComponent(xml)}`);
      const code = parseXmlScalar(res.data, 'ReasonCode');
      return {
        status: this.mapStatus(code),
        voidId: request.paymentId,
        conversationId: request.conversationId,
        errorCode: code,
        errorMessage: parseXmlScalar(res.data, 'ErrorMsg'),
        rawResponse: res.data,
      };
    } catch (err: any) {
      return {
        status: PaymentStatus.FAILURE,
        errorMessage: err?.message || 'Garanti cancel failed',
        rawResponse: err?.response?.data,
      };
    }
  }

  async getPayment(paymentId: string): Promise<PaymentResponse> {
    try {
      const securityData = buildSecurityData(this.provisionPassword, this.terminalId);
      const hashData = buildHashData({
        orderId: paymentId,
        terminalId: this.terminalId,
        cardNumber: '',
        amount: '0',
        securityData,
      });
      const xml = buildXmlRequest({
        Mode: 'PROD',
        Version: 'v1.0',
        Terminal: {
          ProvUserID: this.provisionUser,
          UserID: this.provisionUser,
          HashData: hashData,
          ID: this.terminalId,
          MerchantID: this.merchantId,
        },
        Order: { OrderID: paymentId },
        Transaction: { Type: 'orderinq', Amount: '0', CurrencyCode: '949' },
      });
      const res = await this.client.post<string>(POS_PATH, `data=${encodeURIComponent(xml)}`);
      const code = parseXmlScalar(res.data, 'ReasonCode');
      return {
        status: this.mapStatus(code),
        paymentId,
        errorCode: code,
        errorMessage: parseXmlScalar(res.data, 'ErrorMsg'),
        rawResponse: res.data,
      };
    } catch (err: any) {
      return {
        status: PaymentStatus.FAILURE,
        errorMessage: err?.message || 'Garanti getPayment failed',
        rawResponse: err?.response?.data,
      };
    }
  }
}

