import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
  verifyLemonSqueezyWebhookSignature,
  mapLemonSqueezyOrderStatus,
} from '../../../../src/providers/lemonsqueezy/utils';

describe('Lemon Squeezy utils', () => {
  const SECRET = 'ls_test_webhook_secret';
  const body = JSON.stringify({
    meta: { event_name: 'order_created' },
    data: { type: 'orders', id: '42', attributes: { status: 'paid' } },
  });

  describe('verifyLemonSqueezyWebhookSignature', () => {
    const validSignature = crypto
      .createHmac('sha256', SECRET)
      .update(body, 'utf8')
      .digest('hex');

    it('accepts a correctly signed body', () => {
      expect(verifyLemonSqueezyWebhookSignature(body, validSignature, SECRET)).toBe(true);
    });

    it('rejects a tampered body', () => {
      const tampered = body.replace('paid', 'failed');
      expect(verifyLemonSqueezyWebhookSignature(tampered, validSignature, SECRET)).toBe(false);
    });

    it('rejects a different signature of the same length', () => {
      const other = crypto.createHmac('sha256', 'different-secret').update(body).digest('hex');
      expect(verifyLemonSqueezyWebhookSignature(body, other, SECRET)).toBe(false);
    });

    it('rejects a signature of the wrong length (no exception)', () => {
      expect(verifyLemonSqueezyWebhookSignature(body, 'short', SECRET)).toBe(false);
    });

    it('rejects empty signature, secret, or body', () => {
      expect(verifyLemonSqueezyWebhookSignature(body, '', SECRET)).toBe(false);
      expect(verifyLemonSqueezyWebhookSignature(body, validSignature, '')).toBe(false);
      expect(verifyLemonSqueezyWebhookSignature('', validSignature, SECRET)).toBe(false);
    });
  });

  describe('mapLemonSqueezyOrderStatus', () => {
    it('maps paid → success', () => {
      expect(mapLemonSqueezyOrderStatus('paid')).toBe('success');
    });

    it('maps refunded → cancelled (full refund = order undone)', () => {
      expect(mapLemonSqueezyOrderStatus('refunded')).toBe('cancelled');
    });

    it('maps failed → failed', () => {
      expect(mapLemonSqueezyOrderStatus('failed')).toBe('failed');
    });

    it('treats pending as in-flight', () => {
      expect(mapLemonSqueezyOrderStatus('pending')).toBe('pending');
    });

    it('is case-insensitive', () => {
      expect(mapLemonSqueezyOrderStatus('Paid')).toBe('success');
      expect(mapLemonSqueezyOrderStatus('REFUNDED')).toBe('cancelled');
    });

    it("defaults unknown / missing to pending (don't silently mark paid)", () => {
      expect(mapLemonSqueezyOrderStatus('something_new')).toBe('pending');
      expect(mapLemonSqueezyOrderStatus(undefined)).toBe('pending');
      expect(mapLemonSqueezyOrderStatus(null)).toBe('pending');
      expect(mapLemonSqueezyOrderStatus('')).toBe('pending');
    });
  });
});
