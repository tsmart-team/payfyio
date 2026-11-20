/**
 * Money helpers — minor-unit ↔ decimal-string conversion.
 *
 * payfyio's request surface historically takes amounts as decimal strings
 * (`'100.00'`). The marketplace primitives (pre-auth/capture, payout, split)
 * take `amountMinor` integers instead, because integer arithmetic has no
 * float-rounding bugs and maps 1:1 onto our ledger. These helpers are the only
 * place that bridges the two: provider code converts `amountMinor` → the string
 * the provider's HTTP API expects via `formatMinor`, and converts a provider
 * integer amount back via `fromMinor`.
 *
 * "Minor unit" = the smallest currency unit: kuruş for TRY, cent for USD/EUR/GBP
 * (2 decimals), but the whole unit itself for zero-decimal currencies like JPY
 * (¥100 is `amountMinor: 100`, not `10000`).
 */

/**
 * Currencies with no minor unit (ISO 4217 exponent 0). For these, one major
 * unit IS the smallest unit, so `amountMinor` and the displayed amount match.
 * Source: ISO 4217. Kept as the common subset payment providers actually accept.
 */
const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF',
  'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);

/**
 * Currencies with three minor-unit digits (ISO 4217 exponent 3).
 */
const THREE_DECIMAL_CURRENCIES = new Set([
  'BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND',
]);

function normalizeCurrency(currency: string): string {
  return (currency || 'TRY').trim().toUpperCase();
}

/**
 * Number of minor-unit digits for a currency. Most currencies use 2 (e.g. TRY,
 * USD); zero-decimal currencies (JPY, KRW) use 0; a few Gulf dinars use 3.
 */
export function minorUnitDigits(currency: string): 0 | 2 | 3 {
  const c = normalizeCurrency(currency);
  if (ZERO_DECIMAL_CURRENCIES.has(c)) return 0;
  if (THREE_DECIMAL_CURRENCIES.has(c)) return 3;
  return 2;
}

/**
 * Convert a decimal string (`'100.00'`) to a minor-unit integer for the given
 * currency (`10000` for TRY, `100` for JPY).
 *
 * Throws on non-finite / negative input. Uses round-half-up to the currency's
 * precision to absorb float artifacts (e.g. `'10.005' * 100`).
 */
export function toMinor(decimal: string | number, currency: string): number {
  const value = typeof decimal === 'number' ? decimal : parseFloat(decimal);
  if (!isFinite(value) || value < 0) {
    throw new Error(`Invalid amount: ${decimal}`);
  }
  const factor = 10 ** minorUnitDigits(currency);
  return Math.round(value * factor);
}

/**
 * Convert a minor-unit integer back to a decimal number (`10000` → `100` for
 * TRY). Use `formatMinor` when you need the provider's string representation.
 */
export function fromMinor(amountMinor: number, currency: string): number {
  if (!Number.isInteger(amountMinor)) {
    throw new Error(`amountMinor must be an integer: ${amountMinor}`);
  }
  const factor = 10 ** minorUnitDigits(currency);
  return amountMinor / factor;
}

/**
 * Format a minor-unit integer as the decimal string most card/POS provider
 * APIs expect (`10000`,`TRY` → `'100.00'`; `100`,`JPY` → `'100'`). This is the
 * canonical bridge from `amountMinor` to payfyio's existing string surface.
 */
export function formatMinor(amountMinor: number, currency: string): string {
  if (!Number.isInteger(amountMinor)) {
    throw new Error(`amountMinor must be an integer: ${amountMinor}`);
  }
  const digits = minorUnitDigits(currency);
  return (amountMinor / 10 ** digits).toFixed(digits);
}
