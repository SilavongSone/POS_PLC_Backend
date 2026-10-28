import { ConflictException, Injectable } from '@nestjs/common';
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

  list(includeInactive = false) {
    return this.prisma.branch.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { code: 'asc' },
      include: { _count: { select: { registers: true } } },
    });
  }

  get(id: string) {
    return this.prisma.branch.findUniqueOrThrow({ where: { id } });
  }

  async create(input: CreateBranchInput, actorId: string) {
    if (input.isActive) await this.entitlements.assertLimit('maxBranches');
    const branch = await this.prisma.branch.create({ data: input });
    await this.audit.log({
      userId: actorId,
      action: 'BRANCH_CREATE',
      entity: 'Branch',
      entityId: branch.id,
      after: branch,
    });
    return branch;
  }

  async update(id: string, input: UpdateBranchInput, actorId: string) {
    const before = await this.get(id);
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
