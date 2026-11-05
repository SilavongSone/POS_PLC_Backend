import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../common/audit.service.js';
import { ImageStoreService } from '../common/image-store.service.js';
import { pageArgs, toPage, type Page } from '../common/pagination.js';
import { Prisma } from '../generated/prisma/client.js';
import { RequestContext } from '../common/request-context.js';
import { branchLimit } from '../branches/branch-access.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SHARED_VARIANT_FIELDS } from './product-groups.shared.js';
import { CurrenciesService } from '../settings/currencies.service.js';
import {
  ExchangeRatesService,
  rateOf,
  type CurrentRates,
} from '../settings/exchange-rates.service.js';
import { SettingsService } from '../settings/settings.service.js';
import type {
  BulkPriceInput,
  BundleItemsInput,
  CreateProductInput,
  ListProductsQuery,
  ProductUnitsInput,
  SetPricesInput,
  UpdateProductInput,
} from './catalog.schemas.js';
import { BrandsService } from './brands.service.js';
import { CategoriesService } from './categories.service.js';
import { UnitsService } from './units.service.js';
import { costToLak, priceToLak, roundUpLak } from './pricing.js';
import { EntitlementsService } from '../tenancy/entitlements.service.js';

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
  units: { where: { isActive: true }, orderBy: { factor: 'asc' } },
  group: { select: { id: true, name: true, nameI18n: true, optionName: true } },
} satisfies Prisma.ProductInclude;

