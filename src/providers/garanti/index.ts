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
  verifyGaranti3DHash,
  buildXmlRequest,
  parseXmlScalar,
  buildRedirectFormHtml,
  formatGarantiAmount,
  getGarantiCurrency,
} from './utils';

const THREE_D_GATE_PATH = '/servlet/gt3dengine';
const POS_PATH = '/VPServlet';
const API_VERSION = '512';
/** Refund/void run under the PROVRFN provision user, not PROVAUT. */
const REFUND_PROV_USER = 'PROVRFN';

/**
 * Garanti BBVA Sanal POS (GVP) provider — API version 512.
 *
 * Auth model: MerchantID + TerminalID + ProvisionUser/Password, plus a StoreKey
 * that signs the 3D request and the 3D response. XML over HTTPS to /VPServlet
 * for direct ops, form-POST to /servlet/gt3dengine for 3DS.
 *
 * 3DS runs at `3D_PAY` security level: the bank authenticates *and* provisions
 * in one leg and posts the final result back, so there is no second call to
 * make. `3D_FULL` (merchant sends the provision itself) is not implemented.
 */
export class Garanti extends PaymentProvider {
  private client: AxiosInstance;
  private merchantId: string;
  private terminalId: string;
  private provisionUser: string;
  private provisionPassword: string;
  private refundPassword: string;
  private secure3DStoreKey: string;

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
    this.refundPassword = config.refundPassword || config.provisionPassword;
    // GVP issues one store key; `secure3DStoreKey` stays supported for merchants
    // whose 3D key was provisioned separately.
    this.secure3DStoreKey = config.secure3DStoreKey || config.storeKey;
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

  /** GVP rejects a PROD-mode request on the test host and vice versa. */
  private get mode(): 'TEST' | 'PROD' {
    return /test/i.test(this.config.baseUrl || '') ? 'TEST' : 'PROD';
  }

  private mapStatus(code?: string): PaymentStatus {
    if (!code) return PaymentStatus.PENDING;
    if (code === '00') return PaymentStatus.SUCCESS;
    return PaymentStatus.FAILURE;
  }

  private terminal(hashData: string, provUser = this.provisionUser) {
    return {
      ProvUserID: provUser,
      UserID: this.provisionUser,
      HashData: hashData,
      ID: this.terminalId,
      MerchantID: this.merchantId,
    };
  }

