import { createHash, createHmac } from 'crypto';
import { toMinor } from '../../core/money';

const CURRENCIES: Record<string, string> = { TRY: '0949', TL: '0949', USD: '0840', EUR: '0978' };

/** KT Pay Gate wants a four-digit numeric currency. Only TRY/USD/EUR are accepted. */
export function getKuveytTurkCurrency(currency?: string): string {
  const code = CURRENCIES[(currency || 'TRY').toUpperCase()];
  if (!code) throw new Error(`Kuveyt Türk does not support currency ${currency}`);
  return code;
}

/** '102.65' → '10265'. All supported currencies have two minor digits. */
export function formatKuveytTurkAmount(price: string): string {
  return String(toMinor(price, 'TRY'));
}

/** `base64(SHA1(password))` — the bank's "HashPassword", also the HMAC key. */
export function kuveytTurkHashPassword(password: string): string {
  return createHash('sha1').update(password, 'utf8').digest('base64');
}

/**
 * KT Pay Gate `hashData`:
 * `base64(HMAC-SHA512(key = HashPassword, data = fields.join('') + HashPassword))`.
 *
 * Field order per endpoint (UserName is always last before HashPassword):
 * - Payment:          MerchantId, MerchantOrderId, Amount, SuccessUrl, FailUrl, UserName
 * - Provision:        MerchantId, MerchantOrderId, Amount, UserName
 * - SaleReversal:     MerchantId, MerchantOrderId, Amount, UserName
 *                     (Amount is '0' for Cancel/Drawback; only PartialDrawback signs it)
 * - GetTransactions:  MerchantId, MerchantOrderId, UserName
 */
export function signKuveytTurk(fields: string[], password: string): string {
  const hashPassword = kuveytTurkHashPassword(password);
  return createHmac('sha512', hashPassword)
    .update(fields.join('') + hashPassword, 'utf8')
    .digest('base64');
}

/**
 * "+90 535 000 00 00" / "05350000000" / "5350000000" → { cc: '90', subscriber: '5350000000' }.
 * The API takes the two parts separately and only Turkish numbers split reliably.
 */
export function splitKuveytTurkPhone(gsm: string): { cc: string; subscriber: string } {
  const d = (gsm || '').replace(/\D/g, '');
  const subscriber =
    d.length === 10 ? d
      : d.length === 11 && d.startsWith('0') ? d.slice(1)
        : d.length === 12 && d.startsWith('90') ? d.slice(2)
          : '';
  if (!subscriber) throw new Error(`Kuveyt Türk needs a Turkish GSM number, got: ${gsm}`);
  return { cc: '90', subscriber };
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };

function unescapeHtml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
    if (e[0] === '#') {
      return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/**
 * Hidden inputs of an HTML form. The Payment endpoint answers HTML either way:
 * the 3D page on success, or an auto-post to failUrl carrying `Success=False`.
 */
export function readKuveytTurkFormFields(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [tag] of html.matchAll(/<input\b[^>]*>/gi)) {
    const name = /\bname\s*=\s*"([^"]*)"/i.exec(tag)?.[1];
    if (name) out[unescapeHtml(name)] = unescapeHtml(/\bvalue\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? '');
  }
  return out;
}

/** "Başarısız (2)" → 2. */
export function kuveytTurkStatusNumber(label: unknown): number | undefined {
  const m = typeof label === 'string' ? /\((\d+)\)\s*$/.exec(label) : null;
  return m ? Number(m[1]) : undefined;
}
