import { describe, it, expect, vi } from 'vitest';
import { Stripe } from '../../../../src/providers/stripe';
import { PaymentStatus } from '../../../../src/types';
import {
  toStripeAmount,
  encodeStripeForm,
  buildRedirectHtml,
  toStripeCurrency,
} from '../../../../src/providers/stripe/utils';

function makeStripe() {
  return new Stripe({
    apiKey: 'pk_test',
    secretKey: 'sk_test_x',
    baseUrl: 'https://api.stripe.com',
  } as any);
}

describe('Stripe provider', () => {
  describe('utils', () => {
    it('converts decimal price to integer cents', () => {
      expect(toStripeAmount('10')).toBe(1000);
      expect(toStripeAmount('10.50')).toBe(1050);
      expect(toStripeAmount('0.01')).toBe(1);
    });

    it('rejects negative or non-finite price', () => {
      expect(() => toStripeAmount('-5')).toThrow(/Invalid price/);
      expect(() => toStripeAmount('abc')).toThrow(/Invalid price/);
    });

    it('lowercases currency for Stripe', () => {
      expect(toStripeCurrency('TRY')).toBe('try');
      expect(toStripeCurrency('USD')).toBe('usd');
    });

    it('encodes nested form data with bracketed keys', () => {
      const out = encodeStripeForm({
        amount: 100,
        payment_method_data: { type: 'card', card: { number: '4242' } },
      });
      expect(out).toContain('amount=100');
      expect(out).toContain('payment_method_data%5Btype%5D=card');
      expect(out).toContain('payment_method_data%5Bcard%5D%5Bnumber%5D=4242');
    });

    it('skips undefined / null values when encoding', () => {
      const out = encodeStripeForm({ a: 1, b: undefined, c: null, d: 'x' });
      expect(out).toBe('a=1&d=x');
    });

    it('builds a self-submitting redirect HTML', () => {
      const html = buildRedirectHtml('https://example.com/3ds');
      expect(html).toContain('https://example.com/3ds');
      expect(html.toLowerCase()).toContain('<meta http-equiv="refresh"');
    });
  });

  describe('constructor', () => {
    it('requires secretKey', () => {
      expect(
        () =>
          new Stripe({
            apiKey: '',
            secretKey: '',
            baseUrl: 'https://api.stripe.com',
          } as any),
      ).toThrow(/secret key is required/i);
    });

    it('instantiates with valid secret key', () => {
      const s = new Stripe({
        apiKey: 'pk_test',
        secretKey: 'sk_test_x',
        baseUrl: 'https://api.stripe.com',
      } as any);
      expect(s).toBeInstanceOf(Stripe);
    });
  });

  describe('capturePayment', () => {
    it('captures the full amount when amountMinor is omitted (no amount_to_capture)', async () => {
      const s = makeStripe();
      const post = vi.spyOn((s as any).client, 'post').mockResolvedValue({
        data: { id: 'pi_1', object: 'payment_intent', status: 'succeeded', amount: 10000, currency: 'try' },
      });

      const result = await s.capturePayment({ paymentId: 'pi_1' });

      expect(post).toHaveBeenCalledWith('/v1/payment_intents/pi_1/capture', '', undefined);
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.paymentId).toBe('pi_1');
      expect(result.capturedAmountMinor).toBe(10000);
    });

    it('sends amount_to_capture for partial capture', async () => {
      const s = makeStripe();
      const post = vi.spyOn((s as any).client, 'post').mockResolvedValue({
        data: { id: 'pi_2', object: 'payment_intent', status: 'succeeded', amount: 10000, currency: 'try' },
      });

      const result = await s.capturePayment({ paymentId: 'pi_2', amountMinor: 4000 });

      expect(post).toHaveBeenCalledWith('/v1/payment_intents/pi_2/capture', 'amount_to_capture=4000', undefined);
      expect(result.capturedAmountMinor).toBe(4000);
    });

    it('maps Stripe errors to a failure response', async () => {
      const s = makeStripe();
      vi.spyOn((s as any).client, 'post').mockRejectedValue({
        isAxiosError: true,
        response: { data: { error: { code: 'payment_intent_unexpected_state', message: 'cannot capture' } } },
        message: 'Request failed',
      });

      const result = await s.capturePayment({ paymentId: 'pi_3' });

      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('payment_intent_unexpected_state');
    });
  });

  describe('voidAuthorization', () => {
    it('cancels the payment intent and maps canceled → success', async () => {
      const s = makeStripe();
      const post = vi.spyOn((s as any).client, 'post').mockResolvedValue({
        data: { id: 'pi_4', object: 'payment_intent', status: 'canceled', amount: 10000, currency: 'try' },
      });

      const result = await s.voidAuthorization({ paymentId: 'pi_4' });

      expect(post).toHaveBeenCalledWith('/v1/payment_intents/pi_4/cancel', '', undefined);
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.voidId).toBe('pi_4');
    });

    it('maps a non-canceled status to failure', async () => {
      const s = makeStripe();
      vi.spyOn((s as any).client, 'post').mockResolvedValue({
        data: { id: 'pi_5', object: 'payment_intent', status: 'succeeded', amount: 10000, currency: 'try' },
      });

      const result = await s.voidAuthorization({ paymentId: 'pi_5' });

      expect(result.status).toBe(PaymentStatus.FAILURE);
    });
  });

  describe('idempotency', () => {
    it('sends Idempotency-Key header when idempotencyKey is provided', async () => {
      const s = makeStripe();
      const post = vi.spyOn((s as any).client, 'post').mockResolvedValue({
        data: { id: 'pi_i1', object: 'payment_intent', status: 'succeeded', amount: 10000, currency: 'try' },
      });

      await s.capturePayment({ paymentId: 'pi_i1', idempotencyKey: 'idem-123' });

      expect(post).toHaveBeenCalledWith(
        '/v1/payment_intents/pi_i1/capture',
        '',
        { headers: { 'Idempotency-Key': 'idem-123' } },
      );
    });

    it('passes undefined config when no idempotencyKey is provided', async () => {
      const s = makeStripe();
      const post = vi.spyOn((s as any).client, 'post').mockResolvedValue({
        data: { id: 'pi_i2', object: 'payment_intent', status: 'canceled', amount: 10000, currency: 'try' },
      });

      await s.voidAuthorization({ paymentId: 'pi_i2' });

      expect(post).toHaveBeenCalledWith('/v1/payment_intents/pi_i2/cancel', '', undefined);
    });
  });

  describe('payout', () => {
    it('creates a transfer to a connected account', async () => {
      const s = makeStripe();
      const post = vi.spyOn((s as any).client, 'post').mockResolvedValue({
        data: { id: 'tr_1', object: 'transfer', amount: 5000, currency: 'try', destination: 'acct_123' },
      });

      const result = await s.payout({
        to: { accountId: 'acct_123' },
        amountMinor: 5000,
        currency: 'TRY',
        reference: 'ORDER-1',
      });

      expect(post).toHaveBeenCalledTimes(1);
      const [url, body] = post.mock.calls[0];
      expect(url).toBe('/v1/transfers');
      expect(body).toContain('amount=5000');
      expect(body).toContain('currency=try');
      expect(body).toContain('destination=acct_123');
      expect(body).toContain('transfer_group=ORDER-1');
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.payoutId).toBe('tr_1');
      expect(result.amountMinor).toBe(5000);
      expect(result.reference).toBe('ORDER-1');
    });

    it('threads the idempotency key into the transfer', async () => {
      const s = makeStripe();
      const post = vi.spyOn((s as any).client, 'post').mockResolvedValue({
        data: { id: 'tr_2', object: 'transfer', amount: 5000, currency: 'try', destination: 'acct_x' },
      });

      await s.payout({
        to: { accountId: 'acct_x' },
        amountMinor: 5000,
        currency: 'TRY',
        reference: 'R2',
        idempotencyKey: 'idem-payout',
      });

      expect(post.mock.calls[0][2]).toEqual({ headers: { 'Idempotency-Key': 'idem-payout' } });
    });

    it('rejects a bare IBAN destination without making an HTTP call', async () => {
      const s = makeStripe();
      const post = vi.spyOn((s as any).client, 'post');

      const result = await s.payout({
        to: { iban: 'TR000000000000000000000000' },
        amountMinor: 5000,
        currency: 'TRY',
        reference: 'R3',
      });

      expect(post).not.toHaveBeenCalled();
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorMessage).toMatch(/connected account/i);
    });

    it('maps Stripe errors to a failure response', async () => {
      const s = makeStripe();
      vi.spyOn((s as any).client, 'post').mockRejectedValue({
        isAxiosError: true,
        response: { data: { error: { code: 'balance_insufficient', message: 'Insufficient funds' } } },
        message: 'Request failed',
      });

      const result = await s.payout({
        to: { accountId: 'acct_z' },
        amountMinor: 5000,
        currency: 'TRY',
        reference: 'R4',
      });

      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('balance_insufficient');
    });
  });

  describe('submerchant (Connect)', () => {
    it('creates a connected account with external_id in metadata', async () => {
      const s = makeStripe();
      const post = vi.spyOn((s as any).client, 'post').mockResolvedValue({
        data: { id: 'acct_1', object: 'account', metadata: { external_id: 'carrier-42' } },
      });

      const result = await s.createSubmerchant({
        type: 'PRIVATE_COMPANY',
        name: 'Carrier Ltd',
        email: 'c@x.com',
        externalId: 'carrier-42',
      });

      const [url, body] = post.mock.calls[0];
      expect(url).toBe('/v1/accounts');
      expect(body).toContain('business_type=company');
      expect(body).toContain('metadata%5Bexternal_id%5D=carrier-42');
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.submerchantKey).toBe('acct_1');
      expect(result.externalId).toBe('carrier-42');
    });

    it('uses business_type=individual for PERSONAL type', async () => {
      const s = makeStripe();
      const post = vi.spyOn((s as any).client, 'post').mockResolvedValue({
        data: { id: 'acct_2', object: 'account', metadata: {} },
      });

      await s.createSubmerchant({ type: 'PERSONAL', name: 'X', email: 'x@y.com', externalId: 'e1' });

      expect(post.mock.calls[0][1]).toContain('business_type=individual');
    });

    it('retrieves an account by id', async () => {
      const s = makeStripe();
      const get = vi.spyOn((s as any).client, 'get').mockResolvedValue({
        data: { id: 'acct_3', object: 'account', metadata: { external_id: 'e3' } },
      });

      const result = await s.retrieveSubmerchant('acct_3');

      expect(get).toHaveBeenCalledWith('/v1/accounts/acct_3');
      expect(result.submerchantKey).toBe('acct_3');
    });
  });

  describe('marketplace split', () => {
    const splitReq = (extra: Record<string, unknown> = {}) => ({
      price: '100.00',
      currency: 'TRY',
      basketId: 'B1',
      paymentCard: { cardNumber: '4242424242424242', expireMonth: '12', expireYear: '2030', cvc: '123', cardHolderName: 'X' },
      buyer: { email: 'x@y.com' },
      ...extra,
    });

    it('adds transfer_data[destination] and application_fee_amount on createPayment', async () => {
      const s = makeStripe();
      const post = vi.spyOn((s as any).client, 'post').mockResolvedValue({
        data: { id: 'pi_s1', object: 'payment_intent', status: 'succeeded', amount: 10000, currency: 'try' },
      });

      await s.createPayment(splitReq({
        split: [{ submerchantId: 'acct_dest', amountMinor: 9000 }],
        platformCommissionMinor: 1000,
      }) as any);

      const body = post.mock.calls[0][1] as string;
      expect(body).toContain('transfer_data%5Bdestination%5D=acct_dest');
      expect(body).toContain('application_fee_amount=1000');
    });

    it('omits split fields when no split is provided', async () => {
      const s = makeStripe();
      const post = vi.spyOn((s as any).client, 'post').mockResolvedValue({
        data: { id: 'pi_s2', object: 'payment_intent', status: 'succeeded', amount: 10000, currency: 'try' },
      });

      await s.createPayment(splitReq() as any);

      const body = post.mock.calls[0][1] as string;
      expect(body).not.toContain('transfer_data');
      expect(body).not.toContain('application_fee_amount');
    });
  });

  describe('pre-auth body', () => {
    it('adds capture_method=manual when capture is false', async () => {
      const s = makeStripe();
      const post = vi.spyOn((s as any).client, 'post').mockResolvedValue({
        data: { id: 'pi_6', object: 'payment_intent', status: 'requires_capture', amount: 10000, currency: 'try' },
      });

      await s.createPayment({
        price: '100.00',
        currency: 'TRY',
        basketId: 'B1',
        paymentCard: { cardNumber: '4242424242424242', expireMonth: '12', expireYear: '2030', cvc: '123', cardHolderName: 'X' },
        buyer: { email: 'x@y.com' },
        capture: false,
      } as any);

      const body = post.mock.calls[0][1] as string;
      expect(body).toContain('capture_method=manual');
    });

    it('omits capture_method by default', async () => {
      const s = makeStripe();
      const post = vi.spyOn((s as any).client, 'post').mockResolvedValue({
        data: { id: 'pi_7', object: 'payment_intent', status: 'succeeded', amount: 10000, currency: 'try' },
      });

      await s.createPayment({
        price: '100.00',
        currency: 'TRY',
        basketId: 'B1',
        paymentCard: { cardNumber: '4242424242424242', expireMonth: '12', expireYear: '2030', cvc: '123', cardHolderName: 'X' },
        buyer: { email: 'x@y.com' },
      } as any);

      const body = post.mock.calls[0][1] as string;
      expect(body).not.toContain('capture_method');
    });
  });
});
