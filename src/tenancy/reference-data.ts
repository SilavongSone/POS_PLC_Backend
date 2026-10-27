import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { SYSTEM_GROUPS } from '../common/permissions.js';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { SETTING_DEFAULTS } from '../settings/settings.schemas.js';

/**
 * Starter data every company gets: user groups, VAT rates, payment types, categories,
 * brands, expense categories, settings and exchange rates. Shared by `prisma db seed`
 * and tenant sign-up. Runs inside the new tenant's context (RequestContext) on the
 * tenant-scoped client; existing rows are never changed, so it is safe to re-run.
 */
type Db = PrismaClient | Prisma.TransactionClient;

type CategorySeed = { slug: string; name: string; children?: CategorySeed[] };

export const CATEGORIES: CategorySeed[] = [
  {
    slug: 'pos-terminal',
    name: 'POS Terminals',
    children: [
      { slug: 'pos-dual-screen', name: 'Dual-screen POS' },
      { slug: 'pos-single-screen', name: 'Single-screen / All-in-One POS' },
      { slug: 'pos-handheld', name: 'Handheld POS' },
    ],
  },
  {
    slug: 'printer',
    name: 'Printers',
    children: [
      { slug: 'printer-receipt', name: 'Receipt Printers (Thermal)' },
      { slug: 'printer-label', name: 'Label / Barcode Printers' },
      { slug: 'printer-office', name: 'Office Printers (Laser / Inkjet)' },
    ],
  },
  {
    slug: 'display',
    name: 'Displays',
    children: [
      { slug: 'display-monitor', name: 'Monitors' },
      { slug: 'display-touch', name: 'Touch Monitors' },
      { slug: 'display-customer', name: 'Customer Displays' },
    ],
  },
  {
    slug: 'scanner',
    name: 'Barcode Scanners',
    children: [
      { slug: 'scanner-handheld', name: 'Handheld Scanners' },
      { slug: 'scanner-desktop', name: 'Desktop Scanners' },
    ],
  },
  { slug: 'computer', name: 'Computers (Mini PC / Notebook)' },
  { slug: 'cash-drawer', name: 'Cash Drawers' },
  { slug: 'accessory', name: 'Accessories' },
  { slug: 'consumable', name: 'Consumables' },
  { slug: 'software', name: 'Software / Licences' },
  { slug: 'service', name: 'Services' },
];

export const BRANDS = [
  'Sunmi',
  'iMin',
  'Epson',
  'Xprinter',
  'Zebra',
  'Honeywell',
  'MSI',
  'Samsung',
  'LG',
  'Dell',
  'HP',
  'Canon',
  'Brother',
  'Generic',
];

const PAYMENT_TYPES = [
  {
    name: 'Cash',
    kind: 'CASH',
    requiresReference: false,
    isActive: true,
    sortOrder: 1,
  },
  {
    name: 'QR',
    kind: 'QR',
    requiresReference: true,
    isActive: true,
    sortOrder: 2,
  },
  {
    name: 'Bank transfer',
    kind: 'BANK_TRANSFER',
    requiresReference: true,
    isActive: true,
    sortOrder: 3,
  },
  {
    name: 'Card',
    kind: 'CARD',
    requiresReference: true,
    isActive: false,
    sortOrder: 4,
  },
  {
    name: 'Credit',
    kind: 'CREDIT',
    requiresReference: false,
    isActive: true,
    sortOrder: 5,
  },
] as const;

const EXPENSE_CATEGORIES = [
  'Rent',
  'Electricity & water',
  'Salaries',
  'Shipping',
  'Other',
];

