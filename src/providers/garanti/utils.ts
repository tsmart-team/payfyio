import { createHash } from 'crypto';

const CURRENCY_CODES: Record<string, string> = {
  TRY: '949',
  USD: '840',
  EUR: '978',
  GBP: '826',
};

export function getGarantiCurrency(code: string): string {
  return CURRENCY_CODES[(code || 'TRY').toUpperCase()] || '949';
}

export function formatGarantiAmount(price: string): string {
  const value = parseFloat(price);
  if (!isFinite(value) || value < 0) {
    throw new Error(`Invalid price for Garanti: ${price}`);
  }
  return Math.round(value * 100).toString();
}

function sha1Hex(input: string): string {
  return createHash('sha1').update(input, 'utf8').digest('hex').toUpperCase();
}

/**
 * GVP "SecurityData" — SHA1(Password + TerminalId padded to 9 with leading zeros)
 */
export function buildSecurityData(provisionPassword: string, terminalId: string): string {
  const padded = terminalId.padStart(9, '0');
  return sha1Hex(`${provisionPassword}${padded}`);
}

/**
 * GVP HashData — SHA1(OrderId + TerminalId + CardNumber + Amount + SecurityData)
 */
export function buildHashData(params: {
  orderId: string;
  terminalId: string;
  cardNumber: string;
  amount: string;
  securityData: string;
}): string {
  return sha1Hex(
    `${params.orderId}${params.terminalId}${params.cardNumber}${params.amount}${params.securityData}`,
  );
}

/**
 * GVP 3D Hash — SHA1(TerminalId + OrderId + Amount + SuccessUrl + FailUrl + TxnType + InstallmentCnt + StoreKey + SecurityData)
 */
export function build3DHashData(params: {
  terminalId: string;
  orderId: string;
  amount: string;
  successUrl: string;
  failUrl: string;
  txnType: string;
  installment: string;
  storeKey: string;
  securityData: string;
}): string {
  const raw = `${params.terminalId}${params.orderId}${params.amount}${params.successUrl}${params.failUrl}${params.txnType}${params.installment}${params.storeKey}${params.securityData}`;
  return sha1Hex(raw);
}

export function buildXmlRequest(payload: Record<string, any>): string {
  const toXml = (obj: Record<string, any>): string => {
    return Object.entries(obj)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => {
        if (typeof v === 'object' && !Array.isArray(v)) {
          return `<${k}>${toXml(v)}</${k}>`;
        }
        const safe = String(v)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        return `<${k}>${safe}</${k}>`;
      })
      .join('');
  };
  return `<?xml version="1.0" encoding="UTF-8"?><GVPSRequest>${toXml(payload)}</GVPSRequest>`;
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
