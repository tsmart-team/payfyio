import crypto from 'crypto';

/**
 * Polar.sh follows the Standard Webhooks spec (https://www.standardwebhooks.com).
 * Three headers travel with every webhook:
 *
 *   webhook-id          unique event id
 *   webhook-timestamp   Unix seconds at send time
 *   webhook-signature   space-separated list of "v1,<base64(HMAC-SHA256)>"
 *
 * The signed message is exactly  `${id}.${timestamp}.${rawBody}`  — using a
 * re-serialized JSON object instead of the raw request bytes WILL break
 * the check. The secret is the webhook endpoint secret from Polar's
 * dashboard (`whsec_…`); the `whsec_` prefix is stripped and the
 * remainder is treated as base64 for the HMAC key.
 *
 * Multiple `v1,<sig>` entries can appear in `webhook-signature` (one per
 * key during rotation). We accept the message if ANY of them matches.
 */
export function verifyPolarWebhookSignature(
  rawBody: string,
  headers: {
    id: string;
    timestamp: string;
    signature: string;
  },
  webhookSecret: string,
): boolean {
  if (!rawBody || !headers?.id || !headers?.timestamp || !headers?.signature || !webhookSecret) {
    return false;
  }

  // Standard Webhooks: secrets are `whsec_<base64-key>`. We accept both the
  // prefixed and bare forms — Polar emits the prefixed form, but consumers
  // sometimes paste the key without the prefix.
  const key = webhookSecret.startsWith('whsec_')
    ? Buffer.from(webhookSecret.slice('whsec_'.length), 'base64')
    : Buffer.from(webhookSecret, 'utf8');

  const message = `${headers.id}.${headers.timestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', key).update(message, 'utf8').digest('base64');

  // signature header may contain multiple "v1,<sig>" tokens separated by spaces
  const tokens = headers.signature.split(' ').filter(Boolean);
  for (const token of tokens) {
    const idx = token.indexOf(',');
    if (idx === -1) continue;
    const version = token.slice(0, idx);
    const sig = token.slice(idx + 1);
    if (version !== 'v1') continue;
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(sig, 'utf8');
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return true;
    }
  }
  return false;
}

/**
 * Maps a Polar checkout status to payfyio's internal status.
 *   open / created    → pending (awaiting customer)
 *   confirmed         → pending (payment intent in flight)
 *   succeeded         → success
 *   failed            → failed
 *   expired           → failed (timed out)
 */
export function mapPolarCheckoutStatus(
  status: string | undefined | null,
): 'pending' | 'success' | 'failed' {
  switch ((status || '').toLowerCase()) {
    case 'succeeded':
      return 'success';
    case 'failed':
    case 'expired':
      return 'failed';
    case 'open':
    case 'confirmed':
    default:
      return 'pending';
  }
}
