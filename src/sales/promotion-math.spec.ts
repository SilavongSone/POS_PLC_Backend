import { excessGifts, freeUnits, giftsEarned } from './promotion-math.js';

describe('promotion math', () => {
  it('buy 1 get 1: every second unit', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((q) => freeUnits(q, 1, 1))).toEqual([
      0, 1, 1, 2, 2, 3, 3,
    ]);
  });

  it('buy 2 get 1: one in every three', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((q) => freeUnits(q, 2, 1))).toEqual([
      0, 0, 1, 1, 1, 2, 2,
    ]);
  });

  it('buy 3 get 2', () => {
    expect([4, 5, 9, 10].map((q) => freeUnits(q, 3, 2))).toEqual([0, 2, 2, 4]);
  });

  it('gifts per full set bought', () => {
    expect([0, 1, 2, 3].map((q) => giftsEarned(q, 1, 1))).toEqual([0, 1, 2, 3]);
    expect([1, 2, 3, 4].map((q) => giftsEarned(q, 2, 1))).toEqual([0, 1, 1, 2]);
    expect(giftsEarned(5, 0, 1)).toBe(0);
  });

  it('counts gifts kept beyond what is still earned', () => {
    const rule = { buyQty: 1, getQty: 1 };
    // Bought 2 computers, got 2 mice: return 1 computer, keep both mice → 1 too many.
    expect(excessGifts(rule, 1, 2)).toBe(1);
    // Return the mouse too: nothing to charge.
    expect(excessGifts(rule, 1, 1)).toBe(0);
    expect(excessGifts(rule, 0, 0)).toBe(0);
  });
});
