import { Prisma } from '../generated/prisma/client.js';

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

export const lak = (v: Prisma.Decimal | number | string) =>
  new Decimal(v).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);

/**
 * VAT for a sale. `vatableLak` is the amount after discounts of the lines that carry VAT.
 * With VAT-inclusive prices the VAT is extracted (total unchanged); otherwise it is added.
 */
export function computeVat(
  vatableLak: Decimal,
  percent: Decimal,
  pricesIncludeVat: boolean,
) {
  if (percent.isZero() || vatableLak.lte(0))
    return { vatLak: new Decimal(0), addedLak: new Decimal(0) };
  if (pricesIncludeVat) {
    return {
      vatLak: lak(vatableLak.mul(percent).div(percent.add(100))),
      addedLak: new Decimal(0),
    };
  }
  const vat = lak(vatableLak.mul(percent).div(100));
  return { vatLak: vat, addedLak: vat };
}

/** Per-unit promotion discount (never more than the price). */
export function promotionDiscount(
  unitPriceLak: Decimal,
  promo: {
    discountType: 'PERCENT' | 'AMOUNT';
    value: Prisma.Decimal | number | string;
  },
): Decimal {
  const d =
    promo.discountType === 'PERCENT'
      ? lak(unitPriceLak.mul(promo.value).div(100))
      : lak(promo.value);
  return Decimal.min(d, unitPriceLak);
}

/** Amount in foreign currency → whole LAK at the snapshot rate. */
export function toLakAmount(
  amount: Prisma.Decimal | number | string,
  lakPerUnit: Prisma.Decimal | number | string,
) {
  return lak(new Decimal(amount).mul(lakPerUnit));
}
