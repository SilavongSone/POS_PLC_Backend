import { Injectable } from '@nestjs/common';
import { AuditService } from '../common/audit.service.js';
import { pageArgs, toPage, type PageQuery } from '../common/pagination.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateSupplierInput,
  UpdateSupplierInput,
} from './stock.schemas.js';

@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: PageQuery) {
    const where: Prisma.SupplierWhereInput = query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: 'insensitive' } },
            { phone: { contains: query.q } },
          ],
        }
      : {};
    const [items, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where,
        orderBy: { name: 'asc' },
        ...pageArgs(query),
      }),
      this.prisma.supplier.count({ where }),
    ]);
    return toPage(items, total, query);
  }

  get(id: string) {
    return this.prisma.supplier.findUniqueOrThrow({ where: { id } });
  }

  async create(input: CreateSupplierInput, actorId: string) {
    const supplier = await this.prisma.supplier.create({ data: input });
    await this.audit.log({
      userId: actorId,
      action: 'SUPPLIER_CREATE',
      entity: 'Supplier',
      entityId: supplier.id,
      after: supplier,
    });
    return supplier;
  }

  async update(id: string, input: UpdateSupplierInput, actorId: string) {
    const before = await this.get(id);
    const supplier = await this.prisma.supplier.update({
      where: { id },
      data: input,
    });
    await this.audit.log({
      userId: actorId,
      action: 'SUPPLIER_UPDATE',
      entity: 'Supplier',
      entityId: id,
      before,
      after: supplier,
    });
    return supplier;
  }
}
