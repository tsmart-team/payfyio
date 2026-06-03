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
import {
  StripeConfig,
  StripePaymentIntent,
  StripeRefund,
  StripeError,
} from './types';
import {
  toStripeAmount,
  fromStripeAmount,
  toStripeCurrency,
  encodeStripeForm,
  buildRedirectHtml,
} from './utils';

const DEFAULT_API_VERSION = '2024-06-20';

const TEST_CARD_TO_PM: Record<string, string> = {
  '4242424242424242': 'pm_card_visa',
  '4000056655665556': 'pm_card_visa_debit',
  '5555555555554444': 'pm_card_mastercard',
  '2223003122003222': 'pm_card_mastercard_2',
  '5200828282828210': 'pm_card_mastercard_debit',
  '5105105105105100': 'pm_card_mastercard_prepaid',
  '378282246310005': 'pm_card_amex',
  '371449635398431': 'pm_card_amex_2',
  '6011111111111117': 'pm_card_discover',
  '6011000990139424': 'pm_card_discover_2',
  '3056930009020004': 'pm_card_diners',
  '36227206271667': 'pm_card_diners_14',
  '3566002020360505': 'pm_card_jcb',
  '6200000000000005': 'pm_card_unionpay',
  '4000000000000002': 'pm_card_chargeDeclined',
  '4000000000009995': 'pm_card_chargeDeclinedInsufficientFunds',
  '4000000000009987': 'pm_card_chargeDeclinedLostCard',
  '4000000000009979': 'pm_card_chargeDeclinedStolenCard',
  '4000000000000069': 'pm_card_chargeDeclinedExpiredCard',
  '4000000000000127': 'pm_card_chargeDeclinedIncorrectCvc',
  '4000000000000119': 'pm_card_chargeDeclinedProcessingError',
  '4000002500003155': 'pm_card_threeDSecure2Required',
  '4000002760003184': 'pm_card_authenticationRequired',
};

function resolveTestPaymentMethod(rawNumber: string): string | undefined {
  return TEST_CARD_TO_PM[rawNumber.replace(/\s+/g, '')];
}

export class Stripe extends PaymentProvider {
  private client: AxiosInstance;

