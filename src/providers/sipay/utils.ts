import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'crypto';
import { toMinor } from '../../core/money';
import { BasketItem, PaymentStatus } from '../../types';
import { SipayHashFields } from './types';

/** CCPayment API paths, relative to the brand's base URL. */
export const SIPAY_PATHS = {
  token: '/ccpayment/api/token',
  pay2D: '/ccpayment/api/paySmart2D',
  pay3D: '/ccpayment/api/paySmart3D',
  status: '/ccpayment/api/checkstatus',
  refund: '/ccpayment/api/refund',
  confirm: '/ccpayment/api/confirmPayment',
  pos: '/ccpayment/api/getpos',
} as const;

/** Sipay's application-level "OK" status code. */
export const SIPAY_OK = 100;

const sha1Hex = (s: string) => createHash('sha1').update(s, 'utf8').digest('hex');
const sha256Hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

/**
 * AES-256-CBC key for one hash_key: the first 32 hex chars of
 * SHA256(SHA1(appSecret) + salt), used as raw ASCII bytes (not hex-decoded).
 */
function aesKey(appSecret: string, salt: string): Buffer {
  return Buffer.from(sha256Hex(sha1Hex(appSecret) + salt).slice(0, 32), 'utf8');
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Encrypt `|`-joined fields into a Sipay hash_key — `iv:salt:base64`, with "/"
 * written as "__". IV (16 chars) and salt (4 chars) are random per call; the
 * `iv`/`salt` parameters exist only so tests can pin a vector.
 */
export function sealSipayHashKey(
  fields: Array<string | number>,
  appSecret: string,
  iv = randomBytes(8).toString('hex'),
  salt = randomBytes(2).toString('hex'),
): string {
  const cipher = createCipheriv('aes-256-cbc', aesKey(appSecret, salt), Buffer.from(iv, 'utf8'));
  const body = Buffer.concat([cipher.update(fields.join('|'), 'utf8'), cipher.final()]).toString('base64');
  return `${iv}:${salt}:${body}`.replace(/\//g, '__');
}

/**
 * Undo transport damage to a posted hash_key: leftover percent-encoding, a
 * form parser's "+" → " ", and Sipay's own "/" → "__" substitution.
 */
function normaliseHashKey(raw: string): string | undefined {
  let v = raw.trim();
  if (v.includes('%')) {
    try {
      v = decodeURIComponent(v);
    } catch {
      return undefined;
    }
  }
  return v.split(' ').join('+').split('__').join('/');
}

/**
 * Decrypt a hash_key into its `|`-separated fields. Never throws: anything not
 * sealed with this app secret (wrong key, bad padding, mangled value, non-UTF-8
 * plaintext) yields `undefined`.
 */
export function openSipayHashKey(hashKey: unknown, appSecret: string): string[] | undefined {
  if (typeof hashKey !== 'string' || !appSecret) return undefined;
  const parts = normaliseHashKey(hashKey)?.split(':');
  if (!parts || parts.length !== 3) return undefined;
  const [iv, salt, body] = parts;
  if (iv.length !== 16 || !salt || !body) return undefined;
  try {
    const decipher = createDecipheriv('aes-256-cbc', aesKey(appSecret, salt), Buffer.from(iv, 'utf8'));
    const plain = Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]);
    return new TextDecoder('utf-8', { fatal: true }).decode(plain).split('|');
  } catch {
    return undefined;
  }
}

/** Payment-result hash_key (3D callback / paySmart2D): `status|total|invoice_id|order_id|currency_code`. */
export function readSipayResultSeal(hashKey: unknown, appSecret: string): SipayHashFields | undefined {
  const f = openSipayHashKey(hashKey, appSecret);
  if (!f || f.length < 5) return undefined;
  const [status, total, invoiceId, orderId, currency] = f;
  return { status, total, invoiceId, orderId, currency };
}

function str(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  return String(v);
}

/**
 * Locally verify a Sipay/QNBpay 3D Secure callback (return_url or cancel_url
 * POST): the encrypted `hash_key` must decrypt with `appSecret`, and the posted
 * `invoice_id` (and `order_id`, when posted) must equal the signed values.
 *
 * This is authenticity only — an authentic *declined* callback returns `true`;
 * `completeThreeDSPayment` decides success from the signed status. The
 * paymentId to trust is the payload's `invoice_id` once this returns `true`.
 */
