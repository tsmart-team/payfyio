import { PaymentStatus } from '../../types';
import { escapeXml } from '../parampos/utils';
import { assertInstallment, field, safeEqual, sha1Base64 } from '../denizbank/utils';

/** 3D form target (customer's browser). */
export const QNB_GATE_PATH = '/Gateway/Default.aspx';
/** XML API (PayforRequest). */
export const QNB_API_PATH = '/Gateway/XmlGate.aspx';
/** QNB's institution code on the PayFor platform. */
export const QNB_MBR_ID = '5';

/**
 * 3D form `Hash`:
 * base64(SHA1(MbrId + OrderId + PurchAmount + OkUrl + FailUrl + TxnType + InstallmentCount + Rnd + MerchantPass))
 */
export function qnbFormHash(p: {
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
    QNB_MBR_ID + p.orderId + p.amount + p.okUrl + p.failUrl + p.txnType + p.installment + p.rnd + p.merchantPass,
  );
}

/**
 * Verifies a 3D callback's `ResponseHash`:
 * base64(SHA1(MerchantID + MerchantPass + OrderId + AuthCode + ProcReturnCode + 3DStatus + ResponseRnd + UserCode)).
 * MerchantID and UserCode come from YOUR configuration, never the callback.
 * Constant-time. Covers no amount — the amount is bound by the form hash at
 * init and confirmed with the bank on completion.
 */
export function verifyQnb3DCallback(
  payload: Record<string, unknown>,
  merchantId: string,
  merchantPass: string,
  userCode: string,
): boolean {
  if (!payload || typeof payload !== 'object' || !merchantId || !merchantPass || !userCode) return false;
  const hash = field(payload, 'ResponseHash');
  const rnd = field(payload, 'ResponseRnd');
  const orderId = field(payload, 'OrderId');
  if (!hash || !rnd || !orderId) return false;
  const signed = ['AuthCode', 'ProcReturnCode', '3DStatus'];
  if (signed.some((n) => payload[n] !== undefined && typeof payload[n] !== 'string')) return false;
  const [authCode, procReturnCode, threeDStatus] = signed.map((n) => field(payload, n) ?? '');
  const expected = sha1Base64(
    merchantId + merchantPass + orderId + authCode + procReturnCode + threeDStatus + rnd + userCode,
  );
  return safeEqual(expected, hash);
}

/** PayFor wants '0' for a single payment. */
export function qnbInstallment(installment: number | undefined): string {
  const n = assertInstallment(installment);
  return n > 1 ? String(n) : '0';
}

/** PayFor rejects anything outside letters, digits, '-' and '_' (Turkish letters included). */
export function assertQnbOrderId(orderId: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(orderId)) {
    throw new Error(`QNB order ids must be 1-64 letters, digits, '-' or '_': ${orderId}`);
  }
  return orderId;
}

export function buildQnbXml(fields: Record<string, string>): string {
  const body = Object.entries(fields)
    .map(([k, v]) => `<${k}>${escapeXml(v)}</${k}>`)
    .join('');
  return `<?xml version="1.0" encoding="utf-8"?><PayforRequest>${body}</PayforRequest>`;
}

function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|quot|apos|amp);/gi, (_, e: string) => {
    const named: Record<string, string> = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };
    if (e[0] !== '#') return named[e.toLowerCase()];
    return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  });
}

/** Flat fields of a `PayforResponse`; first occurrence wins. Throws on any other body. */
export function parseQnbXml(body: unknown): Record<string, string> {
  const xml = typeof body === 'string' ? body : '';
  if (!xml.includes('<PayforResponse')) throw new Error('QNB returned an unexpected response');
  const out: Record<string, string> = {};
  for (const [, tag, value] of xml.matchAll(/<([A-Za-z_][\w.-]*)(?:\s[^>]*)?>([^<]*)<\/\1>/g)) {
    if (!(tag in out)) out[tag] = unescapeXml(value).trim();
  }
  return out;
}

/** `OrderInquiry` → status. Voided or refunded sales are CANCELLED. */
export function mapQnbInquiry(res: Record<string, string | undefined>): PaymentStatus {
  if (res.IsVoided === 'true' || res.IsRefunded === 'true' || res.TxnStatus === 'V') return PaymentStatus.CANCELLED;
  if (res.TxnStatus === 'Y' && res.TxnResult === 'Success') return PaymentStatus.SUCCESS;
  if (res.TxnResult === 'Failed') return PaymentStatus.FAILURE;
  return PaymentStatus.PENDING;
}