  constructor(config: PaymentProviderConfig & StripeConfig) {
    super(config);
    this.client = axios.create({
      baseURL: this.config.baseUrl,
      timeout: 30000,
      headers: {
        Authorization: `Bearer ${this.config.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Stripe-Version': config.apiVersion || DEFAULT_API_VERSION,
      },
    });
    this.setupAxiosLogging(this.client, 'stripe');
    this.setupAxiosRetry(this.client);
  }

  protected validateConfig(): void {
    if (!this.config.secretKey) {
      throw new Error('Stripe secret key is required');
    }
  }

  private mapStatus(status: StripePaymentIntent['status']): PaymentStatus {
    switch (status) {
      case 'succeeded':
        return PaymentStatus.SUCCESS;
      case 'canceled':
        return PaymentStatus.FAILURE;
      case 'requires_action':
      case 'processing':
      case 'requires_confirmation':
      case 'requires_capture':
        return PaymentStatus.PENDING;
      default:
        return PaymentStatus.FAILURE;
    }
  }

  private extractError(err: unknown): { code?: string; message: string; raw: unknown } {
    if (axios.isAxiosError(err) && err.response?.data) {
      const data = err.response.data as Partial<StripeError>;
      return {
        code: data.error?.code,
        message: data.error?.message || err.message,
        raw: err.response.data,
      };
    }
    const e = err as Error;
    return { message: e?.message || 'Stripe request failed', raw: err };
  }

  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    try {
      const testPm = resolveTestPaymentMethod(request.paymentCard.cardNumber);
      const paymentMethodFields = testPm
        ? { payment_method: testPm }
        : {
            payment_method_data: {
              type: 'card',
              card: {
                number: request.paymentCard.cardNumber.replace(/\s+/g, ''),
                exp_month: request.paymentCard.expireMonth,
                exp_year: request.paymentCard.expireYear,
                cvc: request.paymentCard.cvc,
              },
              billing_details: {
                name: request.paymentCard.cardHolderName,
                email: request.buyer?.email,
              },
            },
          };

      const body = encodeStripeForm({
        amount: toStripeAmount(request.price),
        currency: toStripeCurrency(request.currency as string),
        confirm: 'true',
        ...paymentMethodFields,
        payment_method_types: ['card'],
        receipt_email: request.buyer?.email,
        metadata: {
          conversation_id: request.conversationId || '',
          basket_id: request.basketId,
        },
      });

      const res = await this.client.post<StripePaymentIntent>('/v1/payment_intents', body);
      const pi = res.data;

      if (pi.status === 'requires_action') {
        return {
          status: PaymentStatus.FAILURE,
          paymentId: pi.id,
          conversationId: request.conversationId,
          errorMessage: 'Card requires 3D Secure. Use initThreeDSPayment instead.',
          rawResponse: pi,
        };
      }

      return {
        status: this.mapStatus(pi.status),
        paymentId: pi.id,
        conversationId: request.conversationId,
        errorCode: pi.last_payment_error?.code,
        errorMessage: pi.last_payment_error?.message,
        rawResponse: pi,
      };
    } catch (err) {
      const e = this.extractError(err);
      return {
        status: PaymentStatus.FAILURE,
        errorCode: e.code,
        errorMessage: e.message,
        rawResponse: e.raw,
      };
    }
  }

  async initThreeDSPayment(request: ThreeDSPaymentRequest): Promise<ThreeDSInitResponse> {
    try {
      const testPm = resolveTestPaymentMethod(request.paymentCard.cardNumber);
      const paymentMethodFields = testPm
        ? { payment_method: testPm }
        : {
            payment_method_data: {
              type: 'card',
              card: {
                number: request.paymentCard.cardNumber.replace(/\s+/g, ''),
                exp_month: request.paymentCard.expireMonth,
                exp_year: request.paymentCard.expireYear,
                cvc: request.paymentCard.cvc,
              },
              billing_details: {
                name: request.paymentCard.cardHolderName,
                email: request.buyer?.email,
              },
            },
          };

      const body = encodeStripeForm({
        amount: toStripeAmount(request.price),
        currency: toStripeCurrency(request.currency as string),
        confirm: 'true',
        return_url: request.callbackUrl,
        ...paymentMethodFields,
        payment_method_types: ['card'],
        receipt_email: request.buyer?.email,
        metadata: {
          conversation_id: request.conversationId || '',
          basket_id: request.basketId,
        },
      });

      const res = await this.client.post<StripePaymentIntent>('/v1/payment_intents', body);
      const pi = res.data;

      const redirectUrl = pi.next_action?.redirect_to_url?.url;
      if (pi.status === 'requires_action' && redirectUrl) {
        return {
          status: PaymentStatus.PENDING,
          threeDSHtmlContent: buildRedirectHtml(redirectUrl),
          paymentId: pi.id,
          conversationId: request.conversationId,
          rawResponse: pi,
        };
      }

      if (pi.status === 'succeeded') {
        return {
          status: PaymentStatus.SUCCESS,
          paymentId: pi.id,
          conversationId: request.conversationId,
          rawResponse: pi,
        };
      }

      return {
        status: PaymentStatus.FAILURE,
        paymentId: pi.id,
        conversationId: request.conversationId,
        errorCode: pi.last_payment_error?.code,
        errorMessage: pi.last_payment_error?.message || `Unexpected status: ${pi.status}`,
        rawResponse: pi,
      };
    } catch (err) {
      const e = this.extractError(err);
      return {
        status: PaymentStatus.FAILURE,
        errorCode: e.code,
        errorMessage: e.message,
        rawResponse: e.raw,
      };
    }
  }

  async completeThreeDSPayment(callbackData: any): Promise<PaymentResponse> {
    try {
      const paymentIntentId: string =
        callbackData?.payment_intent ||
        callbackData?.paymentIntentId ||
        callbackData?.paymentId;
      if (!paymentIntentId) {
        return {
          status: PaymentStatus.FAILURE,
          errorMessage: 'Missing payment_intent in callback data',
          rawResponse: callbackData,
        };
      }
      return this.getPayment(paymentIntentId);
    } catch (err) {
      const e = this.extractError(err);
      return {
        status: PaymentStatus.FAILURE,
        errorCode: e.code,
        errorMessage: e.message,
        rawResponse: e.raw,
      };
    }
  }

  async refund(request: RefundRequest): Promise<RefundResponse> {
    try {
      const body = encodeStripeForm({
        payment_intent: request.paymentId,
        amount: toStripeAmount(request.price),
      });
      const res = await this.client.post<StripeRefund>('/v1/refunds', body);
      const r = res.data;
      return {
        status: r.status === 'succeeded' ? PaymentStatus.SUCCESS : r.status === 'pending' ? PaymentStatus.PENDING : PaymentStatus.FAILURE,
        refundId: r.id,
        conversationId: request.conversationId,
        errorMessage: r.failure_reason,
        rawResponse: r,
      };
    } catch (err) {
      const e = this.extractError(err);
      return {
        status: PaymentStatus.FAILURE,
        errorCode: e.code,
        errorMessage: e.message,
        rawResponse: e.raw,
      };
    }
  }

  async cancel(request: CancelRequest): Promise<CancelResponse> {
    try {
      const res = await this.client.post<StripePaymentIntent>(
        `/v1/payment_intents/${encodeURIComponent(request.paymentId)}/cancel`,
        '',
      );
      const pi = res.data;
      return {
        status: pi.status === 'canceled' ? PaymentStatus.SUCCESS : PaymentStatus.FAILURE,
        voidId: pi.id,
        conversationId: request.conversationId,
        errorCode: pi.last_payment_error?.code,
        errorMessage: pi.last_payment_error?.message,
        rawResponse: pi,
      };
    } catch (err) {
      const e = this.extractError(err);
      return {
        status: PaymentStatus.FAILURE,
        errorCode: e.code,
        errorMessage: e.message,
        rawResponse: e.raw,
      };
    }
  }

  async getPayment(paymentId: string): Promise<PaymentResponse> {
    try {
      const res = await this.client.get<StripePaymentIntent>(
        `/v1/payment_intents/${encodeURIComponent(paymentId)}`,
      );
      const pi = res.data;
      return {
        status: this.mapStatus(pi.status),
        paymentId: pi.id,
        errorCode: pi.last_payment_error?.code,
        errorMessage: pi.last_payment_error?.message,
        rawResponse: { ...pi, amount: fromStripeAmount(pi.amount) },
      };
    } catch (err) {
      const e = this.extractError(err);
      return {
        status: PaymentStatus.FAILURE,
        errorCode: e.code,
        errorMessage: e.message,
        rawResponse: e.raw,
      };
    }
  }
}
