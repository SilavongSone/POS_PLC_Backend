import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../common/audit.service.js';
import { pageArgs, toPage, type Page } from '../common/pagination.js';
import type { Env } from '../config/env.js';
import { Prisma, type Currency } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  ExchangeRatesService,
  type CurrentRates,
} from '../settings/exchange-rates.service.js';
import { SettingsService } from '../settings/settings.service.js';
import type {
  BulkPriceInput,
  BundleItemsInput,
  CreateProductInput,
  ListProductsQuery,
  SetPricesInput,
  UpdateProductInput,
} from './catalog.schemas.js';
import { CategoriesService } from './categories.service.js';
import { costToLak, priceToLak, roundUpLak } from './pricing.js';
import { EntitlementsService } from '../tenancy/entitlements.service.js';
import { RequestContext } from '../common/request-context.js';

type BranchPriceRow = {
  retailPrice: Prisma.Decimal;
  wholesalePrice: Prisma.Decimal | null;
};

/** The product with its price at a branch; `branchPrice` tells whether one applied. */
export function atBranch<
  T extends {
    retailPrice: Prisma.Decimal;
    wholesalePrice: Prisma.Decimal | null;
  },
>(p: T, bp: BranchPriceRow | undefined): T & { branchPrice: boolean } {
  if (!bp) return { ...p, branchPrice: false };
  return {
    ...p,
    retailPrice: bp.retailPrice,
    wholesalePrice: bp.wholesalePrice ?? p.wholesalePrice,
    branchPrice: true,
  };
}

const listInclude = {
  category: { select: { id: true, name: true, slug: true } },
  brand: { select: { id: true, name: true } },
  images: { orderBy: { sortOrder: 'asc' }, take: 1 },
} satisfies Prisma.ProductInclude;

const detailInclude = {
  category: { select: { id: true, name: true, slug: true, parentId: true } },
  brand: { select: { id: true, name: true, logoUrl: true } },
  taxRate: { select: { id: true, name: true, percent: true } },
  images: { orderBy: { sortOrder: 'asc' } },
  bundleItems: {
    include: {
      component: {
        select: { id: true, sku: true, name: true, stockQty: true },
      },
    },
  },
} satisfies Prisma.ProductInclude;

type ProductRow = Prisma.ProductGetPayload<{ include: typeof listInclude }>;

const COST_FIELDS = ['costPrice', 'costCurrency', 'avgCostLak'] as const;

