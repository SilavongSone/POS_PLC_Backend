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
        data: { slug: node.slug, name: node.name, parentId, sortOrder: index },
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
      await db.paymentType.create({ data: type });
    }
  }

  for (const name of EXPENSE_CATEGORIES) {
    if (!(await db.expenseCategory.findFirst({ where: { name } }))) {
      await db.expenseCategory.create({ data: { name } });
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

/** Creates the company's first user in the Admin group. */
export async function createOwner(
  db: Db,
  input: { username: string; fullName: string; password: string },
) {
  const admin = await db.userGroup.findFirstOrThrow({
    where: { name: 'Admin' },
  });
  return db.user.create({
    data: {
      username: input.username,
      fullName: input.fullName,
      passwordHash: await argon2.hash(input.password),
      groupId: admin.id,
    },
  });
}
