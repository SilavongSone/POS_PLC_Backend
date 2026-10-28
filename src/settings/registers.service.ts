import { ConflictException, Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { BranchAccessService } from '../branches/branch-access.service.js';
import { AuditService } from '../common/audit.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateRegisterInput,
  UpdateRegisterInput,
} from './settings.schemas.js';
import { EntitlementsService } from '../tenancy/entitlements.service.js';

const withOpenShift = {
  shifts: {
    where: { status: 'OPEN' },
    select: {
      id: true,
      openedAt: true,
      user: { select: { id: true, fullName: true } },
    },
  },
} satisfies Prisma.RegisterInclude;

const branchSelect = { id: true, code: true, name: true } as const;

function printerData(printer: CreateRegisterInput['printer']) {
  if (printer === undefined) return undefined;
  return printer === null ? Prisma.DbNull : printer;
}

@Injectable()
export class RegistersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly branches: BranchAccessService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async list() {
    const registers = await this.prisma.register.findMany({
      orderBy: { code: 'asc' },
      include: { ...withOpenShift, branch: { select: branchSelect } },
    });
    return registers.map(({ shifts, ...r }) => ({
      ...r,
      openShift: shifts[0] ?? null,
    }));
  }

  async get(id: string) {
    const { shifts, ...register } =
      await this.prisma.register.findUniqueOrThrow({
        where: { id },
        include: { ...withOpenShift, branch: { select: branchSelect } },
      });
    return { ...register, openShift: shifts[0] ?? null };
  }

  async create(input: CreateRegisterInput, actor: AuthUser) {
    const branchId = await this.branches.resolve(actor, input.branchId);
    if (input.isActive) await this.entitlements.assertLimit('maxRegisters');
    const register = await this.prisma.register.create({
      data: { ...input, branchId, printer: printerData(input.printer) },
    });
    await this.audit.log({
      userId: actor.id,
      action: 'REGISTER_CREATE',
      entity: 'Register',
      entityId: register.id,
      after: register,
    });
    return register;
  }

  async update(id: string, input: UpdateRegisterInput, actor: AuthUser) {
    const before = await this.get(id);
    this.branches.assertAccess(actor, before.branchId);
    const moving = input.branchId && input.branchId !== before.branchId;
    if ((input.isActive === false || moving) && before.openShift) {
      throw new ConflictException(
        'Close the open shift on this register first',
      );
    }
    if (moving) await this.branches.resolve(actor, input.branchId);
    const register = await this.prisma.register.update({
      where: { id },
      data: { ...input, printer: printerData(input.printer) },
    });
    await this.audit.log({
      userId: actor.id,
      action: 'REGISTER_UPDATE',
      entity: 'Register',
      entityId: id,
      before,
      after: register,
    });
    return register;
  }
}
