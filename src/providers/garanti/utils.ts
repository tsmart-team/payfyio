import { createHash, timingSafeEqual } from 'crypto';

const CURRENCY_CODES: Record<string, string> = {
  TRY: '949',
  USD: '840',
  EUR: '978',
  GBP: '826',
  JPY: '392',
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

// ponytail: the bank hashes over ISO-8859-9 bytes, Node only speaks utf8/latin1.
// Every hashed field is ASCII (ids, kuruş amounts, numeric currency codes, hex
// digests, ascii URLs) where the two encodings are byte-identical. If a merchant
// ever needs a non-ASCII value inside a hash, add iconv-lite here.
function hashHex(algorithm: 'sha1' | 'sha512', input: string): string {
  return createHash(algorithm).update(input, 'utf8').digest('hex').toUpperCase();
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * GVP HashedPassword (docs call it SecurityData) —
 * `SHA1(ProvisionPassword + TerminalID left-padded to 9 with '0')`, uppercase hex.
 */
export function buildSecurityData(provisionPassword: string, terminalId: string): string {
  return hashHex('sha1', `${provisionPassword}${terminalId.padStart(9, '0')}`);
}

/**
 * GVP v512 HashData for /VPServlet —
 * `SHA512(OrderID + TerminalID + CardNumber + Amount + CurrencyCode + HashedPassword)`.
 * CardNumber is empty for card-less operations (refund/void/inquiry).
 */
export function buildHashData(params: {
  orderId: string;
  terminalId: string;
  cardNumber: string;
  amount: string;
  currencyCode: string;
  securityData: string;
}): string {
  return hashHex(
    'sha512',
    `${params.orderId}${params.terminalId}${params.cardNumber}${params.amount}` +
      `${params.currencyCode}${params.securityData}`,
  );
}

/**
 * GVP v512 3D request hash (`secure3dhash`) —
 * `SHA512(TerminalID + OrderID + Amount + CurrencyCode + SuccessURL + ErrorURL +
 *  TxnType + InstallmentCnt + StoreKey + HashedPassword)`.
 *
 * This is what binds amount/currency/return-URLs to the transaction: the bank
 * provisions the amount *it* signed here, so a tampered callback cannot change
 * what was actually charged.
 */
export function build3DHashData(params: {
  terminalId: string;
  orderId: string;
  amount: string;
  currencyCode: string;
  successUrl: string;
  failUrl: string;
  txnType: string;
  installment: string;
  storeKey: string;
  securityData: string;
}): string {
  return hashHex(
    'sha512',
    `${params.terminalId}${params.orderId}${params.amount}${params.currencyCode}` +
      `${params.successUrl}${params.failUrl}${params.txnType}${params.installment}` +
      `${params.storeKey}${params.securityData}`,
  );
}

/** Form field names come back lower-cased, but don't bet on it. */
function pick(data: Record<string, any>, name: string): string {
  if (!name) return '';
  const hit = Object.keys(data).find((k) => k.toLowerCase() === name.toLowerCase());
  const v = hit === undefined ? undefined : data[hit];
  return v === undefined || v === null ? '' : String(v);
}

/**
 * Verify the hash Garanti posts back to successurl/errorurl.
 *
 * The bank sends `hashparams` (colon-separated field names), `hashparamsval`
 * (its own concatenation of those values) and `hash` =
 * `SHA512(concat(values) + StoreKey)` uppercase hex.
 *
 * We additionally require the signed field list to cover `mdstatus` and
 * `procreturncode` — the two fields the payment decision is made on. Without
 * that, a forged callback could sign a harmless subset and leave the fields we
 * trust unprotected.
 */
export function verifyGaranti3DHash(
  callbackData: Record<string, any>,
  storeKey: string,
): boolean {
  if (!storeKey) return false;
  const received = pick(callbackData, 'hash');
  const hashParams = pick(callbackData, 'hashparams');
  if (!received || !hashParams) return false;

  const names = hashParams.split(':').map((n) => n.trim().toLowerCase()).filter(Boolean);
  if (!names.includes('mdstatus') || !names.includes('procreturncode')) return false;

  const digestData = names.map((n) => pick(callbackData, n)).join('');

  // The bank echoes its own concatenation; if present it must agree with ours.
  const claimedVals = pick(callbackData, 'hashparamsval');
  if (claimedVals && claimedVals !== digestData) return false;

  return safeEqual(hashHex('sha512', `${digestData}${storeKey}`), received.toUpperCase());
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