const detailInclude = {
  category: { select: { id: true, name: true, slug: true, parentId: true } },
  brand: { select: { id: true, name: true, logoUrl: true } },
  taxRate: { select: { id: true, name: true, percent: true } },
  images: { orderBy: { sortOrder: 'asc' } },
  units: { orderBy: { factor: 'asc' } },
  group: { select: { id: true, name: true, nameI18n: true, optionName: true } },
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

export type PricingContext = { rates: CurrentRates; lakRounding: number };

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly categories: CategoriesService,
    private readonly rates: ExchangeRatesService,
    private readonly settings: SettingsService,
    private readonly entitlements: EntitlementsService,
    private readonly brands: BrandsService,
    private readonly images: ImageStoreService,
    private readonly units: UnitsService,
    private readonly currencies: CurrenciesService,
  ) {}

  /** After a save: the brand belongs to the product's category; the unit is in the list. */
  private async syncCatalog(product: {
    brandId: string | null;
    categoryId: string | null;
    unit: string;
  }) {
    if (product.brandId && product.categoryId) {
      await this.brands.linkToCategory(product.brandId, product.categoryId);
    }
    await this.units.ensure(product.unit);
  }

  async pricingContext(tx?: Prisma.TransactionClient): Promise<PricingContext> {
    const [rates, lakRounding] = await Promise.all([
      this.rates.current(tx),
      this.settings.get('pricing.lakRounding', tx),
    ]);
    return { rates, lakRounding };
  }

  /** Counted products at or below their alert level over these branches (no stock row = 0). */
  private async lowAtBranches(branchIds: string[]) {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT p.id FROM "Product" p
      LEFT JOIN "BranchStock" bs ON bs."productId" = p.id
        AND bs."branchId" IN (${Prisma.join(branchIds)})
      WHERE p."tenantId" = ${RequestContext.tenantId()}
        AND p."trackStock" AND p.type = 'STANDARD'
      GROUP BY p.id, p."lowStockAlert"
      HAVING COALESCE(SUM(bs.qty), 0) <= p."lowStockAlert"`;
    return rows.map((r) => r.id);
  }

  /** On hand over these branches for these products (empty without branches). */
  private async branchQtyMap(productIds: string[], branchIds?: string[]) {
    if (!branchIds?.length || !productIds.length)
      return new Map<string, number>();
    const rows = await this.prisma.branchStock.groupBy({
      by: ['productId'],
      where: { branchId: { in: branchIds }, productId: { in: productIds } },
      _sum: { qty: true },
    });
    return new Map(rows.map((r) => [r.productId, r._sum.qty ?? 0]));
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
      priceCurrency: string;
      retailPrice: Prisma.Decimal;
      wholesalePrice: Prisma.Decimal | null;
    },
    ctx: PricingContext,
  ) {
    const rate = rateOf(ctx.rates, p.priceCurrency, 'priceCurrency').lakPerUnit;
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
      units: row.units.map((u) => ({
        ...u,
        ...this.lakPrices({ ...u, priceCurrency: row.priceCurrency }, ctx),
      })),
    };
    if (!canViewCost) for (const f of COST_FIELDS) delete view[f];
    return view as unknown as T & ReturnType<ProductsService['lakPrices']>;
  }

  async list(
    query: ListProductsQuery,
    canViewCost: boolean,
  ): Promise<Page<unknown>> {
    // A user limited to some branches sees stock as the sum over those branches only.
    const limit = branchLimit(query.branchId);
    const stockAt = query.branchId ? [query.branchId] : (limit ?? undefined);
    const where: Prisma.ProductWhereInput = {
      brandId: query.brandId,
      groupId: query.groupId,
      type: query.type,
      isActive: query.isActive,
      ...(query.categoryId && {
        categoryId: {
          in: await this.categories.withDescendants(query.categoryId),
        },
      }),
      // With a branch, "low" and "in stock" mean that branch's own stock.
      ...(query.lowStock &&
        (stockAt
          ? { id: { in: await this.lowAtBranches(stockAt) } }
          : {
              trackStock: true,
              type: 'STANDARD',
              stockQty: { lte: this.prisma.product.fields.lowStockAlert },
            })),
      ...(query.inStock !== undefined &&
        (stockAt
          ? {
              branchStock: query.inStock
                ? { some: { branchId: { in: stockAt }, qty: { gt: 0 } } }
                : { none: { branchId: { in: stockAt }, qty: { gt: 0 } } },
            }
          : { stockQty: query.inStock ? { gt: 0 } : { lte: 0 } })),
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
    const branchQty = await this.branchQtyMap(
      rows.map((r) => r.id),
      query.branchId ? [query.branchId] : undefined,
    );
    const ownQty = limit
      ? await this.branchQtyMap(
          rows.map((r) => r.id),
          limit,
        )
      : undefined;
    return toPage(
      rows.map((r) => ({
        ...this.present(atBranch(r, prices.get(r.id)), ctx, canViewCost),
        ...(ownQty && { stockQty: ownQty.get(r.id) ?? 0 }),
        ...(query.branchId && { branchStockQty: branchQty.get(r.id) ?? 0 }),
      })),
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
    // A user limited to some branches sets (and replaces) prices of those branches only.
    for (const branchId of branchIds) branchLimit(branchId);
    const limit = branchLimit();
    const inLimit = limit ? { branchId: { in: limit } } : {};
    const known = await this.prisma.branch.count({
      where: { id: { in: branchIds } },
    });
    if (known !== branchIds.length)
      throw new BadRequestException('Unknown branch');
    const before = await this.prisma.branchPrice.findMany({
      where: { productId: id, ...inLimit },
    });
    await this.prisma.$transaction([
      this.prisma.branchPrice.deleteMany({
        where: { productId: id, ...inLimit },
      }),
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
    // A user limited to some branches sees stock, units and prices of those branches only.
    const limit = branchLimit(branchId);
    const inLimit = limit ? { branchId: { in: limit } } : {};
    const [row, ctx, serialCounts] = await Promise.all([
      this.prisma.product.findUniqueOrThrow({
        where: { id },
        include: detailInclude,
      }),
      this.pricingContext(),
      this.prisma.serialNumber.groupBy({
        by: ['condition'],
        where: { productId: id, status: 'IN_STOCK', ...inLimit },
        _count: true,
      }),
    ]);
    const [demoUnits, branchStock, branchPrices, prices] = await Promise.all([
      this.prisma.serialNumber.findMany({
        where: {
          productId: id,
          status: 'IN_STOCK',
          condition: 'DEMO',
          ...inLimit,
        },
        select: { id: true, serial: true, priceLak: true, branchId: true },
      }),
      this.prisma.branchStock.findMany({
        where: { productId: id, ...inLimit },
        select: {
          qty: true,
          branch: { select: { id: true, code: true, name: true } },
        },
        orderBy: { branch: { code: 'asc' } },
      }),
      this.prisma.branchPrice.findMany({
        where: { productId: id, ...inLimit },
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
      ...(limit && {
        stockQty: branchStock.reduce((sum, b) => sum + b.qty, 0),
      }),
      /** Prices that differ by branch (in the product's price currency). */
      branchPrices: branchPrices.map(({ branch, ...p }) => ({
        branchId: branch.id,
        code: branch.code,
        name: branch.name,
        ...p,
      })),
      /** On hand per branch; stockQty is the total. */
      branchStock: branchStock.map((b) => ({ ...b.branch, qty: b.qty })),
      ...(branchId && {
        branchStockQty:
          branchStock.find((b) => b.branch.id === branchId)?.qty ?? 0,
      }),
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
        unit: null,
        serial: null,
      };

    const pack = await this.prisma.productUnit.findFirst({
      where: { barcode: code, isActive: true },
      select: { id: true, productId: true },
    });
    if (pack) {
      const found = await this.get(pack.productId, canViewCost, branchId);
      return {
        product: found,
        unit: found.units.find((u) => u.id === pack.id) ?? null,
        serial: null,
      };
    }

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
      unit: null,
      serial,
    };
  }

  /**
   * Replaces the packs a product is sold in. Stock stays in the base unit, so packs need a
   * countable standard product without serials (a serial is one piece).
   */
  async setUnits(
    id: string,
    input: ProductUnitsInput,
    actorId: string,
    canViewCost: boolean,
  ) {
    const product = await this.prisma.product.findUniqueOrThrow({
      where: { id },
      include: { units: true },
    });
    if (
      input.items.length &&
      (product.trackSerial || product.type !== 'STANDARD')
    ) {
      throw new BadRequestException({
        message: 'Packs are for standard products without serial numbers',
        code: 'UNIT_NOT_FOR_SERIAL',
      });
    }
    const known = new Set(
      (
        await this.prisma.unit.findMany({
          where: { name: { in: input.items.map((i) => i.unit) } },
          select: { name: true },
        })
      ).map((u) => u.name),
    );
    for (const [i, item] of input.items.entries()) {
      if (!known.has(item.unit) || item.unit === product.unit) {
        throw new BadRequestException({
          message: `Choose another unit than the base unit (${product.unit})`,
          code: 'UNIT_INVALID',
          field: `items.${i}.unit`,
        });
      }
      if (item.id && !product.units.some((u) => u.id === item.id))
        throw new BadRequestException(`items.${i}: unknown pack`);
      if (!item.barcode) continue;
      try {
        await this.assertUnique({ barcode: item.barcode }, undefined, id);
        await this.assertCodesFree({ barcode: item.barcode });
      } catch (error) {
        if (error instanceof ConflictException) {
          const body = error.getResponse() as Record<string, unknown>;
          throw new ConflictException({ ...body, field: `items.${i}.barcode` });
        }
        throw error;
      }
    }
    const keep = input.items.flatMap((i) => (i.id ? [i.id] : []));
    await this.prisma.$transaction(async (tx) => {
      await tx.productUnit.deleteMany({
        where: { productId: id, id: { notIn: keep } },
      });
      // Free barcodes first so two packs can swap them.
      await tx.productUnit.updateMany({
        where: { productId: id },
        data: { barcode: null },
      });
      for (const [sortOrder, item] of input.items.entries()) {
        const data = {
          unit: item.unit,
          factor: item.factor,
          barcode: item.barcode ?? null,
          retailPrice: item.retailPrice,
          wholesalePrice: item.wholesalePrice ?? null,
          isActive: item.isActive,
          sortOrder,
        };
        if (item.id)
          await tx.productUnit.update({ where: { id: item.id }, data });
        else await tx.productUnit.create({ data: { ...data, productId: id } });
      }
    });
    await this.audit.log({
      userId: actorId,
      action: 'PRODUCT_UNITS',
      entity: 'Product',
      entityId: id,
      before: product.units,
      after: input.items,
    });
    return this.get(id, canViewCost);
  }

  async create(
    input: CreateProductInput,
    actorId: string,
    canViewCost: boolean,
  ) {
    await this.assertReferences(input);
    await this.assertPlanAllows(input);
    await this.assertUnique({ sku: input.sku, barcode: input.barcode });
    await this.assertCodesFree({ sku: input.sku, barcode: input.barcode });
    if (input.isActive !== false)
      await this.entitlements.assertLimit('maxProducts');
    const ctx = await this.pricingContext();
    const product = await this.prisma.product.create({
      data: {
        ...input,
        specs: input.specs ?? undefined,
        avgCostLak: costToLak(
          input.costPrice,
          rateOf(ctx.rates, input.costCurrency, 'costCurrency').lakPerUnit,
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
    await this.syncCatalog(product);
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
    if (input.barcode && input.barcode !== before.barcode) {
      await this.assertUnique({ barcode: input.barcode }, id);
      await this.assertCodesFree({ barcode: input.barcode });
    }

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
    if (
      (type !== 'STANDARD' || (input.trackSerial ?? before.trackSerial)) &&
      (await this.prisma.productUnit.count({ where: { productId: id } }))
    ) {
      throw new BadRequestException({
        message:
          'Remove the packs first: they are for standard products without serial numbers',
        code: 'UNIT_NOT_FOR_SERIAL',
      });
    }
    if (type === 'SERVICE' && (input.trackSerial ?? before.trackSerial)) {
      throw new BadRequestException('Services have no serials');
    }

    const data: Prisma.ProductUncheckedUpdateInput = {
      ...input,
      specs: input.specs === null ? Prisma.DbNull : input.specs,
    };
    // A version's name comes from its model (PATCH /product-groups/:id renames).
    if (before.groupId) {
      delete data.name;
      delete data.nameI18n;
    }
    // While there is no stock, the entered cost is also the average cost.
    if (!hasStock && (input.costPrice !== undefined || input.costCurrency)) {
      const ctx = await this.pricingContext();
      data.avgCostLak = costToLak(
        input.costPrice ?? before.costPrice,
        rateOf(
          ctx.rates,
          input.costCurrency ?? before.costCurrency,
          'costCurrency',
        ).lakPerUnit,
      );
    }
    const product = await this.prisma.product.update({ where: { id }, data });
    await this.syncCatalog(product);
    // Category, brand, description and warranty stay the same on every version of a model.
    if (product.groupId) {
      const shared = Object.fromEntries(
        SHARED_VARIANT_FIELDS.filter((f) => input[f] !== undefined).map((f) => [
          f,
          f === 'descriptionI18n' && input[f] === null
            ? Prisma.DbNull
            : input[f],
        ]),
      ) as Prisma.ProductUncheckedUpdateManyInput;
      if (Object.keys(shared).length) {
        await this.prisma.product.updateMany({
          where: { groupId: product.groupId, id: { not: id } },
          data: shared,
        });
      }
    }

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
    const adjust = (price: Prisma.Decimal, currency: string) =>
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

  async addImage(
    productId: string,
    file: { buffer: Buffer; mimetype: string; size: number },
  ) {
    await this.prisma.product.findUniqueOrThrow({ where: { id: productId } });
    const url = await this.images.save('products', file);

    const last = await this.prisma.productImage.findFirst({
      where: { productId },
      orderBy: { sortOrder: 'desc' },
    });
    return this.prisma.productImage.create({
      data: {
        productId,
        url,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });
  }

  /**
   * Deletes a product that was never used: no stock, serials, lots, movements, documents,
   * sales, quotations, repairs or bundles. Anything with history is switched off instead
   * (isActive = false), so old bills and reports keep their product.
   */
  async remove(id: string, actorId: string) {
    const product = await this.prisma.product.findUniqueOrThrow({
      where: { id },
      include: {
        images: true,
        _count: {
          select: {
            serialNumbers: true,
            lots: true,
            stockMovements: true,
            stockDocItems: true,
            saleItems: true,
            quotationItems: true,
            ticketLines: true,
            partOfBundles: true,
          },
        },
      },
    });
    const used = Object.entries(product._count)
      .filter(([, n]) => n > 0)
      .map(([k]) => k);
    if (used.length || product.stockQty !== 0) {
      throw new ConflictException({
        message:
          'This product has history (stock, sales or documents); switch it off instead',
        code: 'PRODUCT_HAS_HISTORY',
        usedBy: used,
      });
    }
    // Child rows without tenantId go with their own (already scoped) product.
    await this.prisma.$transaction([
      this.prisma.productImage.deleteMany({ where: { productId: id } }),
      this.prisma.productBundleItem.deleteMany({ where: { bundleId: id } }),
      this.prisma.promotionItem.deleteMany({ where: { productId: id } }),
      this.prisma.branchStock.deleteMany({ where: { productId: id } }),
      this.prisma.branchPrice.deleteMany({ where: { productId: id } }),
      this.prisma.product.delete({ where: { id } }),
    ]);
    for (const image of product.images) await this.images.remove(image.url);
    const { images: _images, _count, ...before } = product;
    await this.audit.log({
      userId: actorId,
      action: 'PRODUCT_DELETE',
      entity: 'Product',
      entityId: id,
      before,
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
    await this.images.remove(image.url);
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
    // A price or cost currency must be active and have a rate to convert to LAK.
    const rates =
      (input.priceCurrency || input.costCurrency) &&
      (await this.rates.current());
    for (const field of ['priceCurrency', 'costCurrency'] as const) {
      const code = input[field];
      if (!code || !rates) continue;
      await this.currencies.assertUsable(code, undefined, field);
      rateOf(rates, code, field);
    }
  }

  /** A barcode/SKU equal to a serial number would hide that unit from the scanner. */
  /** SKU and barcode are unique per company; the error names the product that has them. */
  private async assertUnique(
    codes: { sku?: string; barcode?: string | null },
    exceptId?: string,
    /** Checking a pack barcode of this product: its other packs are being replaced. */
    packOf?: string,
  ) {
    for (const field of ['sku', 'barcode'] as const) {
      const value = codes[field];
      if (!value) continue;
      const other =
        (await this.prisma.product.findFirst({
          where: {
            OR: [{ barcode: value }, { sku: value.toUpperCase() }],
            ...(exceptId && { id: { not: exceptId } }),
          },
          select: { name: true, sku: true },
        })) ??
        (
          await this.prisma.productUnit.findFirst({
            where: {
              barcode: value,
              ...(packOf && { productId: { not: packOf } }),
            },
            select: { product: { select: { name: true, sku: true } } },
          })
        )?.product;
      if (other) {
        throw new ConflictException({
          message: `${field === 'sku' ? 'SKU' : 'Barcode'} ${value} is already used by ${other.name} (${other.sku})`,
          code:
            field === 'sku' ? 'PRODUCT_SKU_EXISTS' : 'PRODUCT_BARCODE_EXISTS',
          field,
          value,
          name: other.name,
        });
      }
    }
  }

  /** SKU and barcode must not equal a serial number: the till looks codes up first. */
  private async assertCodesFree(codes: {
    sku?: string;
    barcode?: string | null;
  }) {
    const entries = Object.entries(codes).filter(
      (e): e is [string, string] => !!e[1],
    );
    if (!entries.length) return;
    const unit = await this.prisma.serialNumber.findFirst({
      where: {
        OR: entries.map(([, c]) => ({
          serial: { equals: c, mode: 'insensitive' },
        })),
      },
      select: { serial: true },
    });
    if (unit) {
      throw new ConflictException({
        message: `This code is already the serial number ${unit.serial} of a unit`,
        code: 'PRODUCT_CODE_MATCHES_SERIAL',
        field: entries.find(
          ([, c]) => c.toLowerCase() === unit.serial.toLowerCase(),
        )?.[0],
      });
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
