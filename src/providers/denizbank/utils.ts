import axios from 'axios';
import { createHash, timingSafeEqual } from 'crypto';
import { PaymentStatus } from '../../types';
import { formatMinor, toMinor } from '../../core/money';
import { escapeXml } from '../parampos/utils';
import { buildRedirectFormHtml } from '../garanti/utils';

/** InterVPos takes the 3D form and the API calls on the same path. */
export const DENIZBANK_PATH = '/mpi/Default.aspx';

// --- helpers shared with the QNB provider (same PayFor-family conventions) ---

/** base64(SHA1(input)) — the digest both InterVPos and PayFor sign with. */
export function sha1Base64(input: string): string {
  return createHash('sha1').update(input, 'utf8').digest('base64');
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

/** A form field as a string; anything else (array from a duplicated field, object) is `undefined`. */
export function field(payload: Record<string, unknown>, name: string): string | undefined {
  const v = payload[name];
  return typeof v === 'string' ? v : undefined;
}

const CURRENCY_CODES: Record<string, string> = { TRY: '949', TL: '949', USD: '840', EUR: '978', GBP: '826' };

/** ISO 4217 numeric code; throws on a currency the POS does not take. */
export function bankCurrencyCode(currency: string | undefined, bank: string): string {
  const code = CURRENCY_CODES[(currency || 'TRY').toUpperCase()];
  if (!code) throw new Error(`Currency ${currency} is not supported by ${bank}`);
  return code;
}

/** '100' / 100 / '100.5' → '100.00'. All supported currencies have 2 decimals. */
export function bankAmount(price: string | number): string {
  return formatMinor(toMinor(price, 'TRY'), 'TRY');
}

/** True when a posted amount equals the expected '100.00'; unparsable counts as different. */
export function sameAmount(posted: string, expected: string): boolean {
  try {
    return bankAmount(posted) === expected;
  } catch {
    return false;
  }
}

/** MMYY */
export function bankExpiry(month: string, year: string): string {
  const mm = String(month).padStart(2, '0');
  const yy = String(year).slice(-2).padStart(2, '0');
  if (!/^(0[1-9]|1[0-2])$/.test(mm) || !/^\d{2}$/.test(yy)) {
    throw new Error(`Invalid card expiry: ${month}/${year}`);
  }
  return mm + yy;
}

export function assertInstallment(installment: number | undefined): number {
  const n = installment ?? 1;
  if (!Number.isInteger(n) || n < 1 || n > 99) throw new Error(`Invalid installment count: ${installment}`);
  return n;
}

/** Auto-submitting form; every value is HTML-escaped (callback URLs carry `&`). */
export function buildBankFormHtml(action: string, fields: Record<string, string>): string {
  const escaped = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, escapeXml(v)]));
  return buildRedirectFormHtml(escapeXml(action), escaped);
}

/**
 * Error → result. No HTTP response means the bank may have processed the
 * request: PENDING/NETWORK_ERROR, confirm later. Never returns the axios error
 * itself — its config headers/body carry credentials.
 */
export function bankFailure<T>(error: unknown, bank: string, fallback: string, extra: Record<string, unknown> = {}): T {
  if (axios.isAxiosError(error)) {
    if (!error.response) {
      return {
        status: PaymentStatus.PENDING,
        errorCode: 'NETWORK_ERROR',
        errorMessage: `No response from ${bank}; the outcome is unknown and must be confirmed`,
        ...extra,
      } as T;
    }
    return {
      status: PaymentStatus.FAILURE,
      errorCode: `HTTP_${error.response.status}`,
      errorMessage: fallback,
      rawResponse: error.response.data,
      ...extra,
    } as T;
  }
  return {
    status: PaymentStatus.FAILURE,
    errorMessage: error instanceof Error ? error.message : fallback,
    ...extra,
  } as T;
}

// --- Denizbank specifics ---

/**
 * 3D form `Hash`:
 * base64(SHA1(ShopCode + OrderId + PurchAmount + OkUrl + FailUrl + TxnType + InstallmentCount + Rnd + MerchantPass))
 */
export function denizbankFormHash(p: {
  shopCode: string;
  orderId: string;
  amount: string;
  okUrl: string;
  failUrl: string;
  txnType: string;
  installment: string;
  rnd: string;
  merchantPass: string;
}): string {
  return sha1Base64(
    p.shopCode + p.orderId + p.amount + p.okUrl + p.failUrl + p.txnType + p.installment + p.rnd + p.merchantPass,
  );
}

/** Fields the signed list must cover before any status is read from the callback. */
const REQUIRED_SIGNED = ['OrderId', '3DStatus', 'MD'];

/**
 * Verifies the HASH InterVPos posts to OkUrl/FailUrl:
 * `base64(SHA1(values of the HASHPARAMS fields, joined, + MerchantPass))`.
 *
 * The value string is rebuilt from the posted fields (HASHPARAMSVAL is only
 * cross-checked), the list must cover OrderId, 3DStatus and MD, and the
 * comparison is constant-time. Values are joined without separators and
 * HASHPARAMS itself is unsigned, so a valid hash does NOT pin the amount —
 * the charge leg uses the merchant's own amount for that reason.
 */
export function verifyDenizbank3DCallback(payload: Record<string, unknown>, merchantPass: string): boolean {
  if (!payload || typeof payload !== 'object' || !merchantPass) return false;
  const hash = field(payload, 'HASH');
  const params = field(payload, 'HASHPARAMS');
  if (!hash || !params || !field(payload, 'OrderId')) return false;
  const names = params.split(':').filter(Boolean);
  if (!REQUIRED_SIGNED.every((n) => names.includes(n))) return false;
  let joined = '';
  for (const name of names) {
    const v = payload[name];
    if (v !== undefined && typeof v !== 'string') return false;
    joined += v ?? '';
  }
  const claimed = payload.HASHPARAMSVAL;
  if (claimed !== undefined && claimed !== joined) return false;
  return safeEqual(sha1Base64(joined + merchantPass), hash);
}

/** InterVPos wants '' for a single payment. */
export function denizbankInstallment(installment: number | undefined): string {
  const n = assertInstallment(installment);
  return n > 1 ? String(n) : '';
}

export function denizbankCardType(pan: string): string {
  if (/^3[47]/.test(pan)) return 'amex';
  if (/^(5[1-5]|2[2-7])/.test(pan)) return 'mastercard';
  return 'visa';
}

/** InterVPos answers `Key=Value;;Key=Value;;`. Throws on anything else. */
export function parseDenizbankResponse(body: unknown): Record<string, string> {
  const text = typeof body === 'string' ? body : '';
  if (!text.includes('ProcReturnCode=')) throw new Error('Denizbank returned an unexpected response');
  const out: Record<string, string> = {};
  for (const pair of text.split(';;')) {
    const i = pair.indexOf('=');
    if (i <= 0) continue;
    const key = pair.slice(0, i).replace(/^;+/, '').trim();
    if (key && !(key in out)) out[key] = pair.slice(i + 1).trim();
  }
  return out;
}
