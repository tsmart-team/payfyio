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
import { YapiKrediConfig } from './types';
import {
  buildPosnet3DHash,
  buildXmlEnvelope,
  parseXmlScalar,
  buildRedirectFormHtml,
  formatYapiKrediAmount,
  getYapiKrediCurrency,
  formatExpDateYYMM,
} from './utils';

const POSNET_PATH = '/PosnetWebService/XML';
const THREED_PATH = '/3DSWebService/YKBPaymentService';

/**
 * Yapı Kredi Posnet Sanal POS provider.
 *
 * Auth model: merchantId + terminalId + posnetId + encKey. XML over HTTPS.
 */
export class YapiKredi extends PaymentProvider {
  private client: AxiosInstance;
  private merchantId: string;
  private terminalId: string;
  private posnetId: string;
  private encKey: string;

  constructor(config: PaymentProviderConfig & YapiKrediConfig) {
    if (!config.merchantId) throw new Error('Yapı Kredi merchantId is required');
    if (!config.terminalId) throw new Error('Yapı Kredi terminalId is required');
    if (!config.posnetId) throw new Error('Yapı Kredi posnetId is required');
    if (!config.encKey) throw new Error('Yapı Kredi encKey is required');
    super({ ...config, apiKey: config.merchantId, secretKey: config.encKey });
    this.merchantId = config.merchantId;
    this.terminalId = config.terminalId;
    this.posnetId = config.posnetId;
    this.encKey = config.encKey;
    this.client = axios.create({
      baseURL: this.config.baseUrl,
      timeout: 30000,
    });
    this.setupAxiosLogging(this.client, 'yapikredi');
    this.setupAxiosRetry(this.client);
  }

  protected validateConfig(): void {
    // Validation in constructor.
  }

  private mapStatus(approved?: string, code?: string): PaymentStatus {
    if (approved === '1' && (!code || code === '00')) return PaymentStatus.SUCCESS;
    if (approved === '0') return PaymentStatus.FAILURE;
    return PaymentStatus.PENDING;
  }

  private async postXml(payload: Record<string, any>): Promise<string> {
    const xml = buildXmlEnvelope({
      mid: this.merchantId,
      tid: this.terminalId,
      ...payload,
    });
    const res = await this.client.post<string>(POSNET_PATH, `xmldata=${encodeURIComponent(xml)}`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    return res.data;
  }

  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    const orderId = request.conversationId || `YKB-${Date.now()}`;
    try {
      const data = await this.postXml({
        sale: {
          amount: formatYapiKrediAmount(request.price),
          currencyCode: getYapiKrediCurrency(request.currency as string),
          orderID: orderId,
          installment: '00',
          ccno: request.paymentCard.cardNumber,
          expDate: formatExpDateYYMM(request.paymentCard.expireMonth, request.paymentCard.expireYear),
          cvc: request.paymentCard.cvc,
        },
      });
      return {
        status: this.mapStatus(parseXmlScalar(data, 'approved'), parseXmlScalar(data, 'respCode')),
        paymentId: parseXmlScalar(data, 'hostlogkey') || orderId,
        conversationId: orderId,
        errorCode: parseXmlScalar(data, 'respCode'),
        errorMessage: parseXmlScalar(data, 'respText'),
        rawResponse: data,
      };
    } catch (err: any) {
      return {
        status: PaymentStatus.FAILURE,
        errorMessage: err?.message || 'Yapı Kredi createPayment failed',
        rawResponse: err?.response?.data,
      };
    }
  }

