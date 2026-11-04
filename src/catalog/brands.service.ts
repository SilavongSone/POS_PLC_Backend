import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { ImageStoreService } from '../common/image-store.service.js';
import { AuditService } from '../common/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateBrandInput,
  ListBrandsQuery,
  UpdateBrandInput,
} from './catalog.schemas.js';
import { CategoriesService } from './categories.service.js';

@Injectable()
export class BrandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly categories: CategoriesService,
    private readonly images: ImageStoreService,
  ) {}

  /** All brands, or those of a category (linked to it or to a category above it). */
  async list(query: ListBrandsQuery = {}) {
    const ids = query.categoryId
      ? await this.categories.withAncestors(query.categoryId)
      : null;
    const rows = await this.prisma.brand.findMany({
      where: ids ? { categories: { some: { categoryId: { in: ids } } } } : {},
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { products: true } },
        categories: { select: { categoryId: true } },
      },
    });
    return rows.map(({ _count, categories, ...b }) => ({
      ...b,
      productCount: _count.products,
      categoryIds: categories.map((c) => c.categoryId),
    }));
  }

  /** Category ids sent by a client must belong to this company. */
  private async assertCategories(ids: string[] | undefined) {
    if (!ids?.length) return;
    const found = await this.prisma.category.count({
      where: { id: { in: ids } },
    });
    if (found !== ids.length) {
      throw new BadRequestException({
        message: 'Unknown category',
        code: 'BAD_REQUEST',
      });
    }
  }

  async create(input: CreateBrandInput, actorId: string) {
    const { categoryIds, ...data } = input;
    await this.assertCategories(categoryIds);
    const brand = await this.prisma.brand.create({
      data: {
        ...data,
        categories: {
          create: (categoryIds ?? []).map((categoryId) => ({ categoryId })),
        },
      },
    });
    await this.audit.log({
      userId: actorId,
      action: 'BRAND_CREATE',
      entity: 'Brand',
      entityId: brand.id,
      after: { ...brand, categoryIds: categoryIds ?? [] },
    });
    return brand;
  }

  async update(id: string, input: UpdateBrandInput, actorId: string) {
    const { categoryIds, ...data } = input;
    const before = await this.prisma.brand.findUniqueOrThrow({
      where: { id },
      include: { categories: { select: { categoryId: true } } },
    });
    await this.assertCategories(categoryIds);
    const brand = await this.prisma.$transaction(async (tx) => {
      if (categoryIds) {
        await tx.brandCategory.deleteMany({ where: { brandId: id } });
        await tx.brandCategory.createMany({
          data: categoryIds.map((categoryId) => ({ brandId: id, categoryId })),
        });
      }
      return tx.brand.update({ where: { id }, data });
    });
    if (data.logoUrl !== undefined && data.logoUrl !== before.logoUrl)
      await this.images.remove(before.logoUrl);
    const beforeIds = before.categories.map((c) => c.categoryId);
    await this.audit.log({
      userId: actorId,
      action: 'BRAND_UPDATE',
      entity: 'Brand',
      entityId: id,
      before: {
        id: before.id,
        name: before.name,
        logoUrl: before.logoUrl,
        categoryIds: beforeIds,
      },
      after: { ...brand, categoryIds: categoryIds ?? beforeIds },
    });
    return brand;
  }

  /**
   * Called when a product is saved: its brand now also belongs to its category, unless it
   * is already linked to that category or one above it.
   */
  async linkToCategory(brandId: string, categoryId: string) {
    const ids = await this.categories.withAncestors(categoryId);
    const linked = await this.prisma.brandCategory.findFirst({
      where: { brandId, categoryId: { in: ids } },
    });
    if (!linked) {
      await this.prisma.brandCategory.create({ data: { brandId, categoryId } });
    }
  }

  async remove(id: string, actorId: string) {
    const brand = await this.prisma.brand.findUniqueOrThrow({
      where: { id },
      include: { _count: { select: { products: true } } },
    });
    if (brand._count.products) {
      throw new ConflictException('This brand still has products');
    }
    await this.prisma.brand.delete({ where: { id } });
    await this.images.remove(brand.logoUrl);
    await this.audit.log({
      userId: actorId,
      action: 'BRAND_DELETE',
      entity: 'Brand',
      entityId: id,
      before: brand,
    });
  }
}
