import { toMinor, fromMinor } from '../../core/money';

/**
 * Stripe expects amounts in the smallest currency unit (e.g. cents for USD,
 * kuruş for TRY, but the whole unit for zero-decimal currencies like JPY).
 * Delegates to the shared money helpers so the conversion is consistent across
 * the library and correct for zero/three-decimal currencies.
 *
 * `currency` defaults to TRY to preserve the original 2-decimal behavior for
 * existing callers that pass only a price.
 */
export function toStripeAmount(price: string, currency = 'TRY'): number {
  try {
    return toMinor(price, currency);
  } catch {
    throw new Error(`Invalid price for Stripe: ${price}`);
  }
}

export function fromStripeAmount(amount: number, currency = 'TRY'): number {
  return fromMinor(amount, currency);
}

export function toStripeCurrency(currency: string): string {
  return (currency || 'TRY').toLowerCase();
}

/**
 * Stripe API uses application/x-www-form-urlencoded with bracketed nested keys.
 * Example: { card: { number: "..." } } → "card[number]=..."
 */
export function encodeStripeForm(
  data: Record<string, unknown>,
  prefix?: string,
): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    const fullKey = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === 'object' && !Array.isArray(value)) {
      parts.push(encodeStripeForm(value as Record<string, unknown>, fullKey));
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => {
        if (typeof v === 'object' && v !== null) {
          parts.push(
            encodeStripeForm(v as Record<string, unknown>, `${fullKey}[${i}]`),
          );
        } else {
          parts.push(`${encodeURIComponent(`${fullKey}[${i}]`)}=${encodeURIComponent(String(v))}`);
        }
      });
    } else {
      parts.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.filter(Boolean).join('&');
}

/**
 * Wraps a redirect URL in a tiny HTML page so Payfyio's ThreeDSInitResponse
 * contract (HTML content the merchant injects) can be honored uniformly across
 * providers — Stripe natively returns a redirect URL, not an HTML form.
 */
export function buildRedirectHtml(url: string): string {
  const safe = url.replace(/"/g, '&quot;');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=${safe}"><title>Redirecting…</title></head><body><script>window.location.replace(${JSON.stringify(url)});</script><p>Redirecting to 3D Secure…</p></body></html>`;
}
