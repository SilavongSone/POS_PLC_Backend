import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ImageStoreService } from '../common/image-store.service.js';
import { RequestContext } from '../common/request-context.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProvisioningService } from '../tenancy/provisioning.service.js';
import type { CreateStoreInput } from './stores.schemas.js';

type Tx = Prisma.TransactionClient;
type Copy = CreateStoreInput['copy'];
type Counts = {
  categories: number;
  brands: number;
  units: number;
  products: number;
  images: number;
  customers: number;
  suppliers: number;
};

/** Stores one verified e-mail may own; stops runaway creation. */
export const MAX_STORES_PER_OWNER = 20;
/** Settings that name the business: the new store gets its own. */
const OWN_SETTINGS = new Set([
  'store.name',
  'store.companyName',
  'store.taxId',
]);
const BATCH = 500;

const chunks = <T>(rows: T[]) =>
  Array.from({ length: Math.ceil(rows.length / BATCH) }, (_, i) =>
    rows.slice(i * BATCH, (i + 1) * BATCH),
  );

/**
 * A new store = a new company (tenant): fully separate data, users, numbering and
 * subscription, enforced by the tenant extension like any other company. Chosen data of
 * the current store is copied once with new ids; nothing links the two afterwards.
 * See docs/specs/independent-stores.md.
 */
