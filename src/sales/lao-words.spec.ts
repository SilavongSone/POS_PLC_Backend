import { lakToLaoWords, numberToLaoWords } from './lao-words.js';

describe('numberToLaoWords', () => {
  it.each([
    [0, 'ສູນ'],
    [1, 'ໜຶ່ງ'],
    [10, 'ສິບ'],
    [11, 'ສິບເອັດ'],
    [20, 'ຊາວ'],
    [21, 'ຊາວເອັດ'],
    [35, 'ສາມສິບຫ້າ'],
    [101, 'ໜຶ່ງຮ້ອຍເອັດ'],
    [1_000, 'ໜຶ່ງພັນ'],
    [250_000, 'ສອງແສນຫ້າໝື່ນ'],
    [1_250_021, 'ໜຶ່ງລ້ານສອງແສນຫ້າໝື່ນຊາວເອັດ'],
    [18_500_000, 'ສິບແປດລ້ານຫ້າແສນ'],
    [2_000_000_000_000, 'ສອງລ້ານລ້ານ'],
  ])('%i → %s', (n, words) => {
    expect(numberToLaoWords(n)).toBe(words);
  });

  it('adds the currency for invoices', () => {
    expect(lakToLaoWords('2000000')).toBe('ສອງລ້ານກີບຖ້ວນ');
  });
});
