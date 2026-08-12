import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { verifyWebhook, WebhookSignatureError } from '../../../src/core/webhook';

// --- signature helpers (mirror the provider verifiers) ---

function coinbaseSig(raw: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(raw, 'utf8').digest('hex');
}

function lemonSig(raw: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(raw, 'utf8').digest('hex');
}

function polarHeaders(raw: string, secret: string) {
  const id = 'evt_1';
  const timestamp = '1700000000';
  const key = Buffer.from(secret, 'utf8');
  const sig = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${raw}`, 'utf8').digest('base64');
  return {
    'webhook-id': id,
    'webhook-timestamp': timestamp,
    'webhook-signature': `v1,${sig}`,
  };
}

function stripeSig(raw: string, secret: string): string {
  const t = '1700000000';
  const v1 = crypto.createHmac('sha256', secret).update(`${t}.${raw}`, 'utf8').digest('hex');
  return `t=${t},v1=${v1}`;
}

function iyzicoSig(eventType: string, referenceCode: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(`${eventType}${referenceCode}`, 'utf8').digest('base64');
}

describe('verifyWebhook', () => {
  describe('Stripe', () => {
    const secret = 'whsec_test';

    it('normalizes payment_intent.succeeded', () => {
      const raw = JSON.stringify({
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_1', amount: 10000, currency: 'try' } },
      });
      const event = verifyWebhook('stripe', raw, { 'stripe-signature': stripeSig(raw, secret) }, secret);
      expect(event.type).toBe('payment.succeeded');
      if (event.type === 'payment.succeeded') {
        expect(event.paymentId).toBe('pi_1');
        expect(event.amountMinor).toBe(10000);
        expect(event.currency).toBe('TRY');
      }
    });

    it('normalizes charge.dispute.created', () => {
      const raw = JSON.stringify({
        type: 'charge.dispute.created',
        data: { object: { id: 'dp_1', payment_intent: 'pi_9' } },
      });
      const event = verifyWebhook('stripe', raw, { 'stripe-signature': stripeSig(raw, secret) }, secret);
      expect(event.type).toBe('dispute.opened');
      if (event.type === 'dispute.opened') {
        expect(event.disputeId).toBe('dp_1');
        expect(event.paymentId).toBe('pi_9');
      }
    });

    it('returns unknown for an unmodeled event type', () => {
      const raw = JSON.stringify({ type: 'customer.created', data: { object: { id: 'cus_1' } } });
      const event = verifyWebhook('stripe', raw, { 'stripe-signature': stripeSig(raw, secret) }, secret);
      expect(event.type).toBe('unknown');
      expect(event.provider).toBe('stripe');
    });

    it('throws on an invalid signature', () => {
      const raw = JSON.stringify({ type: 'payment_intent.succeeded', data: { object: { id: 'pi_1' } } });
      expect(() => verifyWebhook('stripe', raw, { 'stripe-signature': 't=1,v1=deadbeef' }, secret)).toThrow(
        WebhookSignatureError,
      );
    });

    it('is case-insensitive on header names', () => {
      const raw = JSON.stringify({ type: 'payout.paid', data: { object: { id: 'po_1', amount: 500 } } });
      const event = verifyWebhook('stripe', raw, { 'Stripe-Signature': stripeSig(raw, secret) }, secret);
      expect(event.type).toBe('payout.paid');
    });
  });

  describe('Coinbase', () => {
    const secret = 'cb_secret';

    it('normalizes a completed charge to payment.succeeded', () => {
      const raw = JSON.stringify({
        event: { data: { id: 'ch_1', timeline: [{ status: 'NEW' }, { status: 'COMPLETED' }] } },
      });
      const event = verifyWebhook('coinbase', raw, { 'x-cc-webhook-signature': coinbaseSig(raw, secret) }, secret);
      expect(event.type).toBe('payment.succeeded');
      if (event.type === 'payment.succeeded') expect(event.paymentId).toBe('ch_1');
    });

    it('throws on a bad signature', () => {
      const raw = JSON.stringify({ event: { data: { id: 'ch_1' } } });
      expect(() => verifyWebhook('coinbase', raw, { 'x-cc-webhook-signature': 'bad' }, secret)).toThrow(
        WebhookSignatureError,
      );
    });
  });

  describe('Polar', () => {
    const secret = 'polarsecret';

    it('normalizes a subscription cancellation', () => {
      const raw = JSON.stringify({ type: 'subscription.canceled', data: { id: 'sub_1' } });
      const event = verifyWebhook('polar', raw, polarHeaders(raw, secret), secret);
      expect(event.type).toBe('subscription.canceled');
      if (event.type === 'subscription.canceled') expect(event.subscriptionId).toBe('sub_1');
    });

    it('normalizes a succeeded checkout to payment.succeeded', () => {
      const raw = JSON.stringify({ type: 'checkout.updated', data: { id: 'co_1', status: 'succeeded' } });
      const event = verifyWebhook('polar', raw, polarHeaders(raw, secret), secret);
      expect(event.type).toBe('payment.succeeded');
    });

    it('throws on a bad signature', () => {
      const raw = JSON.stringify({ type: 'checkout.updated', data: { id: 'co_1' } });
      expect(() =>
        verifyWebhook('polar', raw, { 'webhook-id': 'x', 'webhook-timestamp': '1', 'webhook-signature': 'v1,bad' }, secret),
      ).toThrow(WebhookSignatureError);
    });
  });

  describe('Lemon Squeezy', () => {
    const secret = 'ls_secret';

    it('normalizes a paid order to payment.succeeded', () => {
      const raw = JSON.stringify({
        meta: { event_name: 'order_created' },
        data: { id: 'ord_1', attributes: { status: 'paid' } },
      });
      const event = verifyWebhook('lemonsqueezy', raw, { 'x-signature': lemonSig(raw, secret) }, secret);
      expect(event.type).toBe('payment.succeeded');
      if (event.type === 'payment.succeeded') expect(event.paymentId).toBe('ord_1');
    });

    it('normalizes a refunded order to refund (cancelled)', () => {
      const raw = JSON.stringify({
        meta: { event_name: 'order_refunded' },
        data: { id: 'ord_2', attributes: { status: 'refunded' } },
      });
      const event = verifyWebhook('lemonsqueezy', raw, { 'x-signature': lemonSig(raw, secret) }, secret);
      expect(event.type).toBe('payment.cancelled');
    });

    it('throws on a bad signature', () => {
      const raw = JSON.stringify({ meta: { event_name: 'order_created' }, data: { id: 'ord_1' } });
      expect(() => verifyWebhook('lemonsqueezy', raw, { 'x-signature': 'bad' }, secret)).toThrow(
        WebhookSignatureError,
      );
    });
  });

  describe('iyzico', () => {
    const secret = 'iyz_secret';

    it('normalizes a CHARGE_SUCCESS to payment.succeeded', () => {
      const eventType = 'CHARGE_SUCCESS';
      const ref = 'ref_1';
      const raw = JSON.stringify({
        iyziEventType: eventType,
        iyziReferenceCode: ref,
        paymentId: 'pay_1',
        status: 'SUCCESS',
        signature: iyzicoSig(eventType, ref, secret),
      });
      const event = verifyWebhook('iyzico', raw, {}, secret);
      expect(event.type).toBe('payment.succeeded');
      if (event.type === 'payment.succeeded') expect(event.paymentId).toBe('pay_1');
    });

    it('normalizes a REFUND event to refund.completed', () => {
      const eventType = 'REFUND_SUCCESS';
      const ref = 'ref_2';
      const raw = JSON.stringify({
        iyziEventType: eventType,
        iyziReferenceCode: ref,
        paymentId: 'pay_2',
        signature: iyzicoSig(eventType, ref, secret),
      });
      const event = verifyWebhook('iyzico', raw, {}, secret);
      expect(event.type).toBe('refund.completed');
    });

    it('normalizes a BALANCE/SETTLEMENT event to payout.paid', () => {
      const eventType = 'SETTLEMENT_SUCCESS';
      const ref = 'ref_3';
      const raw = JSON.stringify({
        iyziEventType: eventType,
        iyziReferenceCode: ref,
        signature: iyzicoSig(eventType, ref, secret),
      });
      const event = verifyWebhook('iyzico', raw, {}, secret);
      expect(event.type).toBe('payout.paid');
    });

    it('throws on an invalid signature', () => {
      const raw = JSON.stringify({
        iyziEventType: 'CHARGE_SUCCESS',
        iyziReferenceCode: 'ref_x',
        signature: 'wrong',
      });
      expect(() => verifyWebhook('iyzico', raw, {}, secret)).toThrow(WebhookSignatureError);
    });

    it('carries provider + raw on every event', () => {
      const eventType = 'CHARGE_FAILURE';
      const ref = 'ref_4';
      const raw = JSON.stringify({
        iyziEventType: eventType,
        iyziReferenceCode: ref,
        paymentId: 'pay_4',
        status: 'FAILURE',
        signature: iyzicoSig(eventType, ref, secret),
      });
      const event = verifyWebhook('iyzico', raw, {}, secret);
      expect(event.type).toBe('payment.failed');
      expect(event.provider).toBe('iyzico');
      expect(event.raw).toBeDefined();
    });
  });

  it('throws for an unsupported provider', () => {
    expect(() => verifyWebhook('paytr', '{}', {}, 'secret')).toThrow(/not supported/i);
  });

  it('every provider emits provider + raw (PayfyioEvent shape consistency)', () => {
    const cbSecret = 'cb';
    const cbRaw = JSON.stringify({ event: { data: { id: 'ch', timeline: [{ status: 'COMPLETED' }] } } });
    const cb = verifyWebhook('coinbase', cbRaw, { 'x-cc-webhook-signature': coinbaseSig(cbRaw, cbSecret) }, cbSecret);
    expect(cb.provider).toBe('coinbase');
    expect(cb.raw).toBeDefined();

    const stRaw = JSON.stringify({ type: 'payment_intent.succeeded', data: { object: { id: 'pi', amount: 1 } } });
    const st = verifyWebhook('stripe', stRaw, { 'stripe-signature': stripeSig(stRaw, 'whsec') }, 'whsec');
    expect(st.provider).toBe('stripe');
    expect(st.raw).toBeDefined();
  });

  it('accepts a Buffer raw body', () => {
    const secret = 'whsec_test';
    const raw = JSON.stringify({ type: 'payment_intent.succeeded', data: { object: { id: 'pi_b', amount: 1 } } });
    const event = verifyWebhook('stripe', Buffer.from(raw, 'utf8'), { 'stripe-signature': stripeSig(raw, secret) }, secret);
    expect(event.type).toBe('payment.succeeded');
  });
});
