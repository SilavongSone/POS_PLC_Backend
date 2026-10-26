import { Prisma, type Currency } from '../generated/prisma/client.js';

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;
/** Anything Decimal accepts: number, numeric string or Decimal. */
export type DecimalLike = Prisma.Decimal | number | string;

/** Rounds a LAK amount UP to a multiple of `step` (e.g. 1000). */
export function roundUpLak(amount: DecimalLike, step = 1): Decimal {
  const value = new Decimal(amount);
  const s = new Decimal(step);
  return value.div(s).ceil().mul(s);
}

/**
 * Converts a price in `currency` to whole LAK. Foreign prices are rounded up to
 * `lakRounding`; LAK prices are only rounded up to whole kip.
 */
export function priceToLak(
  amount: DecimalLike,
  currency: Currency,
  lakPerUnit: DecimalLike,
  lakRounding: number,
): Decimal {
  if (currency === 'LAK') return roundUpLak(amount, 1);
  return roundUpLak(new Decimal(amount).mul(lakPerUnit), lakRounding);
}

/** Converts a cost to whole LAK (rounded half up; costs are not marked up). */
export function costToLak(
  amount: DecimalLike,
  lakPerUnit: DecimalLike,
): Decimal {
  return new Decimal(amount)
    .mul(lakPerUnit)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
}