export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Magic bytes of the allowed image formats. */
function hasImageSignature(buf: Buffer, ext: string): boolean {
  if (ext === 'jpg')
    return buf.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  if (ext === 'png')
    return buf.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  if (ext === 'webp') {
    return (
      buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buf.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  return false;
}

export type PricingContext = { rates: CurrentRates; lakRounding: number };

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly categories: CategoriesService,
    private readonly rates: ExchangeRatesService,
    private readonly settings: SettingsService,
    private readonly config: ConfigService<Env, true>,
    private readonly entitlements: EntitlementsService,
  ) {}

  async pricingContext(tx?: Prisma.TransactionClient): Promise<PricingContext> {
    const [rates, lakRounding] = await Promise.all([
      this.rates.current(tx),
      this.settings.get('pricing.lakRounding', tx),
    ]);
    return { rates, lakRounding };
  }

  /** Current selling prices in LAK for a product row. */
  /** Prices set for these products at one branch (empty without a branch). */
  async branchPriceMap(
    productIds: string[],
    branchId: string | undefined,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    if (!branchId || !productIds.length)
      return new Map<string, BranchPriceRow>();
    const rows = await db.branchPrice.findMany({
      where: { branchId, productId: { in: productIds } },
      select: { productId: true, retailPrice: true, wholesalePrice: true },
    });
    return new Map(rows.map((r) => [r.productId, r]));
  }

  lakPrices(
    p: {
      priceCurrency: Currency;
      retailPrice: Prisma.Decimal;
      wholesalePrice: Prisma.Decimal | null;
    },
    ctx: PricingContext,
  ) {
    const rate = ctx.rates[p.priceCurrency].lakPerUnit;
    return {
      retailPriceLak: priceToLak(
        p.retailPrice,
        p.priceCurrency,
        rate,
        ctx.lakRounding,
      ),
      wholesalePriceLak:
        p.wholesalePrice === null
          ? null
          : priceToLak(
              p.wholesalePrice,
              p.priceCurrency,
              rate,
              ctx.lakRounding,
            ),
    };
  }

  /** Adds LAK prices and hides cost fields from users without product.viewCost. */
  private present<
    T extends
      ProductRow | Prisma.ProductGetPayload<{ include: typeof detailInclude }>,
  >(row: T, ctx: PricingContext, canViewCost: boolean) {
    const view: Record<string, unknown> = {
      ...row,
      ...this.lakPrices(row, ctx),
    };
    if (!canViewCost) for (const f of COST_FIELDS) delete view[f];
    return view as unknown as T & ReturnType<ProductsService['lakPrices']>;
  }

  async list(
    query: ListProductsQuery,
    canViewCost: boolean,
  ): Promise<Page<unknown>> {
    const where: Prisma.ProductWhereInput = {
      brandId: query.brandId,
      type: query.type,
      isActive: query.isActive,
      ...(query.categoryId && {
        categoryId: {
          in: await this.categories.withDescendants(query.categoryId),
        },
      }),
      ...(query.lowStock && {
        trackStock: true,
        type: 'STANDARD',
        stockQty: { lte: this.prisma.product.fields.lowStockAlert },
      }),
      ...(query.inStock !== undefined && {
        stockQty: query.inStock ? { gt: 0 } : { lte: 0 },
      }),
      ...(query.q && {
        OR: [
          { name: { contains: query.q, mode: 'insensitive' } },
          { sku: { contains: query.q, mode: 'insensitive' } },
          { barcode: { contains: query.q } },
          { model: { contains: query.q, mode: 'insensitive' } },
        ],
      }),
    };
    const [rows, total, ctx] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: listInclude,
        orderBy: { [query.sort]: query.sort === 'updatedAt' ? 'desc' : 'asc' },
        ...pageArgs(query),
      }),
      this.prisma.product.count({ where }),
      this.pricingContext(),
    ]);
    const prices = await this.branchPriceMap(
      rows.map((r) => r.id),
      query.branchId,
    );
    return toPage(
      rows.map((r) =>
        this.present(atBranch(r, prices.get(r.id)), ctx, canViewCost),
      ),
      total,
      query,
    );
  }

  async setBranchPrices(
    id: string,
    input: {
      items: {
        branchId: string;
        retailPrice: number;
        wholesalePrice?: number | null;
      }[];
    },
    actorId: string,
    canViewCost: boolean,
  ) {
    await this.prisma.product.findUniqueOrThrow({ where: { id } });
    const branchIds = input.items.map((i) => i.branchId);
    const known = await this.prisma.branch.count({
      where: { id: { in: branchIds } },
    });
    if (known !== branchIds.length)
      throw new BadRequestException('Unknown branch');
    const before = await this.prisma.branchPrice.findMany({
      where: { productId: id },
    });
    await this.prisma.$transaction([
      this.prisma.branchPrice.deleteMany({ where: { productId: id } }),
      this.prisma.branchPrice.createMany({
        data: input.items.map((i) => ({
          productId: id,
          branchId: i.branchId,
          retailPrice: i.retailPrice,
          wholesalePrice: i.wholesalePrice ?? null,
        })),
      }),
    ]);
    await this.audit.log({
      userId: actorId,
      action: 'PRODUCT_BRANCH_PRICES',
      entity: 'Product',
      entityId: id,
      before,
      after: input.items,
    });
    return this.get(id, canViewCost);
  }

  /** A product; with `branchId`, priced as at that branch. */
  async get(id: string, canViewCost: boolean, branchId?: string) {
    const [row, ctx, serialCounts] = await Promise.all([
      this.prisma.product.findUniqueOrThrow({
        where: { id },
        include: detailInclude,
      }),
      this.pricingContext(),
      this.prisma.serialNumber.groupBy({
        by: ['condition'],
        where: { productId: id, status: 'IN_STOCK' },
        _count: true,
      }),
    ]);
    const [demoUnits, branchStock, branchPrices, prices] = await Promise.all([
      this.prisma.serialNumber.findMany({
        where: { productId: id, status: 'IN_STOCK', condition: 'DEMO' },
        select: { id: true, serial: true, priceLak: true, branchId: true },
      }),
      this.prisma.branchStock.findMany({
        where: { productId: id },
        select: {
          qty: true,
          branch: { select: { id: true, code: true, name: true } },
        },
        orderBy: { branch: { code: 'asc' } },
      }),
      this.prisma.branchPrice.findMany({
        where: { productId: id },
        select: {
          retailPrice: true,
          wholesalePrice: true,
          branch: { select: { id: true, code: true, name: true } },
        },
        orderBy: { branch: { code: 'asc' } },
      }),
      this.branchPriceMap([id], branchId),
    ]);
    return {
      ...this.present(atBranch(row, prices.get(id)), ctx, canViewCost),
      /** Prices that differ by branch (in the product's price currency). */
      branchPrices: branchPrices.map(({ branch, ...p }) => ({
        branchId: branch.id,
        code: branch.code,
        name: branch.name,
        ...p,
      })),
      /** On hand per branch; stockQty is the total. */
      branchStock: branchStock.map((b) => ({ ...b.branch, qty: b.qty })),
      serialsInStock: Object.fromEntries(
        serialCounts.map((c) => [c.condition, c._count]),
      ),
      demoUnits,
    };
  }

  /**
   * Scanner lookup for the till: exact barcode, SKU, or a serial number.
   * A serial hit also returns the unit (status, new/demo, own price).
   */
  async lookup(code: string, canViewCost: boolean, branchId?: string) {
    const product = await this.prisma.product.findFirst({
      where: { OR: [{ barcode: code }, { sku: code.toUpperCase() }] },
      select: { id: true },
    });
    if (product)
      return {
        product: await this.get(product.id, canViewCost, branchId),
        serial: null,
      };

    const serial = await this.prisma.serialNumber.findFirst({
      where: { serial: code },
      select: {
        id: true,
        serial: true,
        status: true,
        condition: true,
        priceLak: true,
        productId: true,
        soldAt: true,
        warrantyEndsAt: true,
      },
    });
    if (!serial)
      throw new NotFoundException(`No product or serial matches "${code}"`);
    return {
      product: await this.get(serial.productId, canViewCost, branchId),
      serial,
    };
  }

  async create(
    input: CreateProductInput,
    actorId: string,
    canViewCost: boolean,
  ) {
    await this.assertReferences(input);
    await this.assertPlanAllows(input);
    if (input.isActive !== false)
      await this.entitlements.assertLimit('maxProducts');
    const ctx = await this.pricingContext();
    const product = await this.prisma.product.create({
      data: {
        ...input,
        specs: input.specs ?? undefined,
        avgCostLak: costToLak(
          input.costPrice,
          ctx.rates[input.costCurrency].lakPerUnit,
        ),
      },
    });
    await this.audit.log({
      userId: actorId,
      action: 'PRODUCT_CREATE',
      entity: 'Product',
      entityId: product.id,
      after: product,
    });
    return this.get(product.id, canViewCost);
  }

  async update(
    id: string,
    input: UpdateProductInput,
    actorId: string,
    canViewCost: boolean,
  ) {
    const before = await this.prisma.product.findUniqueOrThrow({
      where: { id },
    });
    await this.assertReferences(input);
    await this.assertPlanAllows(input);

    const hasStock = before.stockQty !== 0;
    if (
      hasStock &&
      input.trackSerial !== undefined &&
      input.trackSerial !== before.trackSerial
    ) {
      throw new ConflictException(
        'Serial tracking can only change while stock is 0',
      );
    }
    if (
      hasStock &&
      input.trackExpiry !== undefined &&
      input.trackExpiry !== before.trackExpiry
    ) {
      throw new ConflictException(
        'Expiry tracking can only change while stock is 0',
      );
    }
    if (hasStock && input.type && input.type !== 'STANDARD') {
      throw new ConflictException(
        'Only products without stock can become a bundle or service',
      );
    }
    const type = input.type ?? before.type;
    if (type === 'SERVICE' && (input.trackSerial ?? before.trackSerial)) {
      throw new BadRequestException('Services have no serials');
    }

    const data: Prisma.ProductUncheckedUpdateInput = {
      ...input,
      specs: input.specs === null ? Prisma.DbNull : input.specs,
    };
    // While there is no stock, the entered cost is also the average cost.
    if (!hasStock && (input.costPrice !== undefined || input.costCurrency)) {
      const ctx = await this.pricingContext();
      data.avgCostLak = costToLak(
        input.costPrice ?? before.costPrice,
        ctx.rates[input.costCurrency ?? before.costCurrency].lakPerUnit,
      );
    }
    const product = await this.prisma.product.update({ where: { id }, data });

    const priceChanged =
      !before.retailPrice.equals(product.retailPrice) ||
      String(before.wholesalePrice) !== String(product.wholesalePrice) ||
      before.priceCurrency !== product.priceCurrency;
    await this.audit.log({
      userId: actorId,
      action: priceChanged ? 'PRODUCT_PRICE_CHANGE' : 'PRODUCT_UPDATE',
      entity: 'Product',
      entityId: id,
      before,
      after: product,
    });
    return this.get(id, canViewCost);
  }

  /** Raises/lowers prices by a percentage, rounded to the product's currency. */
  async bulkPrice(input: BulkPriceInput, actorId: string) {
    const where: Prisma.ProductWhereInput = {
      id: input.productIds ? { in: input.productIds } : undefined,
      brandId: input.brandId,
      ...(input.categoryId && {
        categoryId: {
          in: await this.categories.withDescendants(input.categoryId),
        },
      }),
    };
    const lakRounding = await this.settings.get('pricing.lakRounding');
    const factor = new Prisma.Decimal(100 + input.percent).div(100);
    const adjust = (price: Prisma.Decimal, currency: Currency) =>
      currency === 'LAK'
        ? roundUpLak(price.mul(factor), lakRounding)
        : price.mul(factor).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

    const products = await this.prisma.product.findMany({ where });
    const changes = products.map((p) => ({
      id: p.id,
      sku: p.sku,
      before: { retailPrice: p.retailPrice, wholesalePrice: p.wholesalePrice },
      after: {
        retailPrice:
          input.field === 'wholesale'
            ? p.retailPrice
            : adjust(p.retailPrice, p.priceCurrency),
        wholesalePrice:
          input.field === 'retail' || p.wholesalePrice === null
            ? p.wholesalePrice
            : adjust(p.wholesalePrice, p.priceCurrency),
      },
    }));
    await this.prisma.$transaction(
      changes.map((c) =>
        this.prisma.product.update({ where: { id: c.id }, data: c.after }),
      ),
    );
    await this.audit.log({
      userId: actorId,
      action: 'PRODUCT_PRICE_BULK_UPDATE',
      entity: 'Product',
      after: { input, changes },
    });
    return { updated: changes.length, changes };
  }

  /** Sets explicit prices for many products at once. */
  async setPrices(input: SetPricesInput, actorId: string) {
    const ids = input.items.map((i) => i.productId);
    const existing = await this.prisma.product.findMany({
      where: { id: { in: ids } },
    });
    if (existing.length !== new Set(ids).size) {
      throw new NotFoundException('Some products do not exist');
    }
    await this.prisma.$transaction(
      input.items.map((i) =>
        this.prisma.product.update({
          where: { id: i.productId },
          data: {
            retailPrice: i.retailPrice,
            wholesalePrice: i.wholesalePrice,
          },
        }),
      ),
    );
    await this.audit.log({
      userId: actorId,
      action: 'PRODUCT_PRICE_BULK_UPDATE',
      entity: 'Product',
      before: existing.map((p) => ({
        id: p.id,
        retailPrice: p.retailPrice,
        wholesalePrice: p.wholesalePrice,
      })),
      after: input.items,
    });
    return { updated: input.items.length };
  }

  /** Sets what a BUNDLE product is made of (replaces the previous list). */
  async setBundleItems(
    id: string,
    input: BundleItemsInput,
    actorId: string,
    canViewCost: boolean,
  ) {
    const bundle = await this.prisma.product.findUniqueOrThrow({
      where: { id },
    });
    if (bundle.type !== 'BUNDLE')
      throw new BadRequestException('Only BUNDLE products have components');
    const ids = input.items.map((i) => i.componentId);
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException('A component is listed twice');
    if (ids.includes(id))
      throw new BadRequestException('A bundle cannot contain itself');
    const components = await this.prisma.product.findMany({
      where: { id: { in: ids } },
    });
    if (components.length !== ids.length)
      throw new BadRequestException('Unknown component');
    if (components.some((c) => c.type === 'BUNDLE')) {
      throw new BadRequestException('Bundles cannot contain other bundles');
    }
    await this.prisma.$transaction([
      this.prisma.productBundleItem.deleteMany({ where: { bundleId: id } }),
      this.prisma.productBundleItem.createMany({
        data: input.items.map((i) => ({
          bundleId: id,
          componentId: i.componentId,
          quantity: i.quantity,
        })),
      }),
    ]);
    await this.audit.log({
      userId: actorId,
      action: 'BUNDLE_ITEMS_SET',
      entity: 'Product',
      entityId: id,
      after: input.items,
    });
    return this.get(id, canViewCost);
  }

  // ── Images ──

  private uploadRoot() {
    return path.resolve(this.config.get('UPLOAD_DIR', { infer: true }));
  }

  async addImage(
    productId: string,
    file: { buffer: Buffer; mimetype: string; size: number },
  ) {
    const ext = ALLOWED_IMAGE_TYPES[file.mimetype];
    // Check the file's own signature too: the declared type comes from the client.
    if (!ext || !hasImageSignature(file.buffer, ext)) {
      throw new BadRequestException('Only JPEG, PNG or WebP images');
    }
    if (file.size > MAX_IMAGE_BYTES)
      throw new BadRequestException('Image must be 5 MB or less');
    await this.prisma.product.findUniqueOrThrow({ where: { id: productId } });

    const name = `${randomUUID()}.${ext}`;
    // One folder per company, so a company's files can be exported or removed together.
    const folder = `products/${RequestContext.tenantId()}`;
    const dir = path.join(this.uploadRoot(), folder);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, name), file.buffer);

    const last = await this.prisma.productImage.findFirst({
      where: { productId },
      orderBy: { sortOrder: 'desc' },
    });
    return this.prisma.productImage.create({
      data: {
        productId,
        url: `/api/uploads/${folder}/${name}`,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });
  }

  async removeImage(productId: string, imageId: string) {
    // Images are not tenant-scoped rows: reach them only through an own product.
    await this.prisma.product.findUniqueOrThrow({ where: { id: productId } });
    const image = await this.prisma.productImage.findFirst({
      where: { id: imageId, productId },
    });
    if (!image) throw new NotFoundException('Image not found');
    await this.prisma.productImage.delete({ where: { id: imageId } });
    const prefix = '/api/uploads/';
    if (image.url.startsWith(prefix)) {
      const file = path.join(this.uploadRoot(), image.url.slice(prefix.length));
      // Only delete files inside the upload directory.
      if (file.startsWith(this.uploadRoot() + path.sep))
        await unlink(file).catch(() => undefined);
    }
  }

  /** Sets image order; the first image is the product's main picture. */
  async reorderImages(productId: string, imageIds: string[]) {
    await this.prisma.product.findUniqueOrThrow({ where: { id: productId } });
    const images = await this.prisma.productImage.findMany({
      where: { productId },
    });
    const known = new Set(images.map((i) => i.id));
    if (
      imageIds.length !== known.size ||
      imageIds.some((id) => !known.has(id))
    ) {
      throw new BadRequestException(
        'Send every image id of this product exactly once',
      );
    }
    await this.prisma.$transaction(
      imageIds.map((id, sortOrder) =>
        this.prisma.productImage.update({ where: { id }, data: { sortOrder } }),
      ),
    );
    return this.prisma.productImage.findMany({
      where: { productId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  /** Bundles, expiry lots and foreign-currency prices need those plan features. */
  private async assertPlanAllows(input: {
    type?: string;
    trackExpiry?: boolean;
    priceCurrency?: string;
    costCurrency?: string;
  }) {
    if (input.type === 'BUNDLE')
      await this.entitlements.assertFeature('bundles');
    if (input.trackExpiry) await this.entitlements.assertFeature('lots');
    if (
      (input.priceCurrency && input.priceCurrency !== 'LAK') ||
      (input.costCurrency && input.costCurrency !== 'LAK')
    ) {
      await this.entitlements.assertFeature('multiCurrency');
    }
  }

  private async assertReferences(input: {
    categoryId?: string | null;
    brandId?: string | null;
    taxRateId?: string | null;
  }) {
    const missing: string[] = [];
    if (
      input.categoryId &&
      !(await this.prisma.category.findUnique({
        where: { id: input.categoryId },
      }))
    )
      missing.push('categoryId');
    if (
      input.brandId &&
      !(await this.prisma.brand.findUnique({ where: { id: input.brandId } }))
    )
      missing.push('brandId');
    if (
      input.taxRateId &&
      !(await this.prisma.taxRate.findUnique({
        where: { id: input.taxRateId },
      }))
    )
      missing.push('taxRateId');
    if (missing.length)
      throw new BadRequestException(`Unknown ${missing.join(', ')}`);
  }
}
