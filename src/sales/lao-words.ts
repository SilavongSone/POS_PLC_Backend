const DIGITS = [
  'ສູນ',
  'ໜຶ່ງ',
  'ສອງ',
  'ສາມ',
  'ສີ່',
  'ຫ້າ',
  'ຫົກ',
  'ເຈັດ',
  'ແປດ',
  'ເກົ້າ',
];
const PLACES = ['', 'ສິບ', 'ຮ້ອຍ', 'ພັນ', 'ໝື່ນ', 'ແສນ'];

/** 1 … 999,999 in Lao words (same rules as Thai: ສິບ, ຊາວ, ເອັດ). */
function belowMillion(n: number): string {
  const digits = String(n).split('').map(Number);
  const len = digits.length;
  let out = '';
  digits.forEach((d, i) => {
    const place = len - 1 - i;
    if (d === 0) return;
    if (place === 1) {
      out +=
        (d === 1 ? '' : d === 2 ? 'ຊາວ' : DIGITS[d]) + (d === 2 ? '' : 'ສິບ');
    } else if (place === 0 && d === 1 && n > 9) {
      out += 'ເອັດ';
    } else {
      out += DIGITS[d] + PLACES[place];
    }
  });
  return out;
}

/** Whole numbers in Lao words, e.g. 1,250,021 → "ໜຶ່ງລ້ານສອງແສນຫ້າໝື່ນຊາວເອັດ". */
export function numberToLaoWords(value: number | bigint): string {
  let n = BigInt(value);
  if (n < 0n) return 'ລົບ' + numberToLaoWords(-n);
  if (n === 0n) return DIGITS[0];
  const groups: number[] = [];
  while (n > 0n) {
    groups.unshift(Number(n % 1_000_000n));
    n /= 1_000_000n;
  }
  return groups
    .map((g, i) => {
      const millions = groups.length - 1 - i;
      if (g === 0) return '';
      return belowMillion(g) + 'ລ້ານ'.repeat(millions);
    })
    .join('');
}

/** LAK amount for invoices, e.g. "ສອງລ້ານກີບຖ້ວນ". */
export function lakToLaoWords(amount: number | bigint | string): string {
  return `${numberToLaoWords(BigInt(String(amount).split('.')[0]))}ກີບຖ້ວນ`;
}
