import crypto from 'crypto';

/**
 * Lemon Squeezy signs webhooks with an `X-Signature` header containing
 * hex(HMAC-SHA256(rawBody, webhookSecret)). The signature is computed over
 * the *exact raw body bytes* — pass the unparsed payload string, not a
 * re-serialized JSON object, or the digest won't match.
 *
 * Reference:
 *   https://docs.lemonsqueezy.com/help/webhooks#signing-requests
 */
export function verifyLemonSqueezyWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  webhookSecret: string,
): boolean {
  if (!rawBody || !signatureHeader || !webhookSecret) return false;
  const expected = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody, 'utf8')
    .digest('hex');
  // Length-checked timingSafeEqual: a length mismatch would otherwise throw
  // and leak timing info via the early exception path.
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signatureHeader, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Maps a Lemon Squeezy order status to payfyio's internal status.
 *   pending    → pending  (checkout submitted, awaiting payment processor)
 *   paid       → success
 *   refunded   → cancelled (treat full refund as cancellation of the order)
 *   failed     → failed
 */
export function mapLemonSqueezyOrderStatus(
  status: string | undefined | null,
): 'pending' | 'success' | 'failed' | 'cancelled' {
  switch ((status || '').toLowerCase()) {
    case 'paid':
      return 'success';
    case 'refunded':
      return 'cancelled';
    case 'failed':
      return 'failed';
    case 'pending':
    default:
      return 'pending';
  }
}
