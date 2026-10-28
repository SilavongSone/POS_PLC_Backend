import { ConflictException, Injectable } from '@nestjs/common';
import { AuditService } from '../common/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateBrandInput, UpdateBrandInput } from './catalog.schemas.js';

@Injectable()
export class BrandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const rows = await this.prisma.brand.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: true } } },
    });
    return rows.map(({ _count, ...b }) => ({
      ...b,
      productCount: _count.products,
    }));
  }

  async create(input: CreateBrandInput, actorId: string) {
    const brand = await this.prisma.brand.create({ data: input });
    await this.audit.log({
      userId: actorId,
      action: 'BRAND_CREATE',
      entity: 'Brand',
      entityId: brand.id,
      after: brand,
    });
    return brand;
  }

  async update(id: string, input: UpdateBrandInput, actorId: string) {
    const before = await this.prisma.brand.findUniqueOrThrow({ where: { id } });
    const brand = await this.prisma.brand.update({
      where: { id },
      data: input,
    });
    await this.audit.log({
      userId: actorId,
      action: 'BRAND_UPDATE',
      entity: 'Brand',
      entityId: id,
      before,
      after: brand,
    });
    return brand;
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
    await this.audit.log({
      userId: actorId,
      action: 'BRAND_DELETE',
      entity: 'Brand',
      entityId: id,
      before: brand,
    });
  }
}
