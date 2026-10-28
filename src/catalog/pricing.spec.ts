import { costToLak, priceToLak, roundUpLak } from './pricing.js';

describe('pricing', () => {
  it('rounds LAK up to the step', () => {
    expect(roundUpLak(2_507_001, 1000).toString()).toBe('2508000');
    expect(roundUpLak(2_507_000, 1000).toString()).toBe('2507000');
  });

  it('converts USD prices with the rate and rounds up to 1,000', () => {
    // 115 USD × 21,800 = 2,507,000 exactly
    expect(priceToLak('115', 'USD', '21800', 1000).toString()).toBe('2507000');
    // 109.99 × 21,800 = 2,397,782 → 2,398,000
    expect(priceToLak('109.99', 'USD', '21800', 1000).toString()).toBe(
      '2398000',
    );
  });

  it('keeps LAK prices as whole kip without the 1,000 step', () => {
    expect(priceToLak('18500050', 'LAK', '1', 1000).toString()).toBe(
      '18500050',
    );
    expect(priceToLak('99.5', 'LAK', '1', 1000).toString()).toBe('100');
  });

  it('converts costs half-up to whole kip', () => {
    expect(costToLak('92.5', '21800.75').toString()).toBe('2016569');
  });
});
