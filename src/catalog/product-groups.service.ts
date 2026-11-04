import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../common/audit.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateProductInput } from './catalog.schemas.js';
import type {
  CreateProductGroupInput,
  NewVariantInput,
  UpdateProductGroupInput,
} from './product-groups.schemas.js';
import { ProductsService } from './products.service.js';

type I18n = Partial<Record<'lo' | 'th' | 'en', string>>;

/** "Xprinter XP-T80Q" + "USB+LAN" → "Xprinter XP-T80Q (USB+LAN)" */
export const variantName = (name: string, value: string) =>
  `${name} (${value})`;

function variantI18n(nameI18n: unknown, value: string) {
  const names = (nameI18n ?? {}) as I18n;
  const out: I18n = {};
  for (const [lang, name] of Object.entries(names))
    if (name) out[lang as keyof I18n] = variantName(name, value);
  return Object.keys(out).length
    ? (out as Prisma.InputJsonValue)
    : Prisma.DbNull;
}

/** "USB+LAN" → "USB-LAN" for SKUs (letters, digits, . _ -). */
const skuPart = (value: string) =>
  value
    .normalize('NFKD')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20) || 'V';

/**
 * Versions of one model. Each version stays a full product (own SKU, barcode, price, stock,
 * serials, packs), so the till, stock and reports work unchanged; the group gives the shared
 * name and keeps category, brand, description and warranty the same on every version.
 */