/** Lao and Thai names of the starter rows (English is the row's own name). */
const CATEGORY_I18N: Record<string, { lo: string; th: string }> = {
  'pos-terminal': { lo: 'ເຄື່ອງ POS', th: 'เครื่อง POS' },
  'pos-dual-screen': { lo: 'POS ສອງໜ້າຈໍ', th: 'POS สองหน้าจอ' },
  'pos-single-screen': {
    lo: 'POS ໜ້າຈໍດຽວ / All-in-One',
    th: 'POS จอเดียว / All-in-One',
  },
  'pos-handheld': { lo: 'POS ມືຖື', th: 'POS แบบพกพา' },
  printer: { lo: 'ເຄື່ອງພິມ', th: 'เครื่องพิมพ์' },
  'printer-receipt': {
    lo: 'ເຄື່ອງພິມໃບບິນ (ຄວາມຮ້ອນ)',
    th: 'เครื่องพิมพ์ใบเสร็จ (ความร้อน)',
  },
  'printer-label': {
    lo: 'ເຄື່ອງພິມສະຕິກເກີ / ບາໂຄດ',
    th: 'เครื่องพิมพ์สติกเกอร์ / บาร์โค้ด',
  },
  'printer-office': {
    lo: 'ເຄື່ອງພິມຫ້ອງການ (ເລເຊີ / ອິງເຈັດ)',
    th: 'เครื่องพิมพ์สำนักงาน (เลเซอร์ / อิงค์เจ็ท)',
  },
  display: { lo: 'ໜ້າຈໍ', th: 'จอแสดงผล' },
  'display-monitor': { lo: 'ຈໍມໍນິເຕີ', th: 'จอมอนิเตอร์' },
  'display-touch': { lo: 'ຈໍສຳຜັດ', th: 'จอสัมผัส' },
  'display-customer': { lo: 'ຈໍສະແດງລາຄາລູກຄ້າ', th: 'จอแสดงราคาลูกค้า' },
  scanner: { lo: 'ເຄື່ອງສະແກນບາໂຄດ', th: 'เครื่องสแกนบาร์โค้ด' },
  'scanner-handheld': { lo: 'ເຄື່ອງສະແກນມືຖື', th: 'เครื่องสแกนมือถือ' },
  'scanner-desktop': { lo: 'ເຄື່ອງສະແກນຕັ້ງໂຕະ', th: 'เครื่องสแกนตั้งโต๊ะ' },
  computer: {
    lo: 'ຄອມພິວເຕີ (Mini PC / ໂນ໊ດບຸກ)',
    th: 'คอมพิวเตอร์ (Mini PC / โน้ตบุ๊ก)',
  },
  'cash-drawer': { lo: 'ລິ້ນຊັກເກັບເງິນ', th: 'ลิ้นชักเก็บเงิน' },
  accessory: { lo: 'ອຸປະກອນເສີມ', th: 'อุปกรณ์เสริม' },
  consumable: { lo: 'ວັດສະດຸສິ້ນເປືອງ', th: 'วัสดุสิ้นเปลือง' },
  software: { lo: 'ຊອບແວ / ລິຂະສິດ', th: 'ซอฟต์แวร์ / ไลเซนส์' },
  service: { lo: 'ບໍລິການ', th: 'บริการ' },
};

const PAYMENT_I18N: Record<string, { lo: string; th: string }> = {
  Cash: { lo: 'ເງິນສົດ', th: 'เงินสด' },
  QR: { lo: 'QR', th: 'QR' },
  'Bank transfer': { lo: 'ໂອນເງິນ', th: 'โอนเงิน' },
  Card: { lo: 'ບັດ', th: 'บัตร' },
  Credit: { lo: 'ຕິດໜີ້', th: 'เชื่อ' },
};

const EXPENSE_I18N: Record<string, { lo: string; th: string }> = {
  Rent: { lo: 'ຄ່າເຊົ່າ', th: 'ค่าเช่า' },
  'Electricity & water': { lo: 'ຄ່າໄຟ ແລະ ນ້ຳ', th: 'ค่าไฟและน้ำ' },
  Salaries: { lo: 'ເງິນເດືອນ', th: 'เงินเดือน' },
  Shipping: { lo: 'ຄ່າຂົນສົ່ງ', th: 'ค่าขนส่ง' },
  Other: { lo: 'ອື່ນໆ', th: 'อื่น ๆ' },
};

/** LAK per unit; only used when no rate exists yet. */
const INITIAL_RATES = { THB: '650', USD: '21800' } as const;

async function seedCategories(
  db: Db,
  nodes: CategorySeed[],
  parentId: string | null = null,
) {
  for (const [index, node] of nodes.entries()) {
    const category =
      (await db.category.findFirst({ where: { slug: node.slug } })) ??
      (await db.category.create({
        data: {
          slug: node.slug,
          name: node.name,
          nameI18n: CATEGORY_I18N[node.slug],
          parentId,
          sortOrder: index,
        },
      }));
    if (node.children) await seedCategories(db, node.children, category.id);
  }
}