  async initThreeDSPayment(request: ThreeDSPaymentRequest): Promise<ThreeDSInitResponse> {
    const orderId = request.conversationId || `YKB-${Date.now()}`;
    const amount = formatYapiKrediAmount(request.price);
    const currency = getYapiKrediCurrency(request.currency as string);
    const xid = orderId.padEnd(20, '0').slice(0, 20);
    const hash = buildPosnet3DHash({
      merchantId: this.merchantId,
      terminalId: this.terminalId,
      amount,
      currency,
      orderId,
      xid,
      okUrl: request.callbackUrl,
      failUrl: request.callbackUrl,
      encKey: this.encKey,
    });
    const fields: Record<string, string> = {
      mid: this.merchantId,
      posnetID: this.posnetId,
      tranType: 'Sale',
      amount,
      currencyCode: currency,
      orderID: orderId,
      installment: '0',
      ccno: request.paymentCard.cardNumber,
      cvc: request.paymentCard.cvc,
      expDate: formatExpDateYYMM(request.paymentCard.expireMonth, request.paymentCard.expireYear),
      xid,
      merchantReturnURL: request.callbackUrl,
      lang: 'tr',
      digest: hash,
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
    const md = callbackData?.MdStatus || callbackData?.mdStatus;
    const orderId = callbackData?.orderID || callbackData?.OrderId;
    if (!md || !['1', '2', '3', '4'].includes(String(md))) {
      return {
        status: PaymentStatus.FAILURE,
        paymentId: orderId,
        errorMessage: `3D authentication failed (mdStatus=${md})`,
        rawResponse: callbackData,
      };
    }
    // SECURITY (fail-closed): the Posnet 3D response carries a MAC (SHA256
    // over the response fields + encKey) that MUST be recomputed and
    // constant-time compared before trusting MdStatus. Not implemented yet,
    // so we refuse to confirm — a forged callback would otherwise mark an
    // unpaid order paid. Do NOT remove until response-MAC verification +
    // amount binding are implemented and tested against the bank sandbox.
    return {
      status: PaymentStatus.FAILURE,
      paymentId: orderId,
      errorMessage:
        'Yapı Kredi (Posnet) 3DS callback MAC verification is not implemented; refusing to confirm payment. ' +
        'Implement response-MAC verification before enabling this provider in production.',
      rawResponse: callbackData,
    };
  }

  async refund(request: RefundRequest): Promise<RefundResponse> {
    try {
      const data = await this.postXml({
        return: {
          hostLogKey: request.paymentId,
          amount: formatYapiKrediAmount(request.price),
          currencyCode: getYapiKrediCurrency(request.currency as string),
        },
      });
      return {
        status: this.mapStatus(parseXmlScalar(data, 'approved'), parseXmlScalar(data, 'respCode')),
        refundId: request.paymentId,
        conversationId: request.conversationId,
        errorCode: parseXmlScalar(data, 'respCode'),
        errorMessage: parseXmlScalar(data, 'respText'),
        rawResponse: data,
      };
    } catch (err: any) {
      return {
        status: PaymentStatus.FAILURE,
        errorMessage: err?.message || 'Yapı Kredi refund failed',
        rawResponse: err?.response?.data,
      };
    }
  }

  async cancel(request: CancelRequest): Promise<CancelResponse> {
    try {
      const data = await this.postXml({
        reverse: { hostLogKey: request.paymentId, transaction: 'sale' },
      });
      return {
        status: this.mapStatus(parseXmlScalar(data, 'approved'), parseXmlScalar(data, 'respCode')),
        voidId: request.paymentId,
        conversationId: request.conversationId,
        errorCode: parseXmlScalar(data, 'respCode'),
        errorMessage: parseXmlScalar(data, 'respText'),
        rawResponse: data,
      };
    } catch (err: any) {
      return {
        status: PaymentStatus.FAILURE,
        errorMessage: err?.message || 'Yapı Kredi cancel failed',
        rawResponse: err?.response?.data,
      };
    }
  }

  async getPayment(paymentId: string): Promise<PaymentResponse> {
    try {
      const data = await this.postXml({
        agreement: { hostLogKey: paymentId },
      });
      return {
        status: this.mapStatus(parseXmlScalar(data, 'approved'), parseXmlScalar(data, 'respCode')),
        paymentId,
        errorCode: parseXmlScalar(data, 'respCode'),
        errorMessage: parseXmlScalar(data, 'respText'),
        rawResponse: data,
      };
    } catch (err: any) {
      return {
        status: PaymentStatus.FAILURE,
        errorMessage: err?.message || 'Yapı Kredi getPayment failed',
        rawResponse: err?.response?.data,
      };
    }
  }
}

