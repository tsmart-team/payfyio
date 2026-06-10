import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
  verifyPolarWebhookSignature,
  mapPolarCheckoutStatus,
} from '../../../../src/providers/polar/utils';

/**
 * Polar follows Standard Webhooks (https://www.standardwebhooks.com):
 * the signed message is `${id}.${timestamp}.${rawBody}`, signed with
 * HMAC-SHA256 base64, header format `v1,<sig>` (space-separated for
 * multiple keys during rotation). The secret is `whsec_<base64-key>`.
 */
describe('Polar.sh utils', () => {
  // Base64 of "secret-key-value" — the bytes that get HMAC'd
  const SECRET_KEY_B64 = Buffer.from('secret-key-value', 'utf8').toString('base64');
  const WEBHOOK_SECRET = `whsec_${SECRET_KEY_B64}`;
  const ID = 'msg_12345';
  const TIMESTAMP = '1717248000';
  const body = JSON.stringify({
    type: 'order.created',
    data: { id: 'order_abc', status: 'paid' },
  });

  function sign(id: string, timestamp: string, rawBody: string, secret: string): string {
    const key = secret.startsWith('whsec_')
      ? Buffer.from(secret.slice('whsec_'.length), 'base64')
      : Buffer.from(secret, 'utf8');
    const message = `${id}.${timestamp}.${rawBody}`;
    return crypto.createHmac('sha256', key).update(message, 'utf8').digest('base64');
  }

  describe('verifyPolarWebhookSignature', () => {
    const validSig = sign(ID, TIMESTAMP, body, WEBHOOK_SECRET);

    it('accepts a correctly signed body', () => {
      expect(
        verifyPolarWebhookSignature(
          body,
          { id: ID, timestamp: TIMESTAMP, signature: `v1,${validSig}` },
          WEBHOOK_SECRET,
        ),
      ).toBe(true);
    });

    it('accepts when one of multiple `v1,...` tokens matches (key rotation)', () => {
      const wrong = sign(ID, TIMESTAMP, body, 'whsec_' + Buffer.from('other').toString('base64'));
      const header = `v1,${wrong} v1,${validSig}`;
      expect(
        verifyPolarWebhookSignature(
          body,
          { id: ID, timestamp: TIMESTAMP, signature: header },
          WEBHOOK_SECRET,
        ),
      ).toBe(true);
    });

    it('rejects a tampered body', () => {
      const tampered = body.replace('paid', 'refunded');
      expect(
        verifyPolarWebhookSignature(
          tampered,
          { id: ID, timestamp: TIMESTAMP, signature: `v1,${validSig}` },
          WEBHOOK_SECRET,
        ),
      ).toBe(false);
    });

    it('rejects a different webhook secret', () => {
      const otherSecret = `whsec_${Buffer.from('different').toString('base64')}`;
      const sigForOther = sign(ID, TIMESTAMP, body, otherSecret);
      expect(
        verifyPolarWebhookSignature(
          body,
          { id: ID, timestamp: TIMESTAMP, signature: `v1,${sigForOther}` },
          WEBHOOK_SECRET,
        ),
      ).toBe(false);
    });

    it('rejects a mismatched message id (replay against another event)', () => {
      // Signed for ID but header claims a different id → recomputed message
      // differs → digest mismatch.
      const sigForOriginal = sign(ID, TIMESTAMP, body, WEBHOOK_SECRET);
      expect(
        verifyPolarWebhookSignature(
          body,
          { id: 'msg_OTHER', timestamp: TIMESTAMP, signature: `v1,${sigForOriginal}` },
          WEBHOOK_SECRET,
        ),
      ).toBe(false);
    });

    it('rejects a mismatched timestamp', () => {
      const sigForOriginal = sign(ID, TIMESTAMP, body, WEBHOOK_SECRET);
      expect(
        verifyPolarWebhookSignature(
          body,
          { id: ID, timestamp: '9999999999', signature: `v1,${sigForOriginal}` },
          WEBHOOK_SECRET,
        ),
      ).toBe(false);
    });

    it('rejects unrecognised signature versions', () => {
      expect(
        verifyPolarWebhookSignature(
          body,
          { id: ID, timestamp: TIMESTAMP, signature: `v0,${validSig}` },
          WEBHOOK_SECRET,
        ),
      ).toBe(false);
    });

    it('rejects empty inputs', () => {
      expect(
        verifyPolarWebhookSignature('', { id: ID, timestamp: TIMESTAMP, signature: `v1,${validSig}` }, WEBHOOK_SECRET),
      ).toBe(false);
      expect(
        verifyPolarWebhookSignature(body, { id: '', timestamp: TIMESTAMP, signature: `v1,${validSig}` }, WEBHOOK_SECRET),
      ).toBe(false);
      expect(
        verifyPolarWebhookSignature(body, { id: ID, timestamp: '', signature: `v1,${validSig}` }, WEBHOOK_SECRET),
      ).toBe(false);
      expect(
        verifyPolarWebhookSignature(body, { id: ID, timestamp: TIMESTAMP, signature: '' }, WEBHOOK_SECRET),
      ).toBe(false);
      expect(
        verifyPolarWebhookSignature(body, { id: ID, timestamp: TIMESTAMP, signature: `v1,${validSig}` }, ''),
      ).toBe(false);
    });

    it('accepts a bare (non-whsec_-prefixed) secret', () => {
      // Some consumers paste the key without the prefix — utility should
      // treat it as utf8 bytes rather than base64.
      const bareSecret = 'plain-utf8-secret';
      const sig = crypto
        .createHmac('sha256', Buffer.from(bareSecret, 'utf8'))
        .update(`${ID}.${TIMESTAMP}.${body}`, 'utf8')
        .digest('base64');
      expect(
        verifyPolarWebhookSignature(
          body,
          { id: ID, timestamp: TIMESTAMP, signature: `v1,${sig}` },
          bareSecret,
        ),
      ).toBe(true);
    });
  });

  describe('mapPolarCheckoutStatus', () => {
    it('maps succeeded → success', () => {
      expect(mapPolarCheckoutStatus('succeeded')).toBe('success');
    });

    it('maps failed / expired → failed', () => {
      expect(mapPolarCheckoutStatus('failed')).toBe('failed');
      expect(mapPolarCheckoutStatus('expired')).toBe('failed');
    });

    it('treats open / confirmed as in-flight pending', () => {
      expect(mapPolarCheckoutStatus('open')).toBe('pending');
      expect(mapPolarCheckoutStatus('confirmed')).toBe('pending');
    });

    it('is case-insensitive', () => {
      expect(mapPolarCheckoutStatus('SUCCEEDED')).toBe('success');
      expect(mapPolarCheckoutStatus('Failed')).toBe('failed');
    });

    it("defaults unknown / missing to pending (don't silently mark paid)", () => {
      expect(mapPolarCheckoutStatus('something_new')).toBe('pending');
      expect(mapPolarCheckoutStatus(undefined)).toBe('pending');
      expect(mapPolarCheckoutStatus(null)).toBe('pending');
      expect(mapPolarCheckoutStatus('')).toBe('pending');
    });
  });
});
