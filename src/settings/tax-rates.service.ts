import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditService } from '../common/audit.service.js';
import type { Prisma, TaxRate } from '../generated/prisma/client.js';
import { TtlCache } from '../common/ttl-cache.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateTaxRateInput,
  UpdateTaxRateInput,
} from './settings.schemas.js';

@Injectable()
export class TaxRatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.taxRate.findMany({
      orderBy: [{ isDefault: 'desc' }, { percent: 'desc' }],
    });
  }

  private readonly cache = new TtlCache<TaxRate | null>(10_000);

  /** The VAT rate applied to new sales; null when none is set. Cached briefly. */
  getDefault(_tx?: Prisma.TransactionClient): Promise<TaxRate | null> {
    return this.cache.get('default', () =>
      this.prisma.taxRate.findFirst({
        where: { isDefault: true, isActive: true },
      }),
    );
  }

  /** The branch's own active rate, else the company default. */
  async forBranch(
    branchId: string | undefined,
    db: Prisma.TransactionClient,
  ): Promise<TaxRate | null> {
    if (branchId) {
      const branch = await db.branch.findFirst({
        where: { id: branchId },
        select: { taxRate: true },
      });
      if (branch?.taxRate?.isActive) return branch.taxRate;
    }
    return this.getDefault(db);
  }

  async create(input: CreateTaxRateInput, actorId: string) {
    const rate = await this.prisma.taxRate.create({ data: input });
    await this.log(actorId, 'TAX_RATE_CREATE', rate.id, undefined, rate);
    return rate;
  }

  async update(id: string, input: UpdateTaxRateInput, actorId: string) {
    const before = await this.prisma.taxRate.findUniqueOrThrow({
      where: { id },
    });
    if (before.isDefault && input.isActive === false) {
      throw new BadRequestException(
        'Choose another default VAT rate before deactivating this one',
      );
    }
    const rate = await this.prisma.taxRate.update({
      where: { id },
      data: input,
    });
    await this.log(actorId, 'TAX_RATE_UPDATE', id, before, rate);
    return rate;
  }

  async makeDefault(id: string, actorId: string) {
    const rate = await this.prisma.$transaction(async (tx) => {
      const target = await tx.taxRate.findUniqueOrThrow({ where: { id } });
      if (!target.isActive) {
        throw new BadRequestException('Activate the VAT rate first');
      }
      await tx.taxRate.updateMany({
        where: { isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
      return tx.taxRate.update({ where: { id }, data: { isDefault: true } });
    });
    await this.log(actorId, 'TAX_RATE_DEFAULT', id, undefined, rate);
    return rate;
  }

  private log(
    userId: string,
    action: string,
    entityId: string,
    before: unknown,
    after: unknown,
  ) {
    this.cache.clear();
    return this.audit.log({
      userId,
      action,
      entity: 'TaxRate',
      entityId,
      before,
      after,
    });
  }
}
