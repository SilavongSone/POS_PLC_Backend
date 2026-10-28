import { currentLang, type Lang } from './i18n.js';

type Tai = {
  digits: string[];
  places: string[];
  twenty: string;
  oneUnit: string;
  million: string;
  minus: string;
};

/** Lao and Thai count the same way (ສິບ/สิบ, ຊາວ/ยี่สิบ, ເອັດ/เอ็ด), with different words. */
const LAO: Tai = {
  digits: [
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
  ],
  places: ['', 'ສິບ', 'ຮ້ອຍ', 'ພັນ', 'ໝື່ນ', 'ແສນ'],
  twenty: 'ຊາວ',
  oneUnit: 'ເອັດ',
  million: 'ລ້ານ',
  minus: 'ລົບ',
};
const THAI: Tai = {
  digits: [
    'ศูนย์',
    'หนึ่ง',
    'สอง',
    'สาม',
    'สี่',
    'ห้า',
    'หก',
    'เจ็ด',
    'แปด',
    'เก้า',
  ],
  places: ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'],
  twenty: 'ยี่สิบ',
  oneUnit: 'เอ็ด',
  million: 'ล้าน',
  minus: 'ลบ',
};

/** 1 … 999,999. */
function belowMillion(n: number, w: Tai): string {
  const digits = String(n).split('').map(Number);
  const len = digits.length;
  let out = '';
  digits.forEach((d, i) => {
    const place = len - 1 - i;
    if (d === 0) return;
    if (place === 1) {
      out +=
        d === 1 ? w.places[1] : d === 2 ? w.twenty : w.digits[d] + w.places[1];
    } else if (place === 0 && d === 1 && n > 9) {
      out += w.oneUnit;
    } else {
      out += w.digits[d] + w.places[place];
    }
  });
  return out;
}

function taiWords(value: number | bigint, w: Tai): string {
  let n = BigInt(value);
  if (n < 0n) return w.minus + taiWords(-n, w);
  if (n === 0n) return w.digits[0];
  const groups: number[] = [];
  while (n > 0n) {
    groups.unshift(Number(n % 1_000_000n));
    n /= 1_000_000n;
  }
  return groups
    .map((g, i) =>
      g === 0
        ? ''
        : belowMillion(g, w) + w.million.repeat(groups.length - 1 - i),
    )
    .join('');
}

/** Whole numbers in Lao words, e.g. 1,250,021 → "ໜຶ່ງລ້ານສອງແສນຫ້າໝື່ນຊາວເອັດ". */
export const numberToLaoWords = (v: number | bigint) => taiWords(v, LAO);
/** Whole numbers in Thai words, e.g. 21 → "ยี่สิบเอ็ด". */
export const numberToThaiWords = (v: number | bigint) => taiWords(v, THAI);

const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const TENS = [
  '',
  '',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
];
const SCALES = [
  '',
  'thousand',
  'million',
  'billion',
  'trillion',
  'quadrillion',
];

function belowThousand(n: number): string {
  const parts: string[] = [];
  if (n >= 100) parts.push(`${ONES[Math.floor(n / 100)]} hundred`);
  const r = n % 100;
  if (r >= 20)
    parts.push(TENS[Math.floor(r / 10)] + (r % 10 ? `-${ONES[r % 10]}` : ''));
  else if (r > 0) parts.push(ONES[r]);
  return parts.join(' ');
}

/** Whole numbers in English words, e.g. 1,250,021 → "one million two hundred fifty thousand twenty-one". */
export function numberToEnglishWords(value: number | bigint): string {
  let n = BigInt(value);
  if (n < 0n) return `minus ${numberToEnglishWords(-n)}`;
  if (n === 0n) return ONES[0];
  const parts: string[] = [];
  let scale = 0;
  while (n > 0n) {
    const g = Number(n % 1000n);
    if (g)
      parts.unshift(
        [belowThousand(g), SCALES[scale]].filter(Boolean).join(' '),
      );
    n /= 1000n;
    scale++;
  }
  return parts.join(' ');
}

const whole = (amount: number | bigint | string) =>
  BigInt(String(amount).split('.')[0]);

/** LAK amount in words for receipts and invoices, in the given language. */
export function lakToWords(
  amount: number | bigint | string,
  lang: Lang = currentLang(),
): string {
  const n = whole(amount);
  switch (lang) {
    case 'th':
      return `${numberToThaiWords(n)}กีบถ้วน`;
    case 'en': {
      const words = numberToEnglishWords(n);
      return `${words[0].toUpperCase()}${words.slice(1)} kip only`;
    }
    default:
      return `${numberToLaoWords(n)}ກີບຖ້ວນ`;
  }
}

/** "ສອງລ້ານກີບຖ້ວນ" — kept for callers that always print Lao. */
export const lakToLaoWords = (amount: number | bigint | string) =>
  lakToWords(amount, 'lo');

/** The amount in all three languages (bilingual invoices). */
export const lakToWordsAll = (amount: number | bigint | string) => ({
  lo: lakToWords(amount, 'lo'),
  th: lakToWords(amount, 'th'),
  en: lakToWords(amount, 'en'),
});
