import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { toMinor } from '../../core/money';
import { PaymentStatus } from '../../types';

/** Posnet currency codes. Unknown currencies throw — never fall back to TL. */
const CURRENCY_CODES: Record<string, string> = {
  TRY: 'TL',
  TL: 'TL',
  USD: 'US',
  EUR: 'EU',
  GBP: 'GB',
};

export function getYapiKrediCurrency(code: string | undefined): string {
  const mapped = CURRENCY_CODES[(code || 'TRY').toUpperCase()];
  if (!mapped) throw new Error(`Currency ${code} is not supported by Posnet`);
  return mapped;
}

/** Decimal string ('1.20') → integer minor units as a string ('120'). */
export function formatYapiKrediAmount(price: string, currency = 'TRY'): string {
  return String(toMinor(price, currency));
}

export function formatExpDateYYMM(month: string, year: string): string {
  const mm = String(month).padStart(2, '0');
  const yy = String(year).slice(-2).padStart(2, '0');
  if (!/^\d{2}$/.test(mm) || +mm < 1 || +mm > 12 || !/^\d{2}$/.test(yy)) {
    throw new Error(`Invalid card expiry: ${month}/${year}`);
  }
  return `${yy}${mm}`;
}

/** Posnet installment: '00' for a single payment, otherwise two digits. */
export function formatYapiKrediInstallment(installment?: number): string {
  const n = installment ?? 1;
  if (!Number.isInteger(n) || n < 1 || n > 99) throw new Error(`Invalid installment: ${installment}`);
  return n > 1 ? String(n).padStart(2, '0') : '00';
}

const ORDER_NO = /^[A-Za-z0-9_]{1,20}$/;

/**
 * The 20-character order number Posnet knows the order by (the 3D `XID`).
 * A `conversationId` that fits Posnet's alphabet is used as-is (left-padded
 * with zeros); anything else gets a fresh random one, so arbitrary merchant
 * order ids never make the bank reject the request.
 */
export function toPosnetOrderNo(conversationId?: string): string {
  const base =
    conversationId && ORDER_NO.test(conversationId)
      ? conversationId
      : randomBytes(10).toString('hex').toUpperCase();
  return base.padStart(20, '0');
}

/** Validates an order number coming back from the merchant's records. */
export function assertPosnetOrderNo(orderNo: string): string {
  if (!ORDER_NO.test(orderNo)) throw new Error(`Invalid Posnet order number: ${orderNo}`);
  return orderNo.padStart(20, '0');
}

function sha256b64(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('base64');
}

/**
 * Posnet request MAC (oosResolveMerchantData / oosTranData):
 * `b64(SHA256(xid;amount;currency;merchantId;b64(SHA256(encKey;terminalId))))`.
 */
export function buildPosnetMac(p: {
  xid: string;
  amount: string;
  currency: string;
  merchantId: string;
  terminalId: string;
  encKey: string;
}): string {
  const inner = sha256b64(`${p.encKey};${p.terminalId}`);
  return sha256b64([p.xid, p.amount, p.currency, p.merchantId, inner].join(';'));
}

/**
 * The MAC the bank puts on its answers: same as the request MAC with one
 * leading field — `mdStatus` on the resolve answer, `hostlogkey` on the charge.
 */
export function buildPosnetResponseMac(
  first: string,
  p: Parameters<typeof buildPosnetMac>[0],
): string {
  const inner = sha256b64(`${p.encKey};${p.terminalId}`);
  return sha256b64([first, p.xid, p.amount, p.currency, p.merchantId, inner].join(';'));
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

function escapeXml(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // the envelope declares ISO-8859-9; numeric entities keep non-ASCII intact
    .replace(/[^\x20-\x7e]/g, (c) => `&#${c.codePointAt(0)};`);
}

export function buildXmlEnvelope(payload: Record<string, any>): string {
  const toXml = (obj: Record<string, any>): string =>
    Object.entries(obj)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) =>
        typeof v === 'object' ? `<${k}>${toXml(v)}</${k}>` : `<${k}>${escapeXml(String(v))}</${k}>`,
      )
      .join('');
  return `<?xml version="1.0" encoding="ISO-8859-9"?><posnetRequest>${toXml(payload)}</posnetRequest>`;
}

function unescapeXml(v: string): string {
  return v
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Leaf `<tag>value</tag>` pairs of an XML fragment; first occurrence wins. */
function leaves(xml: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of xml.matchAll(/<([A-Za-z_][\w.-]*)>([^<]*)<\/\1>/g)) {
    if (!(m[1] in out)) out[m[1]] = unescapeXml(m[2]).trim();
  }
  return out;
}

function section(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return m ? m[1] : '';
}

export interface PosnetResponse {
  /** Top-level fields: approved, respCode, respText, hostlogkey, authCode, mac … */
  fields: Record<string, string>;
  /** `oosRequestDataResponse` / `oosResolveMerchantDataResponse` content */
  oos: Record<string, string>;
  /** `agreement` answer: transactions/transaction */
  transactions: Record<string, string>[];
}

/** Parses a `posnetResponse`; throws when the body is not one. */
export function parsePosnetResponse(body: unknown): PosnetResponse {
  // The order inquiry declares utf-16; read as text its ASCII arrives with NULs.
  const xml = String(body ?? '').split(String.fromCharCode(0)).join('');
  if (!xml.includes('<posnetResponse')) throw new Error('Unexpected Posnet response');
  const oos =
    section(xml, 'oosRequestDataResponse') || section(xml, 'oosResolveMerchantDataResponse');
  const txList = section(xml, 'transactions');
  const top = xml
    .replace(/<(oosRequestDataResponse|oosResolveMerchantDataResponse|transactions)>[\s\S]*?<\/\1>/g, '');
  return {
    fields: leaves(top),
    oos: leaves(oos),
    transactions: [...txList.matchAll(/<transaction>([\s\S]*?)<\/transaction>/g)].map((m) =>
      leaves(m[1]),
    ),
  };
}

/**
 * Status of a Posnet order from its transaction list (YKB `agreement`, also
 * used for Albaraka's inquiry). Keys are expected lower-cased. A successful
 * reverse/return wins over the sale; a list without the expected fields is
 * PENDING (the answer is in rawResponse, check it by hand).
 */
export function posnetOrderStatus(transactions: Record<string, string>[]): PaymentStatus {
  const known = transactions.filter((t) => t.txnstatus !== undefined && t.state !== undefined);
  if (known.length === 0) return PaymentStatus.PENDING;
  const ok = known.filter((t) => t.txnstatus === '1').map((t) => t.state.toLowerCase());
  if (ok.some((s) => s === 'return' || s === 'vft_return' || s.endsWith('_reverse'))) {
    return PaymentStatus.CANCELLED;
  }
  return ok.some((s) => ['sale', 'vft_sale', 'capture', 'authorization'].includes(s))
    ? PaymentStatus.SUCCESS
    : PaymentStatus.FAILURE;
}

export function lowerKeys(obj: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) out[k.toLowerCase()] = v == null ? '' : String(v);
  return out;
}

function escapeHtml(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Self-submitting POST form; every name/value/action is HTML-escaped. */
export function buildAutoSubmitForm(actionUrl: string, fields: Record<string, string>): string {
  const inputs = Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(String(v))}">`)
    .join('');
  return (
    '<!doctype html><html><head><meta charset="utf-8"><title>Redirecting…</title></head>' +
    `<body onload="document.forms[0].submit()"><form method="POST" action="${escapeHtml(actionUrl)}">` +
    `${inputs}<noscript><button type="submit">Continue to 3D Secure</button></noscript></form></body></html>`
  );
}
