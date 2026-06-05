import { describe, it, expect } from 'vitest';
import { PayPal } from '../../../../src/providers/paypal';
import {
  formatPayPalAmount,
  findApprovalUrl,
} from '../../../../src/providers/paypal/utils';

describe('PayPal provider', () => {
  describe('utils', () => {
    it('formats amount to two decimals', () => {
      expect(formatPayPalAmount('10')).toBe('10.00');
      expect(formatPayPalAmount('10.5')).toBe('10.50');
      expect(formatPayPalAmount('0')).toBe('0.00');
    });

    it('rejects invalid amount', () => {
      expect(() => formatPayPalAmount('-1')).toThrow();
      expect(() => formatPayPalAmount('abc')).toThrow();
    });

    it('extracts approval URL from links array', () => {
      expect(
        findApprovalUrl([
          { rel: 'self', href: 'https://x', method: 'GET' },
          { rel: 'approve', href: 'https://approve.paypal.com', method: 'GET' },
        ]),
      ).toBe('https://approve.paypal.com');
    });

    it('returns undefined when no approval link is present', () => {
      expect(findApprovalUrl([{ rel: 'self', href: 'https://x', method: 'GET' }])).toBeUndefined();
      expect(findApprovalUrl()).toBeUndefined();
    });
  });

  describe('constructor', () => {
    it('requires apiKey (clientId)', () => {
      expect(
        () =>
          new PayPal({
            apiKey: '',
            secretKey: 's',
            baseUrl: 'https://api-m.sandbox.paypal.com',
          } as any),
      ).toThrow(/client id/i);
    });

    it('requires secretKey', () => {
      expect(
        () =>
          new PayPal({
            apiKey: 'c',
            secretKey: '',
            baseUrl: 'https://api-m.sandbox.paypal.com',
          } as any),
      ).toThrow(/client secret/i);
    });

    it('createPayment returns explicit unsupported failure', async () => {
      const p = new PayPal({
        apiKey: 'c',
        secretKey: 's',
        baseUrl: 'https://api-m.sandbox.paypal.com',
      } as any);
      const res = await p.createPayment({} as any);
      expect(res.status).toBe('failure');
      expect(res.errorMessage).toMatch(/not supported/i);
    });
  });
});
