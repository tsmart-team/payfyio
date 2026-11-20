import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { EstStoreType, EstXmlResult } from './types';

export const EST_STORE_TYPES: readonly EstStoreType[] = ['3d', '3d_pay', '3d_pay_hosting', '3d_host'];

const CURRENCY_CODES: Record<string, string> = {
  TRY: '949',
  TL: '949',
  USD: '840',
  EUR: '978',
  GBP: '826',
};

/** ISO 4217 numeric code. Unknown currencies throw — never silently charge in TRY. */
export function getEstCurrency(code: string | undefined): string {
  const numeric = CURRENCY_CODES[(code || 'TRY').toUpperCase()];
  if (!numeric) throw new Error(`Currency ${code} is not supported by EST`);
  return numeric;
}

export function formatEstAmount(price: string): string {
  const value = parseFloat(price);
  if (!isFinite(value) || value <= 0) throw new Error(`Invalid price for EST: ${price}`);
  return value.toFixed(2);
}

export function formatEstInstallment(installment?: number): string {
  return installment && installment > 1 ? String(installment) : '';
}

export function randomNonce(): string {
  return randomBytes(16).toString('hex');
}

/** The bank collects the card on its own page. */
export function isHostedStoreType(storeType: EstStoreType): boolean {
  return storeType === '3d_pay_hosting' || storeType === '3d_host';
}

/** The bank only authenticates; we send the charge (`Auth` with `md`). */
export function isMerchantCharged(storeType: EstStoreType): boolean {
  return storeType === '3d' || storeType === '3d_host';
}

/**
 * Case-insensitive natural order (digit runs compare by value), the order
 * ver3 sorts parameter names in. Hand-written on purpose: `localeCompare`
 * places `_` and digits differently and would break some hashes.
 */
export function compareParamNames(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  const digitRun = /\d+/y;
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    digitRun.lastIndex = i;
    const p = digitRun.exec(x)?.[0];
    digitRun.lastIndex = j;
    const q = digitRun.exec(y)?.[0];
    if (p && q) {
      if (Number(p) !== Number(q)) return Number(p) - Number(q);
      i += p.length;
      j += q.length;
    } else if (x[i] !== y[j]) {
      return x[i] < y[j] ? -1 : 1;
    } else {
      i++;
      j++;
    }
  }
  return x.length - i - (y.length - j);
}

/** Parameters the bank leaves out of the hash. */
const NOT_HASHED = new Set(['hash', 'encoding', 'countdown', 'nationalidno']);

const escapeHashPart = (v: string) => v.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');

/**
 * Hash version 3 — `base64(SHA-512(v1|v2|…|storeKey))`, values ordered by
 * parameter name, `\` and `|` escaped in every part.
 *
 * Hashed as UTF-8; every value we sign is ASCII, where that equals the
 * bank's ISO-8859-9.
 */
export function buildEstHashV3(fields: Record<string, string>, storeKey: string): string {
  const parts = Object.keys(fields)
    .filter((k) => !NOT_HASHED.has(k.toLowerCase()))
    .sort(compareParamNames)
    .map((k) => escapeHashPart(fields[k]));
  parts.push(escapeHashPart(storeKey));
  return createHash('sha512').update(parts.join('|'), 'utf8').digest('base64');
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Verify the `HASH` EST posts to okUrl/failUrl. It covers every other
 * posted field, so the payload must be the bank's POST untouched — an added
 * or overwritten key fails verification. Non-string values fail closed.
 *
 * The hash binds values, not their names: a valid hash proves the values
 * came from the bank, the result still has to be confirmed with the bank
 * (`completeThreeDSPayment` does that).
 */
export function verifyEst3DCallback(payload: Record<string, unknown>, storeKey: string): boolean {
  if (!payload || typeof payload !== 'object' || !storeKey) return false;
  const received = payload.HASH;
  if (typeof received !== 'string' || !received) return false;
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (typeof v !== 'string') return false;
    fields[k] = v;
  }
  return safeEqual(buildEstHashV3(fields, storeKey), received);
}

const escapeXml = (v: string) =>
  v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Non-ASCII as character references: valid whatever encoding the bank assumes.
    .replace(/[^\x20-\x7e]/gu, (c) => `&#${c.codePointAt(0)};`);

export type XmlNode = string | number | undefined | { [key: string]: XmlNode };

function toXml(node: Record<string, XmlNode>): string {
  return Object.entries(node)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) =>
      typeof v === 'object' ? `<${k}>${toXml(v)}</${k}>` : `<${k}>${escapeXml(String(v))}</${k}>`,
    )
    .join('');
}

export function buildCC5Request(payload: Record<string, XmlNode>): string {
  return `<?xml version="1.0" encoding="ISO-8859-9"?><CC5Request>${toXml(payload)}</CC5Request>`;
}

const unescapeXml = (v: string) =>
  v
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

function leaves(xml: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of xml.matchAll(/<([A-Za-z_][\w.-]*)(?:\s[^>]*)?>([^<]*)<\/\1>/g)) {
    if (!(m[1] in out)) out[m[1]] = unescapeXml(m[2]).trim();
  }
  return out;
}

/** Parse a CC5Response; throws if the body is not one. */
export function parseCC5Response(xml: unknown): EstXmlResult {
  const body = typeof xml === 'string' ? xml : '';
  const m = body.match(/<CC5Response[^>]*>([\s\S]*)<\/CC5Response>/);
  if (!m) throw new Error('EST returned an unexpected response');
  const extraMatch = m[1].match(/<Extra>([\s\S]*?)<\/Extra>/);
  return {
    fields: leaves(extraMatch ? m[1].replace(extraMatch[0], '') : m[1]),
    extra: extraMatch ? leaves(extraMatch[1]) : {},
  };
}

export function isApproved(fields: Record<string, unknown>): boolean {
  return fields.ProcReturnCode === '00' && fields.Response === 'Approved';
}

const escapeHtml = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function buildRedirectFormHtml(actionUrl: string, fields: Record<string, string>): string {
  const inputs = Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Redirecting…</title></head><body onload="document.forms[0].submit()"><form method="POST" action="${escapeHtml(actionUrl)}">${inputs}<noscript><button type="submit">Continue to 3D Secure</button></noscript></form></body></html>`;
}
