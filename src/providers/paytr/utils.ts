import crypto from 'crypto';
import type { PayTRBasketItem } from './types';

/**
 * PayTR için hash oluşturur
 */
// PayTR signs every payload with HMAC-SHA256 keyed by `merchant_key`, with
// `merchant_salt` appended to the signed string. Earlier this used the salt
// as the HMAC key, which does not match PayTR's spec.
export function generatePayTRHash(
  merchantId: string,
  userIp: string,
  merchantOid: string,
  email: string,
  paymentAmount: string,
  userBasket: string,
  noInstallment: string,
  maxInstallment: string,
  currency: string,
  testMode: string,
  merchantSalt: string,
  merchantKey: string
): string {
  const hashStr = `${merchantId}${userIp}${merchantOid}${email}${paymentAmount}${userBasket}${noInstallment}${maxInstallment}${currency}${testMode}${merchantSalt}`;
  return crypto.createHmac('sha256', merchantKey).update(hashStr).digest('base64');
}

/**
 * PayTR callback hash'ini doğrular.
 * hash = base64(HMAC_SHA256(merchant_oid + merchant_salt + status + total_amount, merchant_key))
 */
export function verifyPayTRCallback(
  merchantOid: string,
  merchantSalt: string,
  status: string,
  totalAmount: string,
  hash: string,
  merchantKey: string
): boolean {
  const calculatedHash = crypto
    .createHmac('sha256', merchantKey)
    .update(`${merchantOid}${merchantSalt}${status}${totalAmount}`)
    .digest('base64');

  return timingSafeEqualStr(calculatedHash, hash);
}

/**
 * Constant-time string comparison for signatures/hashes — prevents a
 * timing side-channel from revealing how many leading bytes matched.
 */
function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Sepet itemlerini PayTR formatına çevirir
 */
export function formatPayTRBasket(items: PayTRBasketItem[]): string {
  const basketArray = items.map((item) => [item.name, item.price, item.quantity]);
  return JSON.stringify(basketArray);
}

/**
 * TL'yi kuruşa çevirir
 */
export function convertToKurus(amount: string): string {
  const amountFloat = parseFloat(amount);
  return Math.round(amountFloat * 100).toString();
}

/**
 * Kuruşu TL'ye çevirir
 */
export function convertFromKurus(kurus: string): string {
  const kurusInt = parseInt(kurus, 10);
  return (kurusInt / 100).toFixed(2);
}

/**
 * PayTR token oluşturur
 */
export function generatePayTRToken(
  merchantId: string,
  merchantOid: string,
  returnAmount: string,
  merchantSalt: string,
  merchantKey: string
): string {
  const tokenStr = `${merchantId}${merchantOid}${returnAmount}${merchantSalt}`;
  return crypto.createHmac('sha256', merchantKey).update(tokenStr).digest('base64');
}

/**
 * PayTR BIN detail token oluşturur
 */
export function generateBinDetailToken(
  merchantId: string,
  binNumber: string,
  merchantSalt: string,
  merchantKey: string
): string {
  const tokenStr = `${merchantId}${binNumber}${merchantSalt}`;
  return crypto.createHmac('sha256', merchantKey).update(tokenStr).digest('base64');
}

/**
 * PayTR form data oluşturur
 */
export function createPayTRFormData(data: Record<string, string>): string {
  return Object.entries(data)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}
