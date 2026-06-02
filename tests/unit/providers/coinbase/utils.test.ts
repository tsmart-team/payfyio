import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
  verifyCoinbaseWebhookSignature,
  mapCoinbaseStatus,
} from '../../../../src/providers/coinbase/utils';

describe('Coinbase Commerce utils', () => {
  const SECRET = 'whsec_test_value_must_match';
  const body = JSON.stringify({
    event: { id: 'evt_1', type: 'charge:confirmed', data: { code: 'ABC123' } },
  });

  describe('verifyCoinbaseWebhookSignature', () => {
    const validSignature = crypto
      .createHmac('sha256', SECRET)
      .update(body, 'utf8')
      .digest('hex');

    it('accepts a correctly signed body', () => {
      expect(verifyCoinbaseWebhookSignature(body, validSignature, SECRET)).toBe(true);
    });

    it('rejects a tampered body', () => {
      const tampered = body.replace('ABC123', 'XYZ999');
      expect(verifyCoinbaseWebhookSignature(tampered, validSignature, SECRET)).toBe(false);
    });

    it('rejects a different signature of the same length', () => {
      const other = crypto.createHmac('sha256', 'different-secret').update(body).digest('hex');
      expect(verifyCoinbaseWebhookSignature(body, other, SECRET)).toBe(false);
    });

    it('rejects a signature of the wrong length (no exception)', () => {
      expect(verifyCoinbaseWebhookSignature(body, 'short', SECRET)).toBe(false);
    });

    it('rejects an empty signature header', () => {
      expect(verifyCoinbaseWebhookSignature(body, '', SECRET)).toBe(false);
    });

    it('rejects an empty webhook secret (config error)', () => {
      expect(verifyCoinbaseWebhookSignature(body, validSignature, '')).toBe(false);
    });

    it('rejects an empty body', () => {
      expect(verifyCoinbaseWebhookSignature('', validSignature, SECRET)).toBe(false);
    });
  });

  describe('mapCoinbaseStatus', () => {
    it('maps successful terminal states to success', () => {
      expect(mapCoinbaseStatus('COMPLETED')).toBe('success');
      expect(mapCoinbaseStatus('RESOLVED')).toBe('success');
    });

    it('maps cancellation', () => {
      expect(mapCoinbaseStatus('CANCELED')).toBe('cancelled');
    });

    it('maps failure terminal states', () => {
      expect(mapCoinbaseStatus('EXPIRED')).toBe('failed');
      expect(mapCoinbaseStatus('UNRESOLVED')).toBe('failed');
    });

    it('treats NEW and PENDING as in-flight', () => {
      expect(mapCoinbaseStatus('NEW')).toBe('pending');
      expect(mapCoinbaseStatus('PENDING')).toBe('pending');
    });

    it('is case-insensitive', () => {
      expect(mapCoinbaseStatus('completed')).toBe('success');
      expect(mapCoinbaseStatus('canceled')).toBe('cancelled');
    });

    it('defaults unknown / missing to pending (don\'t silently mark paid)', () => {
      expect(mapCoinbaseStatus('SOMETHING_NEW')).toBe('pending');
      expect(mapCoinbaseStatus(undefined)).toBe('pending');
      expect(mapCoinbaseStatus(null)).toBe('pending');
      expect(mapCoinbaseStatus('')).toBe('pending');
    });
  });
});
