import crypto from 'crypto';
import type { PayfyioEvent } from '../types';
import {
  verifyCoinbaseWebhookSignature,
  mapCoinbaseStatus,
} from '../providers/coinbase/utils';
import {
  verifyPolarWebhookSignature,
  mapPolarCheckoutStatus,
} from '../providers/polar/utils';
import {
  verifyLemonSqueezyWebhookSignature,
  mapLemonSqueezyOrderStatus,
} from '../providers/lemonsqueezy/utils';

/**
 * Raised when a webhook's signature fails verification. Callers should treat
 * this as "reject the request" (HTTP 400) — a forged or tampered event must
 * never reach the ledger.
 */
export class WebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookSignatureError';
  }
}

export type WebhookHeaders = Record<string, string | string[] | undefined>;

/** Case-insensitive header lookup (Node lower-cases, but callers may not). */
function header(headers: WebhookHeaders, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === target) {
      return Array.isArray(v) ? v[0] : v;
    }
  }
  return undefined;
}

function toRawString(rawBody: string | Buffer): string {
  return Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
}

function parseJson(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Verifies and normalizes a provider webhook into a single `PayfyioEvent` union.
 *
 * - Throws `WebhookSignatureError` when the signature does not verify — never
 *   returns an event for a payload it could not authenticate.
 * - Returns `{ type: 'unknown', provider, raw }` when the signature is valid
 *   but the event type isn't one we model (so callers can log/ignore safely).
 *
 * `secret` is the provider's webhook signing secret. For providers whose
 * verification needs multiple headers (Polar/Stripe), they are read from
 * `headers`.
 */
export function verifyWebhook(
  provider: string,
  rawBody: string | Buffer,
  headers: WebhookHeaders,
  secret: string,
): PayfyioEvent {
  const raw = toRawString(rawBody);
  switch (provider) {
    case 'coinbase':
      return normalizeCoinbase(raw, headers, secret);
    case 'polar':
      return normalizePolar(raw, headers, secret);
    case 'lemonsqueezy':
      return normalizeLemonSqueezy(raw, headers, secret);
    case 'stripe':
      return normalizeStripe(raw, headers, secret);
    default:
      throw new Error(`Webhook verification not supported for provider '${provider}'`);
  }
}

function normalizeCoinbase(raw: string, headers: WebhookHeaders, secret: string): PayfyioEvent {
  const sig = header(headers, 'x-cc-webhook-signature') ?? '';
  if (!verifyCoinbaseWebhookSignature(raw, sig, secret)) {
    throw new WebhookSignatureError('Invalid Coinbase webhook signature');
  }
  const body = parseJson(raw);
  const event = body?.event ?? body;
  const charge = event?.data ?? {};
  const timeline = Array.isArray(charge?.timeline) ? charge.timeline : [];
  const lastStatus = timeline.length ? timeline[timeline.length - 1]?.status : charge?.status;
  const paymentId = charge?.id ?? charge?.code ?? '';
  const mapped = mapCoinbaseStatus(lastStatus);
  return statusToEvent('coinbase', paymentId, mapped, raw);
}

function normalizePolar(raw: string, headers: WebhookHeaders, secret: string): PayfyioEvent {
  const ok = verifyPolarWebhookSignature(
    raw,
    {
      id: header(headers, 'webhook-id') ?? '',
      timestamp: header(headers, 'webhook-timestamp') ?? '',
      signature: header(headers, 'webhook-signature') ?? '',
    },
    secret,
  );
  if (!ok) throw new WebhookSignatureError('Invalid Polar webhook signature');
  const body = parseJson(raw);
  const eventType: string = body?.type ?? '';
  const data = body?.data ?? {};
  const id = data?.id ?? '';

  if (eventType.startsWith('subscription.')) {
    if (eventType.includes('canceled') || eventType.includes('revoked')) {
      return { type: 'subscription.canceled', provider: 'polar', subscriptionId: id, raw };
    }
    return { type: 'subscription.renewed', provider: 'polar', subscriptionId: id, raw };
  }
  const mapped = mapPolarCheckoutStatus(data?.status);
  return statusToEvent('polar', id, mapped, raw);
}

function normalizeLemonSqueezy(raw: string, headers: WebhookHeaders, secret: string): PayfyioEvent {
  const sig = header(headers, 'x-signature') ?? '';
  if (!verifyLemonSqueezyWebhookSignature(raw, sig, secret)) {
    throw new WebhookSignatureError('Invalid Lemon Squeezy webhook signature');
  }
  const body = parseJson(raw);
  const eventName: string = body?.meta?.event_name ?? '';
  const attrs = body?.data?.attributes ?? {};
  const id = body?.data?.id ?? '';

  if (eventName.startsWith('subscription_')) {
    if (eventName.includes('cancelled') || eventName.includes('expired')) {
      return { type: 'subscription.canceled', provider: 'lemonsqueezy', subscriptionId: id, raw };
    }
    return { type: 'subscription.renewed', provider: 'lemonsqueezy', subscriptionId: id, raw };
  }
  const mapped = mapLemonSqueezyOrderStatus(attrs?.status);
  return statusToEvent('lemonsqueezy', id, mapped, raw);
}

/**
 * Stripe signs with a `Stripe-Signature` header of the form
 * `t=<ts>,v1=<hex(HMAC-SHA256(`${t}.${rawBody}`, secret))>` (the `whsec_...`
 * endpoint secret). We verify v1 against the timestamped payload.
 */
function normalizeStripe(raw: string, headers: WebhookHeaders, secret: string): PayfyioEvent {
  const sigHeader = header(headers, 'stripe-signature') ?? '';
  if (!verifyStripeSignature(raw, sigHeader, secret)) {
    throw new WebhookSignatureError('Invalid Stripe webhook signature');
  }
  const body = parseJson(raw);
  const eventType: string = body?.type ?? '';
  const obj = body?.data?.object ?? {};
  const currency: string | undefined = obj?.currency ? String(obj.currency).toUpperCase() : undefined;

  switch (eventType) {
    case 'payment_intent.succeeded':
    case 'charge.succeeded':
      return {
        type: 'payment.succeeded',
        provider: 'stripe',
        paymentId: obj?.id ?? '',
        amountMinor: typeof obj?.amount === 'number' ? obj.amount : undefined,
        currency,
        raw,
      };
    case 'payment_intent.payment_failed':
    case 'charge.failed':
      return {
        type: 'payment.failed',
        provider: 'stripe',
        paymentId: obj?.id ?? '',
        reason: obj?.last_payment_error?.message ?? obj?.failure_message,
        raw,
      };
    case 'charge.refunded':
    case 'refund.updated':
      return {
        type: 'refund.completed',
        provider: 'stripe',
        paymentId: obj?.payment_intent ?? undefined,
        refundId: obj?.id ?? undefined,
        amountMinor: typeof obj?.amount_refunded === 'number' ? obj.amount_refunded : (typeof obj?.amount === 'number' ? obj.amount : undefined),
        raw,
      };
    case 'invoice.paid':
      return { type: 'subscription.renewed', provider: 'stripe', subscriptionId: obj?.subscription ?? obj?.id ?? '', raw };
    case 'customer.subscription.deleted':
      return { type: 'subscription.canceled', provider: 'stripe', subscriptionId: obj?.id ?? '', raw };
    case 'payout.paid':
      return { type: 'payout.paid', provider: 'stripe', payoutId: obj?.id ?? '', amountMinor: typeof obj?.amount === 'number' ? obj.amount : undefined, raw };
    case 'payout.failed':
      return { type: 'payout.failed', provider: 'stripe', payoutId: obj?.id ?? '', raw };
    case 'charge.dispute.created':
      return { type: 'dispute.opened', provider: 'stripe', paymentId: obj?.payment_intent ?? undefined, disputeId: obj?.id ?? undefined, raw };
    default:
      return { type: 'unknown', provider: 'stripe', raw };
  }
}

function verifyStripeSignature(raw: string, sigHeader: string, secret: string): boolean {
  if (!raw || !sigHeader || !secret) return false;
  let t = '';
  const v1: string[] = [];
  for (const part of sigHeader.split(',')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (k === 't') t = val;
    else if (k === 'v1') v1.push(val);
  }
  if (!t || !v1.length) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${raw}`, 'utf8').digest('hex');
  const a = Buffer.from(expected, 'utf8');
  return v1.some((sig) => {
    const b = Buffer.from(sig, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

/**
 * Maps a normalized PaymentStatus-ish string to the corresponding payment event.
 * `amount`/`currency` are best-effort and may be absent for hosted providers.
 */
function statusToEvent(
  provider: string,
  paymentId: string,
  status: 'success' | 'failed' | 'pending' | 'cancelled',
  raw: string,
): PayfyioEvent {
  switch (status) {
    case 'success':
      return { type: 'payment.succeeded', provider, paymentId, raw };
    case 'failed':
      return { type: 'payment.failed', provider, paymentId, raw };
    case 'cancelled':
      return { type: 'payment.cancelled', provider, paymentId, raw };
    case 'pending':
    default:
      return { type: 'payment.pending', provider, paymentId, raw };
  }
}
