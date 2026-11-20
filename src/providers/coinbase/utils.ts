import crypto from 'crypto';

/**
 * Coinbase Commerce sends webhooks with an `X-CC-Webhook-Signature` header
 * containing hex(HMAC-SHA256(rawBody, webhookSecret)). The signature is
 * computed over the *exact raw body bytes* — pass the unparsed payload
 * string, not a re-serialized JSON object, or the digest won't match.
 */
export function verifyCoinbaseWebhookSignature(
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
 * Maps a Coinbase Commerce charge status (the last entry in `timeline[]`)
 * to payfyio's internal PaymentStatus.
 *   NEW           → pending (charge created, awaiting funds)
 *   PENDING       → pending (crypto received, awaiting confirmations)
 *   COMPLETED     → success
 *   RESOLVED      → success (resolved out-of-band, treat as paid)
 *   EXPIRED       → failed (no payment in time)
 *   CANCELED      → cancelled
 *   UNRESOLVED    → failed (under/over/late/multiple — needs manual handling)
 */
export function mapCoinbaseStatus(
  status: string | undefined | null,
): 'pending' | 'success' | 'failed' | 'cancelled' {
  switch ((status || '').toUpperCase()) {
    case 'COMPLETED':
    case 'RESOLVED':
      return 'success';
    case 'CANCELED':
      return 'cancelled';
    case 'EXPIRED':
    case 'UNRESOLVED':
      return 'failed';
    case 'NEW':
    case 'PENDING':
    default:
      return 'pending';
  }
}
