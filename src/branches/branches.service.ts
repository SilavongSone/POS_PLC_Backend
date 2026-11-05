import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { AuditService } from '../common/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateBranchInput,
  UpdateBranchInput,
} from './branches.schemas.js';
import { EntitlementsService } from '../tenancy/entitlements.service.js';

@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
  ) {}

  /** Branches; `only` = the user's assigned branches (null = every branch). */
  list(includeInactive = false, only: string[] | null = null) {
    return this.prisma.branch.findMany({
      where: {
        ...(!includeInactive && { isActive: true }),
        ...(only && { id: { in: only } }),
      },
      orderBy: { code: 'asc' },
      include: { _count: { select: { registers: true } } },
    });
  }

  /** Every active branch with just its name: where a transfer can be sent. */
  targets() {
    return this.prisma.branch.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true },
    });
  }

  get(id: string) {
    return this.prisma.branch.findUniqueOrThrow({ where: { id } });
  }

  /** The rate must be an active rate of this company. */
  private async assertTaxRate(taxRateId: string | null | undefined) {
    if (!taxRateId) return;
    const rate = await this.prisma.taxRate.findFirst({
      where: { id: taxRateId, isActive: true },
    });
    if (!rate)
      throw new BadRequestException({
        message: 'Choose an active VAT rate',
        code: 'TAX_RATE_INVALID',
      });
  }

  async create(input: CreateBranchInput, actorId: string) {
    await this.assertTaxRate(input.taxRateId);
    if (input.isActive) await this.entitlements.assertLimit('maxBranches');
    const branch = await this.prisma.branch.create({ data: input });
    await this.audit.log({
      userId: actorId,
      action: 'BRANCH_CREATE',
      entity: 'Branch',
      entityId: branch.id,
      after: branch,
    });
    await this.addFirstRegister(branch.id);
    return branch;
  }

  /**
   * A new branch gets a till right away (code R2, R3 … free in the company), so its staff can
   * sell without asking an admin first. Skipped when the plan has no register left.
   */
  private async addFirstRegister(branchId: string) {
    try {
      await this.entitlements.assertLimit('maxRegisters');
    } catch {
      return;
    }
    const codes = new Set(
      (await this.prisma.register.findMany({ select: { code: true } })).map(
        (r) => r.code,
      ),
    );
    let n = 1;
    while (codes.has(`R${n}`)) n++;
    await this.prisma.register.create({
      data: {
        code: `R${n}`,
        name: 'Counter 1',
        branchId,
        printer: { connection: 'usb', paperWidth: 80, openDrawer: true },
      },
    });
  }

  async update(id: string, input: UpdateBranchInput, actorId: string) {
    const before = await this.get(id);
    await this.assertTaxRate(input.taxRateId);
    if (input.isActive && !before.isActive)
      await this.entitlements.assertLimit('maxBranches');
    if (input.isActive === false && before.isActive) {
      const others = await this.prisma.branch.count({
        where: { isActive: true, id: { not: id } },
      });
      if (others === 0)
        throw new ConflictException('The last active branch cannot be closed');
      const openShifts = await this.prisma.shift.count({
        where: { status: 'OPEN', register: { branchId: id } },
      });
      if (openShifts > 0)
        throw new ConflictException(
          'Close the open shifts of this branch first',
        );
    }
    const branch = await this.prisma.branch.update({
      where: { id },
      data: input,
    });
    await this.audit.log({
      userId: actorId,
      action: 'BRANCH_UPDATE',
      entity: 'Branch',
      entityId: id,
      before,
      after: branch,
    });
    return branch;
  }
}
