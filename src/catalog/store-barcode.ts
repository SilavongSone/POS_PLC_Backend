/**
 * In-store barcodes for goods that come without one (or packs/cartons whose
 * box has none): EAN-13 numbers in the GS1 restricted-circulation range,
 * prefix `20` (`21`–`29` stay free for price/weight scale labels).
 *
 * Layout: `20` + 10-digit running number + check digit.
 */
export const STORE_BARCODE_PREFIX = '20';
export const STORE_BARCODE_RE = /^20\d{11}$/;

/** GS1 mod-10 check digit of the first 12 digits of an EAN-13. */
export function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 ? 3 : 1);
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code) === Number(code[12]);
}

/** The store barcode with running number `n` (1-based). */
export function storeBarcode(n: number): string {
  const body = STORE_BARCODE_PREFIX + String(n).padStart(10, '0');
  return body + ean13CheckDigit(body);
}

/** Running number of a store barcode, or 0 when the code is not one. */
export function storeBarcodeNumber(code: string | null | undefined): number {
  return code && STORE_BARCODE_RE.test(code) && isValidEan13(code)
    ? Number(code.slice(2, 12))
    : 0;
}