export async function seedReferenceData(
  db: Db,
  options: { storeName?: string } = {},
) {
  for (const [name, permissions] of Object.entries(SYSTEM_GROUPS)) {
    const group = await db.userGroup.findFirst({ where: { name } });
    if (!group) {
      await db.userGroup.create({
        data: { name, permissions, isSystem: true },
      });
    } else if (group.permissions.length === 0) {
      // Groups created by an old migration had no permissions; fill them once.
      await db.userGroup.update({
        where: { id: group.id },
        data: { permissions },
      });
    }
  }

  if ((await db.taxRate.count()) === 0) {
    await db.taxRate.createMany({
      data: [
        { name: 'VAT 12%', percent: '12', isDefault: true },
        { name: 'No VAT', percent: '0', isDefault: false },
      ],
    });
  }

  for (const type of PAYMENT_TYPES) {
    if (!(await db.paymentType.findFirst({ where: { name: type.name } }))) {
      await db.paymentType.create({
        data: { ...type, nameI18n: PAYMENT_I18N[type.name] },
      });
    }
  }

  for (const name of EXPENSE_CATEGORIES) {
    if (!(await db.expenseCategory.findFirst({ where: { name } }))) {
      await db.expenseCategory.create({
        data: { name, nameI18n: EXPENSE_I18N[name] },
      });
    }
  }

  const settings: Record<string, Prisma.InputJsonValue> = {
    ...SETTING_DEFAULTS,
    ...(options.storeName && { 'store.name': options.storeName }),
  };
  const existing = new Set(
    (await db.setting.findMany({ select: { key: true } })).map((s) => s.key),
  );
  const missing = Object.entries(settings).filter(([k]) => !existing.has(k));
  if (missing.length) {
    await db.setting.createMany({
      data: missing.map(([key, value]) => ({ key, value })),
    });
  }

  for (const [currency, lakPerUnit] of Object.entries(INITIAL_RATES) as [
    keyof typeof INITIAL_RATES,
    string,
  ][]) {
    if ((await db.exchangeRate.count({ where: { currency } })) === 0) {
      await db.exchangeRate.create({ data: { currency, lakPerUnit } });
    }
  }

  await seedCategories(db, CATEGORIES);

  for (const name of BRANDS) {
    if (!(await db.brand.findFirst({ where: { name } }))) {
      await db.brand.create({ data: { name } });
    }
  }
}

/** The company's first branch and till, if it has none yet. */
export async function ensureFirstBranch(
  db: Db,
  input: { code?: string; name?: string } = {},
) {
  const branch =
    (await db.branch.findFirst({ orderBy: { createdAt: 'asc' } })) ??
    (await db.branch.create({
      data: { code: input.code ?? 'MAIN', name: input.name ?? 'Main' },
    }));
  if ((await db.register.count()) === 0) {
    await db.register.create({
      data: {
        code: 'R1',
        name: 'Counter 1',
        branchId: branch.id,
        printer: { connection: 'usb', paperWidth: 80, openDrawer: true },
      },
    });
  }
  return branch;
}

export type OwnerInput = {
  username: string;
  fullName: string;
  /** Plain password, or an already hashed one (verified sign-up). */
  password?: string;
  passwordHash?: string;
  email?: string | null;
  /** Set when the address was proven (sign-up code, Google). */
  emailVerified?: boolean;
  googleSub?: string;
};

/** Creates the company's first user in the Admin group. */
export async function createOwner(db: Db, input: OwnerInput) {
  const admin = await db.userGroup.findFirstOrThrow({
    where: { name: 'Admin' },
  });
  // Without a password (Google sign-up) a random one locks password login until reset.
  const passwordHash =
    input.passwordHash ??
    (await argon2.hash(input.password ?? randomBytes(32).toString('hex')));
  return db.user.create({
    data: {
      username: input.username,
      fullName: input.fullName,
      passwordHash,
      groupId: admin.id,
      email: input.email?.toLowerCase() ?? null,
      emailVerifiedAt: input.email && input.emailVerified ? new Date() : null,
      googleSub: input.googleSub,
    },
  });
}
