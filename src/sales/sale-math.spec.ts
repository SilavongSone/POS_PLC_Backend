import { Prisma } from '../generated/prisma/client.js';
import { computeVat, promotionDiscount, toLakAmount } from './sale-math.js';

const D = (v: number | string) => new Prisma.Decimal(v);

describe('sale math', () => {
  it('extracts 12% VAT from VAT-inclusive prices', () => {
    const r = computeVat(D(1_120_000), D(12), true);
    expect(r.vatLak.toString()).toBe('120000');
    expect(r.addedLak.toString()).toBe('0');
  });

  it('adds 12% VAT on top of VAT-exclusive prices, rounded to whole kip', () => {
    const r = computeVat(D(1_000_005), D(12), false);
    expect(r.vatLak.toString()).toBe('120001');
    expect(r.addedLak.toString()).toBe('120001');
  });

  it('charges nothing for 0% or empty bases', () => {
    expect(computeVat(D(500), D(0), true).vatLak.toString()).toBe('0');
    expect(computeVat(D(0), D(12), false).vatLak.toString()).toBe('0');
  });

  it('caps promotion discounts at the price', () => {
    expect(
      promotionDiscount(D(100_000), {
        discountType: 'PERCENT',
        value: '7.5',
      }).toString(),
    ).toBe('7500');
    expect(
      promotionDiscount(D(50_000), {
        discountType: 'AMOUNT',
        value: '80000',
      }).toString(),
    ).toBe('50000');
  });

  it('converts tendered foreign cash to whole kip', () => {
    expect(toLakAmount('100.5', '21800.5').toString()).toBe('2190950');
  });
});