@Injectable()
export class ProductGroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
    private readonly audit: AuditService,
  ) {}

  async get(id: string) {
    const [group, ctx] = await Promise.all([
      this.prisma.productGroup.findUniqueOrThrow({
        where: { id },
        include: {
          products: {
            orderBy: [{ variantOrder: 'asc' }, { createdAt: 'asc' }],
            select: {
              id: true,
              sku: true,
              barcode: true,
              name: true,
              nameI18n: true,
              variantValue: true,
              variantOrder: true,
              priceCurrency: true,
              retailPrice: true,
              wholesalePrice: true,
              stockQty: true,
              trackStock: true,
              trackSerial: true,
              unit: true,
              isActive: true,
            },
          },
        },
      }),
      this.products.pricingContext(),
    ]);
    return {
      ...group,
      products: group.products.map((p) => ({
        ...p,
        ...this.products.lakPrices(p, ctx),
      })),
    };
  }

  async create(input: CreateProductGroupInput, actorId: string) {
    const ids = input.products.map((p) => p.productId);
    const rows = await this.prisma.product.findMany({
      where: { id: { in: ids } },
    });
    if (rows.length !== ids.length) throw new NotFoundException();
    const grouped = rows.find((r) => r.groupId);
    if (grouped) {
      throw new ConflictException({
        message: `${grouped.name} is already a version of another model`,
        code: 'PRODUCT_IN_GROUP',
        name: grouped.name,
      });
    }
    const first = rows.find((r) => r.id === ids[0])!;
    const shared: Prisma.ProductUncheckedUpdateInput = {
      categoryId: first.categoryId,
      brandId: first.brandId,
      model: first.model,
      description: first.description,
      descriptionI18n: first.descriptionI18n ?? Prisma.DbNull,
      warrantyMonths: first.warrantyMonths,
      taxRateId: first.taxRateId,
    };

    const group = await this.prisma.$transaction(async (tx) => {
      const g = await tx.productGroup.create({
        data: {
          name: input.name,
          nameI18n: input.nameI18n ?? undefined,
          optionName: input.optionName,
        },
      });
      for (const [variantOrder, item] of input.products.entries()) {
        await tx.product.update({
          where: { id: item.productId },
          data: {
            ...shared,
            groupId: g.id,
            variantValue: item.value,
            variantOrder,
            name: variantName(g.name, item.value),
            nameI18n: variantI18n(g.nameI18n, item.value),
          },
        });
      }
      return g;
    });
    for (const v of input.newVariants)
      await this.addVariant(
        group.id,
        { ...v, copyFrom: v.copyFrom ?? first.id },
        actorId,
      );
    await this.audit.log({
      userId: actorId,
      action: 'PRODUCT_GROUP_CREATE',
      entity: 'ProductGroup',
      entityId: group.id,
      after: input,
    });
    return this.get(group.id);
  }

  /** A new version copied from another one: same details and price, its own SKU and stock. */
  async addVariant(groupId: string, input: NewVariantInput, actorId: string) {
    const group = await this.prisma.productGroup.findUniqueOrThrow({
      where: { id: groupId },
      include: {
        products: {
          orderBy: { variantOrder: 'asc' },
          include: { units: true },
        },
      },
    });
    if (
      group.products.some(
        (p) => p.variantValue?.toLowerCase() === input.value.toLowerCase(),
      )
    ) {
      throw new ConflictException({
        message: `This model already has the version ${input.value}`,
        code: 'VARIANT_EXISTS',
        field: 'value',
        value: input.value,
      });
    }
    const source = input.copyFrom
      ? group.products.find((p) => p.id === input.copyFrom)
      : group.products[0];
    if (!source) throw new BadRequestException('Copy a version of this model');

    const data: CreateProductInput = {
      sku:
        input.sku ??
        (await this.freeSku(`${source.sku}-${skuPart(input.value)}`)),
      barcode: input.barcode ?? null,
      name: variantName(group.name, input.value),
      description: source.description,
      type: source.type,
      categoryId: source.categoryId,
      brandId: source.brandId,
      model: source.model,
      unit: source.unit,
      location: source.location,
      specs: (source.specs as Record<string, string> | null) ?? null,
      priceCurrency: source.priceCurrency,
      retailPrice: input.retailPrice ?? source.retailPrice.toNumber(),
      wholesalePrice: source.wholesalePrice?.toNumber() ?? null,
      wholesaleMinQty: source.wholesaleMinQty,
      costCurrency: source.costCurrency,
      costPrice: source.costPrice.toNumber(),
      trackStock: source.trackStock,
      lowStockAlert: source.lowStockAlert,
      trackSerial: source.trackSerial,
      trackExpiry: source.trackExpiry,
      warrantyMonths: source.warrantyMonths,
      taxRateId: source.taxRateId,
      isActive: true,
    };
    const created = await this.products.create(data, actorId, true);
    await this.prisma.product.update({
      where: { id: created.id },
      data: {
        groupId,
        variantValue: input.value,
        variantOrder:
          Math.max(-1, ...group.products.map((p) => p.variantOrder)) + 1,
        nameI18n: variantI18n(group.nameI18n, input.value),
        descriptionI18n: source.descriptionI18n ?? Prisma.DbNull,
      },
    });
    // Packs come along, without barcodes (those belong to the other version's boxes).
    if (source.units.length) {
      await this.prisma.productUnit.createMany({
        data: source.units.map((u) => ({
          productId: created.id,
          unit: u.unit,
          factor: u.factor,
          retailPrice: u.retailPrice,
          wholesalePrice: u.wholesalePrice,
          isActive: u.isActive,
          sortOrder: u.sortOrder,
        })),
      });
    }
    return this.get(groupId);
  }

  async update(id: string, input: UpdateProductGroupInput, actorId: string) {
    const before = await this.prisma.productGroup.findUniqueOrThrow({
      where: { id },
      include: { products: { select: { id: true, variantValue: true } } },
    });
    const values = new Map(
      before.products.map((p) => [p.id, p.variantValue ?? '']),
    );
    const order = new Map<string, number>();
    for (const [i, v] of (input.variants ?? []).entries()) {
      if (!values.has(v.productId))
        throw new BadRequestException(
          `variants[${i}]: not a version of this model`,
        );
      values.set(v.productId, v.value);
      order.set(v.productId, i);
    }
    const lower = [...values.values()].map((v) => v.toLowerCase());
    if (new Set(lower).size !== lower.length) {
      throw new ConflictException({
        message: 'Each version needs a different value',
        code: 'VARIANT_EXISTS',
        field: 'variants',
      });
    }
    await this.prisma.$transaction(async (tx) => {
      const g = await tx.productGroup.update({
        where: { id },
        data: {
          name: input.name,
          nameI18n: input.nameI18n,
          optionName: input.optionName,
        },
      });
      // Clear values first so two versions can swap them under the unique index.
      if (input.variants?.length)
        await tx.product.updateMany({
          where: { groupId: id },
          data: { variantValue: null },
        });
      for (const [productId, value] of values) {
        await tx.product.update({
          where: { id: productId },
          data: {
            variantValue: value,
            ...(order.has(productId) && { variantOrder: order.get(productId) }),
            name: variantName(g.name, value),
            nameI18n: variantI18n(g.nameI18n, value),
          },
        });
      }
    });
    await this.audit.log({
      userId: actorId,
      action: 'PRODUCT_GROUP_UPDATE',
      entity: 'ProductGroup',
      entityId: id,
      before,
      after: input,
    });
    return this.get(id);
  }

  /** The product stays as it is, just no longer a version of the model. */
  async removeVariant(id: string, productId: string, actorId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, groupId: id },
    });
    if (!product) throw new NotFoundException();
    await this.prisma.product.update({
      where: { id: productId },
      data: { groupId: null, variantValue: null, variantOrder: 0 },
    });
    const left = await this.prisma.product.count({ where: { groupId: id } });
    if (left === 0) await this.prisma.productGroup.delete({ where: { id } });
    await this.audit.log({
      userId: actorId,
      action: 'PRODUCT_GROUP_REMOVE_VARIANT',
      entity: 'ProductGroup',
      entityId: id,
      after: { productId },
    });
    return left === 0 ? null : this.get(id);
  }

  /** Ungroups every version; the products keep their names, prices and stock. */
  async remove(id: string, actorId: string) {
    await this.prisma.productGroup.findUniqueOrThrow({ where: { id } });
    await this.prisma.$transaction([
      this.prisma.product.updateMany({
        where: { groupId: id },
        data: { groupId: null, variantValue: null, variantOrder: 0 },
      }),
      this.prisma.productGroup.delete({ where: { id } }),
    ]);
    await this.audit.log({
      userId: actorId,
      action: 'PRODUCT_GROUP_DELETE',
      entity: 'ProductGroup',
      entityId: id,
    });
  }

  private async freeSku(base: string) {
    const sku = base.slice(0, 50);
    for (let n = 1; n < 100; n++) {
      const candidate = n === 1 ? sku : `${sku.slice(0, 46)}-${n}`;
      const taken = await this.prisma.product.findFirst({
        where: { sku: candidate },
        select: { id: true },
      });
      if (!taken) return candidate;
    }
    throw new ConflictException('Choose a SKU for the new version');
  }
}
