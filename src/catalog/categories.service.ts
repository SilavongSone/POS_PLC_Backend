import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { AuditService } from '../common/audit.service.js';
import type { Category } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateCategoryInput,
  UpdateCategoryInput,
} from './catalog.schemas.js';

export type CategoryNode = Category & {
  productCount: number;
  children: CategoryNode[];
};

/** "Receipt Printers (Thermal)" → "receipt-printers-thermal" */
export function slugify(name: string): string {
  return (
    name
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'category'
  );
}

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<(Category & { productCount: number })[]> {
    const rows = await this.prisma.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { products: true } } },
    });
    return rows.map(({ _count, ...c }) => ({
      ...c,
      productCount: _count.products,
    }));
  }

  async tree(): Promise<CategoryNode[]> {
    const nodes = new Map<string, CategoryNode>();
    const list = await this.list();
    for (const c of list) nodes.set(c.id, { ...c, children: [] });
    const roots: CategoryNode[] = [];
    for (const node of nodes.values()) {
      const parent = node.parentId ? nodes.get(node.parentId) : undefined;
      (parent ? parent.children : roots).push(node);
    }
    return roots;
  }

  /** The category and all categories below it. */
  async withDescendants(id: string): Promise<string[]> {
    const all = await this.prisma.category.findMany({
      select: { id: true, parentId: true },
    });
    const result = [id];
    for (let i = 0; i < result.length; i++) {
      for (const c of all) if (c.parentId === result[i]) result.push(c.id);
    }
    return result;
  }

  async create(input: CreateCategoryInput, actorId: string) {
    if (input.parentId) {
      await this.prisma.category.findUniqueOrThrow({
        where: { id: input.parentId },
      });
    }
    const category = await this.prisma.category.create({
      data: { ...input, slug: input.slug ?? slugify(input.name) },
    });
    await this.audit.log({
      userId: actorId,
      action: 'CATEGORY_CREATE',
      entity: 'Category',
      entityId: category.id,
      after: category,
    });
    return category;
  }

  async update(id: string, input: UpdateCategoryInput, actorId: string) {
    const before = await this.prisma.category.findUniqueOrThrow({
      where: { id },
    });
    if (input.parentId) {
      const below = await this.withDescendants(id);
      if (below.includes(input.parentId)) {
        throw new BadRequestException(
          'A category cannot be moved under itself or its subcategories',
        );
      }
    }
    const category = await this.prisma.category.update({
      where: { id },
      data: input,
    });
    await this.audit.log({
      userId: actorId,
      action: 'CATEGORY_UPDATE',
      entity: 'Category',
      entityId: id,
      before,
      after: category,
    });
    return category;
  }

  async remove(id: string, actorId: string) {
    const category = await this.prisma.category.findUniqueOrThrow({
      where: { id },
      include: { _count: { select: { products: true, children: true } } },
    });
    if (category._count.products || category._count.children) {
      throw new ConflictException(
        'Move its products and subcategories first, or deactivate it instead',
      );
    }
    await this.prisma.category.delete({ where: { id } });
    await this.audit.log({
      userId: actorId,
      action: 'CATEGORY_DELETE',
      entity: 'Category',
      entityId: id,
      before: category,
    });
  }
}
