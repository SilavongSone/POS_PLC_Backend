/**
 * Counting rules of BUY_X_GET_Y and GIFT promotions (pure, unit-tested). Money is worked
 * out by the caller with the line's unit price.
 */

/** Units given free (or reduced) in `quantity` units of "buy X get Y": every full X+Y set gives Y. */
export function freeUnits(quantity: number, buyQty: number, getQty: number) {
  if (buyQty < 1 || getQty < 1 || quantity < 1) return 0;
  return Math.floor(quantity / (buyQty + getQty)) * getQty;
}

/** Gift units earned by `bought` qualifying units: getQty per full set of buyQty. */
export function giftsEarned(bought: number, buyQty: number, getQty: number) {
  if (buyQty < 1 || getQty < 1 || bought < 1) return 0;
  return Math.floor(bought / buyQty) * getQty;
}

/** What one GIFT promotion recorded on a sale (Sale.giftRules), for returns. */
export type GiftRule = {
  promotionId: string;
  name: string;
  buyQty: number;
  getQty: number;
  /** Lines that earned the gifts; unitsPerItem = base units per line unit (packs). */
  qualifying: { saleItemId: string; unitsPerItem: number }[];
  /** Gift lines: how many of their units were free and what each one was worth. */
  gifts: { saleItemId: string; units: number; valueLak: string }[];
};

/**
 * Units of gifts kept beyond what the remaining bought items still earn. A return charges the
 * growth of this number (and gives it back when the gift comes back later).
 */
export function excessGifts(
  rule: Pick<GiftRule, 'buyQty' | 'getQty'>,
  stillBought: number,
  giftsKept: number,
) {
  return Math.max(
    0,
    giftsKept - giftsEarned(stillBought, rule.buyQty, rule.getQty),
  );
}