export function verifySipay3DCallback(payload: Record<string, unknown>, appSecret: string): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const signed = readSipayResultSeal(payload.hash_key, appSecret);
  if (!signed || !signed.invoiceId) return false;
  const invoiceId = str(payload.invoice_id);
  if (invoiceId === undefined || !safeEqual(invoiceId, signed.invoiceId)) return false;
  const orderId = str(payload.order_id);
  if (orderId !== undefined && orderId !== '' && !safeEqual(orderId, signed.orderId)) return false;
  return true;
}

/** Two-decimal amount string, as Sipay sends and signs it. */
export function formatSipayAmount(price: string | number): string {
  const value = typeof price === 'number' ? price : parseFloat(price);
  if (!isFinite(value) || value < 0) throw new Error(`Invalid amount for Sipay: ${price}`);
  return (Math.round(value * 100) / 100).toFixed(2);
}

/** Same amount in minor units (both sides parsed, so "1.2" equals "1.20"). */
export function sameSipayAmount(a: unknown, b: string, currency = 'TRY'): boolean {
  if (typeof a !== 'string' && typeof a !== 'number') return false;
  try {
    return safeEqual(String(toMinor(a, currency)), String(toMinor(b, currency)));
  } catch {
    return false;
  }
}

export function getSipayCurrency(currency?: string): string {
  const c = (currency || 'TRY').toUpperCase();
  const code = c === 'TL' ? 'TRY' : c;
  if (!['TRY', 'USD', 'EUR', 'GBP'].includes(code)) {
    throw new Error(`Currency ${currency} is not supported by Sipay`);
  }
  return code;
}

export function getSipayInstallment(installment?: number): number {
  const n = installment && installment > 1 ? installment : 1;
  if (!Number.isInteger(n) || n > 12) throw new Error(`Sipay supports 1-12 installments, got ${installment}`);
  return n;
}

export interface SipayBasketLine {
  name: string;
  price: string;
  quantity: number;
  description: string;
}

/**
 * Sipay refuses an item list whose prices don't sum to `total`. Use the basket
 * when it sums exactly; otherwise (interest, discount, paidPrice ≠ price) send
 * the whole order as one line.
 */
export function sipayBasketLines(basket: BasketItem[] | undefined, total: string, description: string): SipayBasketLine[] {
  const lines: SipayBasketLine[] = [];
  let sumMinor = 0;
  for (const item of basket || []) {
    const price = formatSipayAmount(item.price);
    sumMinor += toMinor(price, 'TRY');
    lines.push({ name: item.name, price, quantity: 1, description: item.category1 || item.name });
  }
  const whole = [{ name: description, price: total, quantity: 1, description }];
  return lines.length > 0 && sumMinor === toMinor(total, 'TRY') ? lines : whole;
}

/**
 * Hidden inputs of an HTML form. paySmart3D answers a rejected request with an
 * auto-posting form carrying the error instead of the 3D page.
 */
export function hiddenInputs(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [tag] of html.matchAll(/<input\b[^>]*>/gi)) {
    const name = /\bname\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (name) out[name] = /\bvalue\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? '';
  }
  return out;
}

/** checkstatus `transaction_status` (lower-cased) → unified status; anything unlisted is still in flight. */
const CHECK_STATUS: Record<string, PaymentStatus> = {
  completed: PaymentStatus.SUCCESS,
  'pre-authorization': PaymentStatus.SUCCESS, // amount held, not yet captured
  'partial refund': PaymentStatus.SUCCESS, // still a (smaller) sale
  partially_refund: PaymentStatus.SUCCESS,
  refunded: PaymentStatus.CANCELLED,
  refund: PaymentStatus.CANCELLED,
  cancelled: PaymentStatus.CANCELLED,
  canceled: PaymentStatus.CANCELLED,
  void: PaymentStatus.CANCELLED,
  failed: PaymentStatus.FAILURE,
  fail: PaymentStatus.FAILURE,
};

export function sipayStatusFromCheck(status?: string): PaymentStatus {
  return CHECK_STATUS[(status || '').trim().toLowerCase()] ?? PaymentStatus.PENDING;
}
