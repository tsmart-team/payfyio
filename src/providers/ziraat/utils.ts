import { createHmac, randomBytes } from 'crypto';

const CURRENCY_CODES: Record<string, string> = {
  TRY: '949',
  USD: '840',
  EUR: '978',
  GBP: '826',
};

export function getZiraatCurrency(code: string): string {
  return CURRENCY_CODES[(code || 'TRY').toUpperCase()] || '949';
}

export function formatZiraatAmount(price: string): string {
  const value = parseFloat(price);
  if (!isFinite(value) || value < 0) {
    throw new Error(`Invalid price for Ziraat: ${price}`);
  }
  return value.toFixed(2);
}

/** NestPay v3 hash — HMAC-SHA512(pipe-joined values, storeKey) → base64 */
export function buildNestPayV3Hash(values: string[], storeKey: string): string {
  return createHmac('sha512', storeKey).update(values.join('|'), 'utf8').digest('base64');
}

export function randomNonce(): string {
  return randomBytes(16).toString('hex');
}

export function buildXmlEnvelope(payload: Record<string, any>): string {
  const toXml = (obj: Record<string, any>): string => {
    return Object.entries(obj)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => {
        if (typeof v === 'object' && !Array.isArray(v)) {
          return `<${k}>${toXml(v)}</${k}>`;
        }
        const safe = String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<${k}>${safe}</${k}>`;
      })
      .join('');
  };
  return `<?xml version="1.0" encoding="ISO-8859-9"?><CC5Request>${toXml(payload)}</CC5Request>`;
}

export function parseXmlScalar(xml: string, tag: string): string | undefined {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? m[1].trim() : undefined;
}

export function buildRedirectFormHtml(actionUrl: string, fields: Record<string, string>): string {
  const inputs = Object.entries(fields)
    .map(
      ([k, v]) =>
        `<input type="hidden" name="${k.replace(/"/g, '&quot;')}" value="${String(v).replace(/"/g, '&quot;')}">`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Redirecting…</title></head><body onload="document.forms[0].submit()"><form method="POST" action="${actionUrl}">${inputs}<noscript><button type="submit">Continue to 3D Secure</button></noscript></form></body></html>`;
}
