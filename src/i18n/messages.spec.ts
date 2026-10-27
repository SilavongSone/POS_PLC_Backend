import { en } from './messages/en.js';
import { lo } from './messages/lo.js';
import { th } from './messages/th.js';

describe('message catalogs', () => {
  it('have the same keys in every language', () => {
    const keys = Object.keys(en).sort();
    expect(Object.keys(lo).sort()).toEqual(keys);
    expect(Object.keys(th).sort()).toEqual(keys);
  });
});
