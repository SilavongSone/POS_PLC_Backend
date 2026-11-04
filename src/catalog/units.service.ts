import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../common/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  ORDER_STEP,
  type CreateUnitInput,
  type ReorderInput,
  type UpdateUnitInput,
} from './catalog.schemas.js';

/** Units of sale. Products store the unit's name, so a rename is applied to them too. */
@Injectable()
export class UnitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const [units, usage] = await Promise.all([
      this.prisma.unit.findMany({
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.product.groupBy({ by: ['unit'], _count: true }),
    ]);
    const count = new Map(usage.map((u) => [u.unit, u._count]));
    // `code` keeps the stored name: the response translator replaces `name`.
    return units.map((u) => ({
      ...u,
      code: u.name,
      productCount: count.get(u.name) ?? 0,
    }));
  }

  private async assertFree(name: string, exceptId?: string) {
    const taken = await this.prisma.unit.findFirst({
      where: { name, ...(exceptId && { id: { not: exceptId } }) },
    });
    if (taken) {
      throw new ConflictException({
        message: 'This unit already exists',
        code: 'UNIT_EXISTS',
      });
    }
  }

  async create(input: CreateUnitInput, actorId: string) {
    await this.assertFree(input.name);
    const last = await this.prisma.unit.findFirst({
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const unit = await this.prisma.unit.create({
      data: {
        ...input,
        sortOrder: input.sortOrder ?? (last ? last.sortOrder + ORDER_STEP : 0),
      },
    });
    await this.audit.log({
      userId: actorId,
      action: 'UNIT_CREATE',
      entity: 'Unit',
      entityId: unit.id,
      after: unit,
    });
    return unit;
  }

  async reorder({ ids }: ReorderInput, actorId: string) {
    const found = await this.prisma.unit.count({ where: { id: { in: ids } } });
    if (found !== ids.length) throw new NotFoundException();
    await this.prisma.$transaction(
      ids.map((id, i) =>
        this.prisma.unit.update({
          where: { id },
          data: { sortOrder: (i + 1) * ORDER_STEP },
        }),
      ),
    );
    await this.audit.log({
      userId: actorId,
      action: 'UNIT_REORDER',
      entity: 'Unit',
      after: { ids },
    });
  }

  async update(id: string, input: UpdateUnitInput, actorId: string) {
    const before = await this.prisma.unit.findUniqueOrThrow({ where: { id } });
    const renamed = !!input.name && input.name !== before.name;
    if (renamed) await this.assertFree(input.name!, id);
    const unit = await this.prisma.$transaction(async (tx) => {
      if (renamed) {
        await tx.product.updateMany({
          where: { unit: before.name },
          data: { unit: input.name },
        });
      }
      return tx.unit.update({ where: { id }, data: input });
    });
    await this.audit.log({
      userId: actorId,
      action: 'UNIT_UPDATE',
      entity: 'Unit',
      entityId: id,
      before,
      after: unit,
    });
    return unit;
  }

  async remove(id: string, actorId: string) {
    const unit = await this.prisma.unit.findUniqueOrThrow({ where: { id } });
    const used = await this.prisma.product.count({
      where: { unit: unit.name },
    });
    if (used) {
      throw new ConflictException({
        message:
          'Products still use this unit; change them first or switch it off',
        code: 'UNIT_IN_USE',
        count: used,
      });
    }
    await this.prisma.unit.delete({ where: { id } });
    await this.audit.log({
      userId: actorId,
      action: 'UNIT_DELETE',
      entity: 'Unit',
      entityId: id,
      before: unit,
    });
  }

  /** A product saved with a unit not in the list adds it, so the list stays complete. */
  async ensure(name: string) {
    if (!(await this.prisma.unit.findFirst({ where: { name } }))) {
      await this.prisma.unit.create({ data: { name, sortOrder: 100 } });
    }
  }
}
