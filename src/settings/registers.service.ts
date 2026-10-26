import { ConflictException, Injectable } from '@nestjs/common';
import { AuditService } from '../common/audit.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateRegisterInput,
  UpdateRegisterInput,
} from './settings.schemas.js';

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

function printerData(printer: CreateRegisterInput['printer']) {
  if (printer === undefined) return undefined;
  return printer === null ? Prisma.DbNull : printer;
}

@Injectable()
export class RegistersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const registers = await this.prisma.register.findMany({
      orderBy: { code: 'asc' },
      include: withOpenShift,
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
        include: withOpenShift,
      });
    return { ...register, openShift: shifts[0] ?? null };
  }

  async create(input: CreateRegisterInput, actorId: string) {
    const register = await this.prisma.register.create({
      data: { ...input, printer: printerData(input.printer) },
    });
    await this.audit.log({
      userId: actorId,
      action: 'REGISTER_CREATE',
      entity: 'Register',
      entityId: register.id,
      after: register,
    });
    return register;
  }

  async update(id: string, input: UpdateRegisterInput, actorId: string) {
    const before = await this.get(id);
    if (input.isActive === false && before.openShift) {
      throw new ConflictException(
        'Close the open shift on this register first',
      );
    }
    const register = await this.prisma.register.update({
      where: { id },
      data: { ...input, printer: printerData(input.printer) },
    });
    await this.audit.log({
      userId: actorId,
      action: 'REGISTER_UPDATE',
      entity: 'Register',
      entityId: id,
      before,
      after: register,
    });
    return register;
  }
}