  private async postXml(xml: string) {
    const res = await this.client.post<string>(POS_PATH, `data=${encodeURIComponent(xml)}`);
    return {
      code: parseXmlScalar(res.data, 'ReasonCode') || parseXmlScalar(res.data, 'Code'),
      message: parseXmlScalar(res.data, 'ErrorMsg') || parseXmlScalar(res.data, 'Message'),
      raw: res.data,
    };
  }

  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    const orderId = request.conversationId || `GAR-${Date.now()}`;
    try {
      const amount = formatGarantiAmount(request.price);
      const currencyCode = getGarantiCurrency(request.currency as string);
      const installments = (request as any).installment as number | undefined;
      const installment = installments && installments > 1 ? String(installments) : '';
      const xml = buildXmlRequest({
        Mode: this.mode,
        Version: API_VERSION,
        Terminal: this.terminal(
          buildHashData({
            orderId,
            terminalId: this.terminalId,
            cardNumber: request.paymentCard.cardNumber,
            amount,
            currencyCode,
            securityData: buildSecurityData(this.provisionPassword, this.terminalId),
          }),
        ),
        Customer: {
          IPAddress: request.buyer?.ip || '127.0.0.1',
          EmailAddress: request.buyer?.email,
        },
        Card: {
          Number: request.paymentCard.cardNumber,
          ExpireDate: `${String(request.paymentCard.expireMonth).padStart(2, '0')}${String(request.paymentCard.expireYear).slice(-2)}`,
          CVV2: request.paymentCard.cvc,
        },
        Order: { OrderID: orderId, GroupID: '' },
        Transaction: {
          Type: 'sales',
          InstallmentCnt: installment,
          Amount: amount,
          CurrencyCode: currencyCode,
          CardholderPresentCode: '0',
          MotoInd: 'N',
          Description: request.basketId,
        },
      });
      const { code, message, raw } = await this.postXml(xml);
      return {
        status: this.mapStatus(code),
        paymentId: orderId,
        conversationId: orderId,
        errorCode: code,
        errorMessage: message,
        rawResponse: raw,
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
    const orderId = request.conversationId || `GAR-${Date.now()}`;
    const amount = formatGarantiAmount(request.price);
    const currencyCode = getGarantiCurrency(request.currency as string);
    const installment =
      request.installment && request.installment > 1 ? String(request.installment) : '';
    const fields: Record<string, string> = {
      mode: this.mode,
      apiversion: API_VERSION,
      secure3dsecuritylevel: '3D_PAY',
      terminalprovuserid: this.provisionUser,
      terminaluserid: this.provisionUser,
      terminalmerchantid: this.merchantId,
      terminalid: this.terminalId,
      orderid: orderId,
      successurl: request.callbackUrl,
      errorurl: request.callbackUrl,
      customeremailaddress: request.buyer?.email || '',
      customeripaddress: request.buyer?.ip || '127.0.0.1',
      txntimestamp: new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14),
      txnamount: amount,
      txncurrencycode: currencyCode,
      txntype: 'sales',
      txninstallmentcount: installment,
      cardholdername: request.paymentCard.cardHolderName || '',
      cardnumber: request.paymentCard.cardNumber,
      cardexpiredatemonth: String(request.paymentCard.expireMonth).padStart(2, '0'),
      cardexpiredateyear: String(request.paymentCard.expireYear).slice(-2),
      cardcvv2: request.paymentCard.cvc,
      lang: 'tr',
      refreshtime: '5',
      secure3dhash: build3DHashData({
        terminalId: this.terminalId,
        orderId,
        amount,
        currencyCode,
        successUrl: request.callbackUrl,
        failUrl: request.callbackUrl,
        txnType: 'sales',
        installment,
        storeKey: this.secure3DStoreKey,
        securityData: buildSecurityData(this.provisionPassword, this.terminalId),
      }),
    };
    return {
      status: PaymentStatus.PENDING,
      threeDSHtmlContent: buildRedirectFormHtml(
        `${this.config.baseUrl}${THREE_D_GATE_PATH}`,
        fields,
      ),
      paymentId: orderId,
      conversationId: orderId,
    };
  }

  /**
   * Confirm a 3D_PAY callback.
   *
   * Order matters: the response HASH is checked *first*, so `mdstatus` and
   * `procreturncode` are only ever read out of a payload the bank signed with
   * the StoreKey. Amount/currency need no separate assertion here — they were
   * signed into `secure3dhash` at init, and the bank provisions the amount it
   * signed, so the (unsigned) `txnamount` echo can't change what was charged.
   */
  async completeThreeDSPayment(callbackData: any): Promise<PaymentResponse> {
    const data = (callbackData || {}) as Record<string, any>;
    const get = (name: string): string => {
      const hit = Object.keys(data).find((k) => k.toLowerCase() === name);
      return hit === undefined || data[hit] == null ? '' : String(data[hit]);
    };
    const orderId = get('oid') || get('orderid');

    if (!verifyGaranti3DHash(data, this.secure3DStoreKey)) {
      return {
        status: PaymentStatus.FAILURE,
        paymentId: orderId,
        errorMessage: 'Garanti 3DS callback hash verification failed',
        rawResponse: callbackData,
      };
    }

    const mdStatus = get('mdstatus');
    if (!['1', '2', '3', '4'].includes(mdStatus)) {
      return {
        status: PaymentStatus.FAILURE,
        paymentId: orderId,
        errorCode: mdStatus,
        errorMessage: get('mderrormessage') || `3D authentication failed (mdStatus=${mdStatus})`,
        rawResponse: callbackData,
      };
    }

    const procReturnCode = get('procreturncode');
    if (procReturnCode !== '00') {
      return {
        status: PaymentStatus.FAILURE,
        paymentId: orderId,
        errorCode: procReturnCode,
        errorMessage: get('errmsg') || `Provision declined (procReturnCode=${procReturnCode})`,
        rawResponse: callbackData,
      };
    }

    return {
      status: PaymentStatus.SUCCESS,
      paymentId: orderId,
      conversationId: orderId,
      errorCode: procReturnCode,
      rawResponse: callbackData,
    };
  }

