import { describe, expect, it } from 'vitest';
import {
  ean13CheckDigit,
  isValidEan13,
  storeBarcode,
  storeBarcodeNumber,
} from './store-barcode.js';

describe('store barcodes', () => {
  it('computes the GS1 check digit', () => {
    expect(ean13CheckDigit('400638133393')).toBe(1); // 4006381333931
    expect(ean13CheckDigit('590123412345')).toBe(7); // 5901234123457
    expect(isValidEan13('4006381333931')).toBe(true);
    expect(isValidEan13('4006381333932')).toBe(false);
  });

  it('builds valid EAN-13 codes with prefix 20', () => {
    const code = storeBarcode(1);
    expect(code).toMatch(/^20\d{11}$/);
    expect(code.slice(0, 12)).toBe('200000000001');
    expect(isValidEan13(code)).toBe(true);
    expect(isValidEan13(storeBarcode(9_999_999_999))).toBe(true);
  });

  it('reads the running number back', () => {
    expect(storeBarcodeNumber(storeBarcode(42))).toBe(42);
    expect(storeBarcodeNumber('2000000000420')).toBe(0); // bad check digit
    expect(storeBarcodeNumber('2100000000427')).toBe(0); // scale range
    expect(storeBarcodeNumber('PAPER-80')).toBe(0);
    expect(storeBarcodeNumber(null)).toBe(0);
  });
});
