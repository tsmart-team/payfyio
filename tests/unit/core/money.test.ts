import { describe, it, expect } from 'vitest';
import { toMinor, fromMinor, formatMinor, minorUnitDigits } from '../../../src/core/money';

describe('money helpers', () => {
  describe('minorUnitDigits', () => {
    it('returns 2 for common decimal currencies', () => {
      expect(minorUnitDigits('TRY')).toBe(2);
      expect(minorUnitDigits('USD')).toBe(2);
      expect(minorUnitDigits('eur')).toBe(2);
    });

    it('returns 0 for zero-decimal currencies', () => {
      expect(minorUnitDigits('JPY')).toBe(0);
      expect(minorUnitDigits('KRW')).toBe(0);
    });

    it('returns 3 for three-decimal currencies', () => {
      expect(minorUnitDigits('KWD')).toBe(3);
      expect(minorUnitDigits('BHD')).toBe(3);
    });

    it('defaults unknown currency to 2 and tolerates casing/whitespace', () => {
      expect(minorUnitDigits('  try ')).toBe(2);
      expect(minorUnitDigits('XYZ')).toBe(2);
    });
  });

  describe('toMinor', () => {
    it('converts 2-decimal strings to minor units', () => {
      expect(toMinor('100.00', 'TRY')).toBe(10000);
      expect(toMinor('10.50', 'USD')).toBe(1050);
      expect(toMinor('0.01', 'EUR')).toBe(1);
    });

    it('treats zero-decimal currencies as whole units', () => {
      expect(toMinor('100', 'JPY')).toBe(100);
      expect(toMinor('1500', 'KRW')).toBe(1500);
    });

    it('handles three-decimal currencies', () => {
      expect(toMinor('1.000', 'KWD')).toBe(1000);
      expect(toMinor('0.250', 'BHD')).toBe(250);
    });

    it('rounds half-up to absorb float artifacts', () => {
      expect(toMinor('10.005', 'USD')).toBe(1001);
      expect(toMinor(19.99, 'TRY')).toBe(1999);
    });

    it('throws on negative or non-finite amounts', () => {
      expect(() => toMinor('-5', 'TRY')).toThrow(/Invalid amount/);
      expect(() => toMinor('abc', 'TRY')).toThrow(/Invalid amount/);
    });
  });

  describe('fromMinor', () => {
    it('converts minor units back to major decimals', () => {
      expect(fromMinor(10000, 'TRY')).toBe(100);
      expect(fromMinor(1050, 'USD')).toBe(10.5);
      expect(fromMinor(100, 'JPY')).toBe(100);
      expect(fromMinor(1000, 'KWD')).toBe(1);
    });

    it('throws on non-integer minor amounts', () => {
      expect(() => fromMinor(10.5, 'TRY')).toThrow(/integer/);
    });
  });

  describe('formatMinor', () => {
    it('formats minor units as provider decimal strings', () => {
      expect(formatMinor(10000, 'TRY')).toBe('100.00');
      expect(formatMinor(1, 'USD')).toBe('0.01');
      expect(formatMinor(100, 'JPY')).toBe('100');
      expect(formatMinor(1000, 'KWD')).toBe('1.000');
    });

    it('throws on non-integer minor amounts', () => {
      expect(() => formatMinor(10.5, 'TRY')).toThrow(/integer/);
    });
  });

  describe('round-trip', () => {
    it('toMinor → formatMinor preserves the decimal string', () => {
      for (const [v, c] of [['100.00', 'TRY'], ['10.50', 'USD'], ['100', 'JPY'], ['1.000', 'KWD']] as const) {
        expect(formatMinor(toMinor(v, c), c)).toBe(v);
      }
    });
  });
});