  async refund(request: RefundRequest): Promise<RefundResponse> {
    try {
      const amount = formatGarantiAmount(request.price);
      const currencyCode = getGarantiCurrency(request.currency as string);
      const xml = buildXmlRequest({
        Mode: this.mode,
        Version: API_VERSION,
        Terminal: this.terminal(
          buildHashData({
            orderId: request.paymentId,
            terminalId: this.terminalId,
            cardNumber: '',
            amount,
            currencyCode,
            securityData: buildSecurityData(this.refundPassword, this.terminalId),
          }),
          REFUND_PROV_USER,
        ),
        Customer: { IPAddress: request.ip || '127.0.0.1' },
        Order: { OrderID: request.paymentId },
        Transaction: {
          Type: 'refund',
          Amount: amount,
          CurrencyCode: currencyCode,
          CardholderPresentCode: '0',
          MotoInd: 'N',
        },
      });
      const { code, message, raw } = await this.postXml(xml);
      return {
        status: this.mapStatus(code),
        refundId: request.paymentId,
        conversationId: request.conversationId,
        errorCode: code,
        errorMessage: message,
        rawResponse: raw,
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
      // ponytail: CancelRequest carries no amount, so we void with 0 — GVP voids
      // the whole authorisation. Thread the original amount through if partial
      // void is ever needed.
      const amount = '0';
      const currencyCode = '949';
      const xml = buildXmlRequest({
        Mode: this.mode,
        Version: API_VERSION,
        Terminal: this.terminal(
          buildHashData({
            orderId: request.paymentId,
            terminalId: this.terminalId,
            cardNumber: '',
            amount,
            currencyCode,
            securityData: buildSecurityData(this.refundPassword, this.terminalId),
          }),
          REFUND_PROV_USER,
        ),
        Customer: { IPAddress: request.ip || '127.0.0.1' },
        Order: { OrderID: request.paymentId },
        Transaction: {
          Type: 'void',
          Amount: amount,
          CurrencyCode: currencyCode,
          CardholderPresentCode: '0',
          MotoInd: 'N',
        },
      });
      const { code, message, raw } = await this.postXml(xml);
      return {
        status: this.mapStatus(code),
        voidId: request.paymentId,
        conversationId: request.conversationId,
        errorCode: code,
        errorMessage: message,
        rawResponse: raw,
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
      const xml = buildXmlRequest({
        Mode: this.mode,
        Version: API_VERSION,
        Terminal: this.terminal(
          buildHashData({
            orderId: paymentId,
            terminalId: this.terminalId,
            cardNumber: '',
            amount: '0',
            currencyCode: '949',
            securityData: buildSecurityData(this.provisionPassword, this.terminalId),
          }),
        ),
        Customer: { IPAddress: '127.0.0.1' },
        Order: { OrderID: paymentId },
        Transaction: { Type: 'orderinq', Amount: '0', CurrencyCode: '949' },
      });
      const { code, message, raw } = await this.postXml(xml);
      return {
        status: this.mapStatus(code),
        paymentId,
        errorCode: code,
        errorMessage: message,
        rawResponse: raw,
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