@Injectable()
export class StoresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provisioning: ProvisioningService,
    private readonly images: ImageStoreService,
  ) {}

  async create(userId: string, input: CreateStoreInput) {
    const from = RequestContext.tenantId();
    const me = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    // The owner signs in to the new store with this e-mail and switches between stores by
    // it, so it must be proven.
    if (!me.email || !me.emailVerifiedAt)
      throw new ForbiddenException({
        message: 'Confirm your e-mail before creating another store',
        code: 'EMAIL_NOT_VERIFIED',
      });
    const owned = await RequestContext.asPlatform(() =>
      this.prisma.user.count({
        where: {
          email: me.email,
          emailVerifiedAt: { not: null },
          tenant: { isActive: true },
        },
      }),
    );
    if (owned >= MAX_STORES_PER_OWNER)
      throw new ConflictException({
        message: `At most ${MAX_STORES_PER_OWNER} stores per owner`,
        code: 'STORE_LIMIT_REACHED',
      });

    const source = await RequestContext.asPlatform(() =>
      this.prisma.tenant.findUniqueOrThrow({
        where: { id: from },
        select: {
          defaultLanguage: true,
          subscription: { include: { plan: true } },
        },
      }),
    );
    const plan = await this.planFor(source.subscription?.plan);
    const code = await this.provisioning.freeCode(input.name, me.email);
    const copied: Counts = {
      categories: 0,
      brands: 0,
      units: 0,
      products: 0,
      images: 0,
      customers: 0,
      suppliers: 0,
    };

    let to: string | undefined;
    try {
      const { tenant } = await this.provisioning.provision(
        {
          code,
          name: input.name,
          defaultLanguage: source.defaultLanguage as 'lo' | 'th' | 'en',
          planCode: plan.code,
          status: plan.status,
          branch: { code: 'MAIN', name: input.branchName ?? 'Main' },
          owner: {
            username: me.username,
            fullName: me.fullName,
            firstName: me.firstName ?? me.fullName,
            lastName: me.lastName,
            passwordHash: me.passwordHash,
            email: me.email,
            emailVerified: true,
            googleSub: me.googleSub ?? undefined,
          },
        },
        {
          extend: async (tx, created) => {
            to = created.tenantId;
            await this.copy(tx, from, created.tenantId, input.copy, copied);
            const avatarUrl = await this.images.copyToTenant(
              me.avatarUrl,
              from,
              created.tenantId,
            );
            if (avatarUrl)
              await tx.user.update({
                where: { id: created.ownerId },
                data: { avatarUrl },
              });
          },
        },
      );
      return { code: tenant.code, name: tenant.name, copied };
    } catch (error) {
      // Files copied before the transaction failed belong to a company that was never made.
      if (to) await this.images.removeTenantFiles(to);
      throw error;
    }
  }

  /**
   * Same plan as the current store, as a separate subscription: a trial when the plan has
   * one, active when it is free; otherwise the sign-up default plan with its trial.
   */
  private async planFor(
    plan:
      | {
          code: string;
          isActive: boolean;
          trialDays: number;
          priceMonthlyLak: Prisma.Decimal;
        }
      | undefined,
  ): Promise<{ code: string; status: 'TRIAL' | 'ACTIVE' }> {
    if (plan?.isActive && plan.trialDays > 0)
      return { code: plan.code, status: 'TRIAL' };
    if (plan?.isActive && plan.priceMonthlyLak.isZero())
      return { code: plan.code, status: 'ACTIVE' };
    return {
      code: await this.provisioning.defaultSignupPlanCode(),
      status: 'TRIAL',
    };
  }

  /** Copies the chosen data of store `from` into the new store `to` (current context). */
  private async copy(
    tx: Tx,
    from: string,
    to: string,
    opts: Copy,
    counts: Counts,
  ) {
    const read = <T>(fn: () => T) => RequestContext.withTenant(from, fn);
    const image = (url: string | null | undefined) =>
      this.images.copyToTenant(url, from, to);

    // ── Setup: always the source's own (replaces the sign-up defaults) ──
    const taxRates = await read(() => tx.taxRate.findMany());
    await tx.taxRate.deleteMany();
    const taxId = new Map(taxRates.map((r) => [r.id, randomUUID()]));
    await tx.taxRate.createMany({
      data: taxRates.map((r) => ({
        id: taxId.get(r.id)!,
        name: r.name,
        percent: r.percent,
        isDefault: r.isDefault,
        isActive: r.isActive,
      })),
    });

    const paymentTypes = await read(() => tx.paymentType.findMany());
    await tx.paymentType.deleteMany();
    await tx.paymentType.createMany({
      data: paymentTypes.map((p) => ({
        name: p.name,
        nameI18n: p.nameI18n ?? undefined,
        kind: p.kind,
        requiresReference: p.requiresReference,
        isActive: p.isActive,
        sortOrder: p.sortOrder,
      })),
    });

    const expenseCategories = await read(() => tx.expenseCategory.findMany());
    await tx.expenseCategory.deleteMany();
    await tx.expenseCategory.createMany({
      data: expenseCategories.map((c) => ({
        name: c.name,
        nameI18n: c.nameI18n ?? undefined,
        isActive: c.isActive,
      })),
    });

    const currencies = await read(() => tx.currency.findMany());
    if (currencies.length) {
      await tx.exchangeRate.deleteMany();
      await tx.currency.deleteMany();
      await tx.currency.createMany({
        data: currencies.map((c) => ({
          code: c.code,
          name: c.name,
          nameI18n: c.nameI18n ?? undefined,
          symbol: c.symbol,
          decimals: c.decimals,
          cashRounding: c.cashRounding,
          isBase: c.isBase,
          isActive: c.isActive,
          sortOrder: c.sortOrder,
        })),
      });
      // The current rate of each currency only; history stays with the old store.
      const rates = await read(() =>
        tx.exchangeRate.findMany({
          orderBy: { effectiveFrom: 'desc' },
          distinct: ['currency'],
        }),
      );
      await tx.exchangeRate.createMany({
        data: rates.map((r) => ({
          currency: r.currency,
          lakPerUnit: r.lakPerUnit,
        })),
      });
    }

    if (opts.settings) {
      const settings = (await read(() => tx.setting.findMany())).filter(
        (s) => !OWN_SETTINGS.has(s.key),
      );
      const values = await Promise.all(
        settings.map(async (s) =>
          s.key === 'store.logoUrl' && typeof s.value === 'string'
            ? ((await image(s.value)) ?? '')
            : s.value,
        ),
      );
      await tx.setting.deleteMany({
        where: { key: { in: settings.map((s) => s.key) } },
      });
      await tx.setting.createMany({
        data: settings.map((s, i) => ({
          key: s.key,
          value: values[i] as Prisma.InputJsonValue,
        })),
      });
    }

    if (opts.catalog)
      await this.copyCatalog(tx, read, image, opts, taxId, counts);

    if (opts.customers) {
      const customers = await read(() => tx.customer.findMany());
      for (const batch of chunks(customers))
        await tx.customer.createMany({
          data: batch.map((c) => ({
            code: c.code,
            name: c.name,
            type: c.type,
            companyName: c.companyName,
            taxId: c.taxId,
            phone: c.phone,
            email: c.email,
            address: c.address,
            priceTier: c.priceTier,
            creditLimitLak: c.creditLimitLak,
            note: c.note,
            isActive: c.isActive,
          })),
        });
      counts.customers = customers.length;
    }

    if (opts.suppliers) {
      const suppliers = await read(() => tx.supplier.findMany());
      await tx.supplier.createMany({
        data: suppliers.map((s) => ({
          name: s.name,
          phone: s.phone,
          email: s.email,
          address: s.address,
          taxId: s.taxId,
          isActive: s.isActive,
        })),
      });
      counts.suppliers = suppliers.length;
    }
  }

  private async copyCatalog(
    tx: Tx,
    read: <T>(fn: () => T) => T,
    image: (url: string | null | undefined) => Promise<string | null>,
    opts: Copy,
    taxId: Map<string, string>,
    counts: Counts,
  ) {
    // Replace the sign-up starter catalog (nothing uses it yet).
    await tx.brand.deleteMany();
    for (let depth = 0; depth < 10; depth++) {
      const leaves = await tx.category.findMany({
        where: { children: { none: {} } },
        select: { id: true },
      });
      if (!leaves.length) break;
      await tx.category.deleteMany({
        where: { id: { in: leaves.map((c) => c.id) } },
      });
    }
    await tx.unit.deleteMany();

    const units = await read(() => tx.unit.findMany());
    await tx.unit.createMany({
      data: units.map((u) => ({
        name: u.name,
        nameI18n: u.nameI18n ?? undefined,
        sortOrder: u.sortOrder,
        isActive: u.isActive,
      })),
    });
    counts.units = units.length;

    // Parents before children.
    const categories = await read(() => tx.category.findMany());
    const categoryId = new Map(categories.map((c) => [c.id, randomUUID()]));
    let level = categories.filter((c) => !c.parentId);
    const done = new Set<string>();
    while (level.length) {
      await tx.category.createMany({
        data: level.map((c) => ({
          id: categoryId.get(c.id)!,
          name: c.name,
          nameI18n: c.nameI18n ?? undefined,
          slug: c.slug,
          parentId: c.parentId ? categoryId.get(c.parentId)! : null,
          sortOrder: c.sortOrder,
          isActive: c.isActive,
        })),
      });
      level.forEach((c) => done.add(c.id));
      level = categories.filter(
        (c) => c.parentId && !done.has(c.id) && done.has(c.parentId),
      );
    }
    counts.categories = done.size;

    const brands = await read(() =>
      tx.brand.findMany({ include: { categories: true } }),
    );
    const brandId = new Map(brands.map((b) => [b.id, randomUUID()]));
    const brandLogos = await Promise.all(
      brands.map((b) =>
        opts.images ? image(b.logoUrl) : Promise.resolve(null),
      ),
    );
    await tx.brand.createMany({
      data: brands.map((b, i) => ({
        id: brandId.get(b.id)!,
        name: b.name,
        logoUrl:
          brandLogos[i] ?? (b.logoUrl?.startsWith('/api/') ? null : b.logoUrl),
      })),
    });
    counts.images += brandLogos.filter(Boolean).length;
    await tx.brandCategory.createMany({
      data: brands.flatMap((b) =>
        b.categories
          .filter((c) => categoryId.has(c.categoryId))
          .map((c) => ({
            brandId: brandId.get(b.id)!,
            categoryId: categoryId.get(c.categoryId)!,
          })),
      ),
    });
    counts.brands = brands.length;

    const templates = await read(() => tx.labelTemplate.findMany());
    await tx.labelTemplate.createMany({
      data: templates.map((t) => ({
        name: t.name,
        widthMm: t.widthMm,
        heightMm: t.heightMm,
        columns: t.columns,
        gapMm: t.gapMm,
        marginMm: t.marginMm,
        elements: t.elements as Prisma.InputJsonValue,
        isDefault: t.isDefault,
      })),
    });

    const groups = await read(() => tx.productGroup.findMany());
    const groupId = new Map(groups.map((g) => [g.id, randomUUID()]));
    await tx.productGroup.createMany({
      data: groups.map((g) => ({
        id: groupId.get(g.id)!,
        name: g.name,
        nameI18n: g.nameI18n ?? undefined,
        optionName: g.optionName,
      })),
    });

    const products = await read(() =>
      tx.product.findMany({
        include: { images: true, units: true, bundleItems: true },
      }),
    );
    const productId = new Map(products.map((p) => [p.id, randomUUID()]));
    for (const batch of chunks(products))
      await tx.product.createMany({
        data: batch.map((p) => ({
          id: productId.get(p.id)!,
          sku: p.sku,
          barcode: p.barcode,
          name: p.name,
          nameI18n: p.nameI18n ?? undefined,
          description: p.description,
          descriptionI18n: p.descriptionI18n ?? undefined,
          type: p.type,
          categoryId: p.categoryId ? categoryId.get(p.categoryId) : null,
          brandId: p.brandId ? brandId.get(p.brandId) : null,
          model: p.model,
          unit: p.unit,
          location: p.location,
          specs: p.specs ?? undefined,
          priceCurrency: p.priceCurrency,
          retailPrice: p.retailPrice,
          wholesalePrice: p.wholesalePrice,
          wholesaleMinQty: p.wholesaleMinQty,
          costCurrency: p.costCurrency,
          costPrice: p.costPrice,
          // No stock yet: the average cost starts again with the first receipt.
          avgCostLak: 0,
          stockQty: 0,
          trackStock: p.trackStock,
          lowStockAlert: p.lowStockAlert,
          trackSerial: p.trackSerial,
          trackExpiry: p.trackExpiry,
          warrantyMonths: p.warrantyMonths,
          taxRateId: p.taxRateId ? (taxId.get(p.taxRateId) ?? null) : null,
          isActive: p.isActive,
          groupId: p.groupId ? groupId.get(p.groupId) : null,
          variantValue: p.variantValue,
          variantOrder: p.variantOrder,
        })),
      });
    counts.products = products.length;

    if (opts.images) {
      const photos = products.flatMap((p) =>
        p.images.map((img) => ({ productId: productId.get(p.id)!, img })),
      );
      const urls = await Promise.all(photos.map((x) => image(x.img.url)));
      const rows = photos
        .map((x, i) => ({
          productId: x.productId,
          url: urls[i],
          sortOrder: x.img.sortOrder,
        }))
        .filter((r): r is typeof r & { url: string } => !!r.url);
      for (const batch of chunks(rows))
        await tx.productImage.createMany({ data: batch });
      counts.images += rows.length;
    }

    const packs = products.flatMap((p) => p.units);
    for (const batch of chunks(packs))
      await tx.productUnit.createMany({
        data: batch.map((u) => ({
          productId: productId.get(u.productId)!,
          unit: u.unit,
          factor: u.factor,
          barcode: u.barcode,
          retailPrice: u.retailPrice,
          wholesalePrice: u.wholesalePrice,
          isActive: u.isActive,
          sortOrder: u.sortOrder,
        })),
      });

    const parts = products.flatMap((p) => p.bundleItems);
    for (const batch of chunks(parts))
      await tx.productBundleItem.createMany({
        data: batch.map((b) => ({
          bundleId: productId.get(b.bundleId)!,
          componentId: productId.get(b.componentId)!,
          quantity: b.quantity,
        })),
      });
  }
}
