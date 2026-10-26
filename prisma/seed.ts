// Seeds reference data for a fresh PLC POS database. Safe to re-run: existing rows
// (and anything an admin changed in the app) are left as they are.
//
//   npx prisma db seed                 # reference data + admin user
//   SEED_DEMO=true npx prisma db seed  # also demo brands' products
import 'dotenv/config';
import argon2 from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { SYSTEM_GROUPS } from '../src/common/permissions.js';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

type CategorySeed = { slug: string; name: string; children?: CategorySeed[] };

const CATEGORIES: CategorySeed[] = [
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

const BRANDS = [
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

const SETTINGS: Record<string, Prisma.InputJsonValue> = {
  'store.name': 'PLC POS',
  'store.companyName': '',
  'store.taxId': '',
  'store.phone': '',
  'store.address': '',
  'store.logoUrl': '',
  'receipt.defaultSize': '80mm',
  'receipt.footer': '',
  'repair.warrantyTerms': '',
  'tax.pricesIncludeVat': true,
  'pricing.lakRounding': 1000,
  'app.timezone': 'Asia/Vientiane',
};

/** LAK per unit; only used when no rate exists yet. */
const INITIAL_RATES = { THB: '650', USD: '21800' } as const;

type DemoProduct = {
  sku: string;
  barcode: string;
  name: string;
  brand: string;
  category: string;
  model?: string;
  priceCurrency?: 'LAK' | 'USD';
  retailPrice: number;
  wholesalePrice?: number;
  costPrice: number;
  stockQty: number;
  trackSerial: boolean;
  trackExpiry?: boolean;
  warrantyMonths: number;
  location: string;
  specs: Record<string, string>;
};

// Mirrors the frontend mock data (src/features/products/mock-data.ts) plus MSI/Samsung monitors priced in USD.
const DEMO_PRODUCTS: DemoProduct[] = [
  {
    sku: 'TRM-SUNMI-T2S',
    barcode: '8850001000011',
    name: 'Sunmi T2s POS Terminal 15.6"',
    brand: 'Sunmi',
    category: 'pos-dual-screen',
    model: 'T2s',
    retailPrice: 18_500_000,
    wholesalePrice: 17_500_000,
    costPrice: 15_200_000,
    stockQty: 6,
    trackSerial: true,
    warrantyMonths: 12,
    location: 'A1',
    specs: {
      CPU: 'Octa-core 2.0GHz',
      OS: 'Android 11',
      Display: '15.6" FHD touch + 10.1" customer display',
      Printer: '80mm built-in',
    },
  },
  {
    sku: 'TRM-IMIN-D4',
    barcode: '8850001000028',
    name: 'iMin D4 Android POS',
    brand: 'iMin',
    category: 'pos-single-screen',
    model: 'D4',
    retailPrice: 14_900_000,
    costPrice: 12_100_000,
    stockQty: 4,
    trackSerial: true,
    warrantyMonths: 12,
    location: 'A1',
    specs: {
      CPU: 'Quad-core 2.0GHz',
      OS: 'Android 11',
      Display: '15.6" FHD touch',
    },
  },
  {
    sku: 'TRM-SUNMI-V2P',
    barcode: '8850001000035',
    name: 'Sunmi V2 Pro Handheld',
    brand: 'Sunmi',
    category: 'pos-handheld',
    model: 'V2 Pro',
    retailPrice: 7_800_000,
    costPrice: 6_300_000,
    stockQty: 10,
    trackSerial: true,
    warrantyMonths: 12,
    location: 'A2',
    specs: {
      OS: 'Android 7.1',
      Display: '5.99" touch',
      Printer: '58mm built-in',
    },
  },
  {
    sku: 'PRN-EPSON-T82X',
    barcode: '8850001000042',
    name: 'Epson TM-T82X Receipt Printer',
    brand: 'Epson',
    category: 'printer-receipt',
    model: 'TM-T82X',
    retailPrice: 4_950_000,
    wholesalePrice: 4_600_000,
    costPrice: 3_800_000,
    stockQty: 8,
    trackSerial: true,
    warrantyMonths: 12,
    location: 'B1',
    specs: {
      Width: '80mm',
      Speed: '250 mm/s',
      Cutter: 'Auto cutter',
      Interface: 'USB + LAN',
    },
  },
  {
    sku: 'PRN-XP-58IIH',
    barcode: '8850001000059',
    name: 'Xprinter XP-58IIH 58mm',
    brand: 'Xprinter',
    category: 'printer-receipt',
    model: 'XP-58IIH',
    retailPrice: 850_000,
    wholesalePrice: 750_000,
    costPrice: 560_000,
    stockQty: 25,
    trackSerial: true,
    warrantyMonths: 6,
    location: 'B1',
    specs: { Width: '58mm', Speed: '90 mm/s', Interface: 'USB + Bluetooth' },
  },
  {
    sku: 'PRN-XP-365B',
    barcode: '8850001000066',
    name: 'Xprinter XP-365B Label Printer',
    brand: 'Xprinter',
    category: 'printer-label',
    model: 'XP-365B',
    retailPrice: 1_650_000,
    costPrice: 1_150_000,
    stockQty: 12,
    trackSerial: true,
    warrantyMonths: 6,
    location: 'B2',
    specs: { 'Label width': '20–80mm', Method: 'Direct thermal' },
  },
  {
    sku: 'DSP-VFD-220',
    barcode: '8850001000073',
    name: 'Customer Display VFD 2x20',
    brand: 'Generic',
    category: 'display-customer',
    retailPrice: 1_200_000,
    costPrice: 800_000,
    stockQty: 9,
    trackSerial: true,
    warrantyMonths: 6,
    location: 'C1',
    specs: { Type: 'VFD', Lines: '2 x 20 characters' },
  },
  {
    sku: 'DSP-TOUCH-156',
    barcode: '8850001000080',
    name: 'Touch Monitor 15.6" Capacitive',
    brand: 'Generic',
    category: 'display-touch',
    retailPrice: 5_500_000,
    costPrice: 4_100_000,
    stockQty: 3,
    trackSerial: true,
    warrantyMonths: 12,
    location: 'C1',
    specs: {
      Size: '15.6"',
      Resolution: '1920x1080',
      Touch: '10-point capacitive',
    },
  },
  {
    sku: 'DSP-MSI-PRO-MP243',
    barcode: '8850001000165',
    name: 'MSI PRO MP243X 23.8" Monitor',
    brand: 'MSI',
    category: 'display-monitor',
    model: 'PRO MP243X',
    priceCurrency: 'USD',
    retailPrice: 115,
    costPrice: 92,
    stockQty: 6,
    trackSerial: true,
    warrantyMonths: 36,
    location: 'C3',
    specs: {
      Size: '23.8"',
      Panel: 'IPS',
      Resolution: '1920x1080',
      Refresh: '100Hz',
    },
  },
  {
    sku: 'DSP-SAM-S24C310',
    barcode: '8850001000172',
    name: 'Samsung S24C310 24" Monitor',
    brand: 'Samsung',
    category: 'display-monitor',
    model: 'LS24C310EAEXXT',
    priceCurrency: 'USD',
    retailPrice: 109,
    costPrice: 88,
    stockQty: 5,
    trackSerial: true,
    warrantyMonths: 36,
    location: 'C3',
    specs: {
      Size: '24"',
      Panel: 'IPS',
      Resolution: '1920x1080',
      Refresh: '75Hz',
    },
  },
  {
    sku: 'SCN-HON-1250G',
    barcode: '8850001000097',
    name: 'Honeywell Voyager 1250g',
    brand: 'Honeywell',
    category: 'scanner-handheld',
    model: '1250g',
    retailPrice: 2_350_000,
    costPrice: 1_750_000,
    stockQty: 15,
    trackSerial: true,
    warrantyMonths: 12,
    location: 'C2',
    specs: { Type: '1D laser', Interface: 'USB' },
  },
  {
    sku: 'SCN-ZEB-DS2208',
    barcode: '8850001000103',
    name: 'Zebra DS2208 2D Scanner',
    brand: 'Zebra',
    category: 'scanner-handheld',
    model: 'DS2208',
    retailPrice: 3_100_000,
    costPrice: 2_400_000,
    stockQty: 0,
    trackSerial: true,
    warrantyMonths: 12,
    location: 'C2',
    specs: { Type: '1D/2D imager', Reads: 'QR, PDF417, barcodes on screens' },
  },
  {
    sku: 'ACC-DRAWER-405',
    barcode: '8850001000110',
    name: 'Cash Drawer 5 Bill / 8 Coin',
    brand: 'Generic',
    category: 'cash-drawer',
    retailPrice: 1_450_000,
    costPrice: 980_000,
    stockQty: 7,
    trackSerial: false,
    warrantyMonths: 3,
    location: 'D1',
    specs: {
      Compartments: '5 bill / 8 coin',
      Connection: 'RJ11 (opens from printer)',
    },
  },
  {
    sku: 'ACC-USB-HUB',
    barcode: '8850001000127',
    name: 'USB Hub 4 Port',
    brand: 'Generic',
    category: 'accessory',
    retailPrice: 180_000,
    costPrice: 95_000,
    stockQty: 40,
    trackSerial: false,
    warrantyMonths: 0,
    location: 'D2',
    specs: { Ports: '4 x USB 3.0' },
  },
  {
    sku: 'CON-PAPER-80',
    barcode: '8850001000134',
    name: 'Thermal Paper 80x80mm (x10)',
    brand: 'Generic',
    category: 'consumable',
    retailPrice: 120_000,
    wholesalePrice: 100_000,
    costPrice: 70_000,
    stockQty: 200,
    trackSerial: false,
    trackExpiry: true,
    warrantyMonths: 0,
    location: 'E1',
    specs: { Size: '80 x 80mm', Pack: '10 rolls' },
  },
  {
    sku: 'CON-PAPER-58',
    barcode: '8850001000141',
    name: 'Thermal Paper 57x40mm (x10)',
    brand: 'Generic',
    category: 'consumable',
    retailPrice: 75_000,
    wholesalePrice: 62_000,
    costPrice: 42_000,
    stockQty: 3,
    trackSerial: false,
    trackExpiry: true,
    warrantyMonths: 0,
    location: 'E1',
    specs: { Size: '57 x 40mm', Pack: '10 rolls' },
  },
  {
    sku: 'CON-LABEL-4030',
    barcode: '8850001000158',
    name: 'Label Sticker 40x30mm',
    brand: 'Generic',
    category: 'consumable',
    retailPrice: 95_000,
    costPrice: 55_000,
    stockQty: 60,
    trackSerial: false,
    warrantyMonths: 0,
    location: 'E2',
    specs: { Size: '40 x 30mm', Labels: '1000 per roll' },
  },
];

async function seedCategories(
  nodes: CategorySeed[],
  parentId: string | null = null,
) {
  for (const [index, node] of nodes.entries()) {
    const category = await prisma.category.upsert({
      where: { slug: node.slug },
      update: {},
      create: { slug: node.slug, name: node.name, parentId, sortOrder: index },
    });
    if (node.children) await seedCategories(node.children, category.id);
  }
}

async function seedReferenceData() {
  for (const [name, permissions] of Object.entries(SYSTEM_GROUPS)) {
    const group = await prisma.userGroup.upsert({
      where: { name },
      update: {},
      create: { name, permissions, isSystem: true },
    });
    // The migration creates the built-in groups without permissions; fill them once.
    if (group.permissions.length === 0) {
      await prisma.userGroup.update({
        where: { id: group.id },
        data: { permissions },
      });
    }
  }

  await prisma.register.upsert({
    where: { code: 'R1' },
    update: {},
    create: {
      code: 'R1',
      name: 'Counter 1',
      printer: { connection: 'usb', paperWidth: 80, openDrawer: true },
    },
  });

  if ((await prisma.taxRate.count()) === 0) {
    await prisma.taxRate.createMany({
      data: [
        { name: 'VAT 12%', percent: '12', isDefault: true },
        { name: 'No VAT', percent: '0', isDefault: false },
      ],
    });
  }

  for (const type of PAYMENT_TYPES) {
    await prisma.paymentType.upsert({
      where: { name: type.name },
      update: {},
      create: type,
    });
  }

  for (const name of EXPENSE_CATEGORIES) {
    await prisma.expenseCategory.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  for (const [key, value] of Object.entries(SETTINGS)) {
    await prisma.setting.upsert({
      where: { key },
      update: {},
      create: { key, value },
    });
  }

  for (const [currency, lakPerUnit] of Object.entries(INITIAL_RATES) as [
    keyof typeof INITIAL_RATES,
    string,
  ][]) {
    if ((await prisma.exchangeRate.count({ where: { currency } })) === 0) {
      await prisma.exchangeRate.create({ data: { currency, lakPerUnit } });
    }
  }

  await seedCategories(CATEGORIES);

  for (const name of BRANDS) {
    await prisma.brand.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
}

async function seedAdmin() {
  if (await prisma.user.findUnique({ where: { username: 'admin' } })) return;
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'admin1234';
  const admin = await prisma.userGroup.findUniqueOrThrow({
    where: { name: 'Admin' },
  });
  await prisma.user.create({
    data: {
      username: 'admin',
      fullName: 'Administrator',
      passwordHash: await argon2.hash(password),
      groupId: admin.id,
    },
  });
  if (!process.env.SEED_ADMIN_PASSWORD) {
    console.warn(
      'Created user "admin" with the default password "admin1234" — change it after first login.',
    );
  }
}

/** Demo products with opening stock posted through a RECEIVE stock document, like real stock-in. */
async function seedDemoProducts() {
  if ((await prisma.product.count()) > 0) {
    console.log('Products already exist; skipping demo products.');
    return;
  }
  const admin = await prisma.user.findUniqueOrThrow({
    where: { username: 'admin' },
  });
  const vat = await prisma.taxRate.findFirst({ where: { isDefault: true } });
  const usd = await prisma.exchangeRate.findFirstOrThrow({
    where: { currency: 'USD' },
    orderBy: { effectiveFrom: 'desc' },
  });
  const brands = new Map(
    (await prisma.brand.findMany()).map((b) => [b.name, b.id]),
  );
  const categories = new Map(
    (await prisma.category.findMany()).map((c) => [c.slug, c.id]),
  );

  await prisma.$transaction(async (tx) => {
    const doc = await tx.stockDocument.create({
      data: {
        docNo: 'GR-DEMO-0001',
        type: 'RECEIVE',
        status: 'POSTED',
        reference: 'Opening stock (demo)',
        createdById: admin.id,
        postedAt: new Date(),
      },
    });
    let totalLak = new Prisma.Decimal(0);

    for (const p of DEMO_PRODUCTS) {
      const currency = p.priceCurrency ?? 'LAK';
      const costLak =
        currency === 'USD'
          ? usd.lakPerUnit.mul(p.costPrice).toDecimalPlaces(0)
          : new Prisma.Decimal(p.costPrice);
      const product = await tx.product.create({
        data: {
          sku: p.sku,
          barcode: p.barcode,
          name: p.name,
          model: p.model,
          brandId: brands.get(p.brand),
          categoryId: categories.get(p.category),
          location: p.location,
          specs: p.specs,
          priceCurrency: currency,
          retailPrice: p.retailPrice,
          wholesalePrice: p.wholesalePrice,
          costCurrency: currency,
          costPrice: p.costPrice,
          avgCostLak: costLak,
          stockQty: p.stockQty,
          lowStockAlert: p.trackSerial ? 2 : 10,
          trackSerial: p.trackSerial,
          trackExpiry: p.trackExpiry ?? false,
          warrantyMonths: p.warrantyMonths,
          taxRateId: vat?.id,
        },
      });
      if (p.stockQty === 0) continue;

      const line = await tx.stockDocumentItem.create({
        data: {
          documentId: doc.id,
          productId: product.id,
          quantity: p.stockQty,
          unitCost: p.costPrice,
          unitCostLak: costLak,
          ...(p.trackExpiry && {
            lotNo: 'DEMO',
            expiryDate: new Date('2028-12-31'),
          }),
        },
      });
      totalLak = totalLak.add(costLak.mul(p.stockQty));

      const lot = p.trackExpiry
        ? await tx.stockLot.create({
            data: {
              productId: product.id,
              lotNo: 'DEMO',
              expiryDate: new Date('2028-12-31'),
              qty: p.stockQty,
            },
          })
        : null;

      if (p.trackSerial) {
        for (let i = 1; i <= p.stockQty; i++) {
          const serial = await tx.serialNumber.create({
            data: {
              serial: `${p.sku}-${String(i).padStart(4, '0')}`,
              productId: product.id,
              costLak,
              receivedItemId: line.id,
            },
          });
          await tx.stockMovement.create({
            data: {
              productId: product.id,
              type: 'RECEIVE_IN',
              quantity: 1,
              balanceAfter: i,
              unitCostLak: costLak,
              serialId: serial.id,
              refType: 'STOCK_DOC',
              refId: doc.id,
              userId: admin.id,
            },
          });
        }
      } else {
        await tx.stockMovement.create({
          data: {
            productId: product.id,
            type: 'RECEIVE_IN',
            quantity: p.stockQty,
            balanceAfter: p.stockQty,
            unitCostLak: costLak,
            lotId: lot?.id,
            refType: 'STOCK_DOC',
            refId: doc.id,
            userId: admin.id,
          },
        });
      }
    }

    await tx.stockDocument.update({
      where: { id: doc.id },
      data: { totalLak },
    });
  });
  console.log(`Seeded ${DEMO_PRODUCTS.length} demo products.`);
}

async function main() {
  await seedReferenceData();
  await seedAdmin();
  if (process.env.SEED_DEMO === 'true') await seedDemoProducts();
  console.log('Seed complete.');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
