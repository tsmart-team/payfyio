import { createHash } from 'crypto';

const CURRENCY_CODES: Record<string, string> = {
  TRY: 'TL',
  USD: 'US',
  EUR: 'EU',
  GBP: 'GB',
};

export function getYapiKrediCurrency(code: string): string {
  return CURRENCY_CODES[(code || 'TRY').toUpperCase()] || 'TL';
}

export function formatYapiKrediAmount(price: string): string {
  const value = parseFloat(price);
  if (!isFinite(value) || value < 0) {
    throw new Error(`Invalid price for Yapı Kredi: ${price}`);
  }
  return Math.round(value * 100).toString();
}

/**
 * Posnet 3D hash — SHA256(merchantId + terminalId + amount + currency + orderId + xid + okUrl + failUrl + encKey)
 * (encoded as base64). Per YKB Posnet integration manual; final encoding may need
 * provider-specific tweaks during integration testing.
 */
export function buildPosnet3DHash(input: {
  merchantId: string;
  terminalId: string;
  amount: string;
  currency: string;
  orderId: string;
  xid: string;
  okUrl: string;
  failUrl: string;
  encKey: string;
}): string {
  const raw = `${input.merchantId};${input.terminalId};${input.amount};${input.currency};${input.orderId};${input.xid};${input.okUrl};${input.failUrl};${input.encKey}`;
  return createHash('sha256').update(raw, 'utf8').digest('base64');
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
  return `<?xml version="1.0" encoding="ISO-8859-9"?><posnetRequest>${toXml(payload)}</posnetRequest>`;
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

export function formatExpDateYYMM(month: string, year: string): string {
  const yy = String(year).slice(-2).padStart(2, '0');
  const mm = String(month).padStart(2, '0');
  return `${yy}${mm}`;
}
