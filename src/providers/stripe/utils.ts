/**
 * Stripe expects amounts in the smallest currency unit (e.g. cents for USD,
 * kuruş for TRY). Both decimal-2 currencies in our supported set use the same
 * convention; zero-decimal currencies are not supported in this provider.
 */
export function toStripeAmount(price: string): number {
  const value = parseFloat(price);
  if (!isFinite(value) || value < 0) {
    throw new Error(`Invalid price for Stripe: ${price}`);
  }
  return Math.round(value * 100);
}

export function fromStripeAmount(amount: number): number {
  return amount / 100;
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
