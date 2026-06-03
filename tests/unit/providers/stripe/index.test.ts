import { describe, it, expect } from 'vitest';
import { Stripe } from '../../../../src/providers/stripe';
import {
  toStripeAmount,
  encodeStripeForm,
  buildRedirectHtml,
  toStripeCurrency,
} from '../../../../src/providers/stripe/utils';

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
});
