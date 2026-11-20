import { createHash } from 'crypto';
import { safeEqual } from '../yapikredi/utils';

/** e-POS MAC: `b64(SHA256(values concatenated without separator + encKey))`. */
export function buildAlbarakaMac(values: Array<string | number | null | undefined>, encKey: string): string {
  const joined = values.map((v) => (v == null ? '' : String(v))).join('');
  return createHash('sha256').update(joined + encKey, 'utf8').digest('base64');
}

/** Fields the payment decision and the charge are made on — the bank must have signed them. */
const REQUIRED_SIGNED = ['mdstatus', 'securetransactionid', 'cavv', 'eci'];

/** Case-insensitive field read — completion must read fields exactly the way the verifier did. */
export function pick(data: Record<string, unknown>, name: string): string {
  const hit = Object.keys(data).find((k) => k.toLowerCase() === name.toLowerCase());
  const v = hit === undefined ? undefined : data[hit];
  return v == null ? '' : String(v);
}

/**
 * Verifies the `Mac` Albaraka posts to `MerchantReturnURL`:
 * `b64(SHA256(values of the fields named in MacParams + encKey))`, compared in
 * constant time. Fails closed when Mac/MacParams are missing, or when the
 * signed list leaves out MdStatus, SecureTransactionId, CAVV or ECI (a forged
 * callback could otherwise sign a harmless subset).
 *
 * The signed fields carry no order number or amount: amount binding comes from
 * the init MAC (which covers Amount) plus charging the amount from your records.
 */
export function verifyAlbaraka3DCallback(payload: Record<string, unknown>, encKey: string): boolean {
  if (!payload || !encKey) return false;
  const received = pick(payload, 'mac');
  const macParams = pick(payload, 'macparams');
  if (!received || !macParams) return false;
  const names = macParams.split(':').map((n) => n.trim()).filter(Boolean);
  const lower = names.map((n) => n.toLowerCase());
  if (!REQUIRED_SIGNED.every((n) => lower.includes(n))) return false;
  return safeEqual(buildAlbarakaMac(names.map((n) => pick(payload, n)), encKey), received);
}
