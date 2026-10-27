import {
  lakToLaoWords,
  lakToWords,
  numberToEnglishWords,
  numberToLaoWords,
  numberToThaiWords,
} from './amount-words.js';

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

describe('numberToThaiWords', () => {
  it.each([
    [0, 'ศูนย์'],
    [11, 'สิบเอ็ด'],
    [21, 'ยี่สิบเอ็ด'],
    [101, 'หนึ่งร้อยเอ็ด'],
    [1_250_021, 'หนึ่งล้านสองแสนห้าหมื่นยี่สิบเอ็ด'],
    [2_000_000_000_000, 'สองล้านล้าน'],
  ])('%i → %s', (n, words) => {
    expect(numberToThaiWords(n)).toBe(words);
  });
});

describe('numberToEnglishWords', () => {
  it.each([
    [0, 'zero'],
    [15, 'fifteen'],
    [21, 'twenty-one'],
    [101, 'one hundred one'],
    [1_250_021, 'one million two hundred fifty thousand twenty-one'],
    [18_500_000, 'eighteen million five hundred thousand'],
  ])('%i → %s', (n, words) => {
    expect(numberToEnglishWords(n)).toBe(words);
  });
});

describe('lakToWords', () => {
  it('writes the amount in the requested language', () => {
    expect(lakToWords('2000000', 'lo')).toBe('ສອງລ້ານກີບຖ້ວນ');
    expect(lakToWords('2000000', 'th')).toBe('สองล้านกีบถ้วน');
    expect(lakToWords('2000000.00', 'en')).toBe('Two million kip only');
  });
});
