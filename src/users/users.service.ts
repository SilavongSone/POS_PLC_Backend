import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import argon2 from 'argon2';
import { AuditService } from '../common/audit.service.js';
import { pageArgs, toPage, type Page } from '../common/pagination.js';
import { ALL_PERMISSIONS } from '../common/permissions.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateUserInput,
  ListUsersQuery,
  UpdateUserInput,
} from './users.schemas.js';
import { EntitlementsService } from '../tenancy/entitlements.service.js';
import { AccountService } from '../account/account.service.js';

const userSelect = {
  id: true,
  username: true,
  fullName: true,
  isActive: true,
  pinHash: true,
  failedLoginCount: true,
  lockedUntil: true,
  createdAt: true,
  updatedAt: true,
  language: true,
  email: true,
  emailVerifiedAt: true,
  group: { select: { id: true, name: true } },
  branches: { select: { branchId: true } },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

/** Public shape of a user: never exposes password or PIN hashes. */
export type UserView = Omit<UserRow, 'pinHash' | 'branches'> & {
  hasPin: boolean;
  /** Empty = every branch. */
  branchIds: string[];
};

function toView({ pinHash, branches, ...user }: UserRow): UserView {
  return {
    ...user,
    hasPin: pinHash !== null,
    branchIds: branches.map((b) => b.branchId),
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
    private readonly account: AccountService,
  ) {}

  async list(query: ListUsersQuery): Promise<Page<UserView>> {
    const where: Prisma.UserWhereInput = {
      groupId: query.groupId,
      isActive: query.isActive,
      ...(query.q && {
        OR: [
          { username: { contains: query.q, mode: 'insensitive' } },
          { fullName: { contains: query.q, mode: 'insensitive' } },
        ],
      }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: userSelect,
        orderBy: { username: 'asc' },
        ...pageArgs(query),
      }),
      this.prisma.user.count({ where }),
    ]);
    return toPage(rows.map(toView), total, query);
  }

  async get(id: string): Promise<UserView> {
    return toView(
      await this.prisma.user.findUniqueOrThrow({
        where: { id },
        select: userSelect,
      }),
    );
  }

  async create(input: CreateUserInput, actorId: string): Promise<UserView> {
    await this.prisma.userGroup.findUniqueOrThrow({
      where: { id: input.groupId },
    });
    await this.assertBranches(input.branchIds);
    await this.entitlements.assertLimit('maxUsers');
    const user = await this.prisma.user.create({
      data: {
        username: input.username,
        fullName: input.fullName,
        groupId: input.groupId,
        passwordHash: await argon2.hash(input.password),
        pinHash: input.pin ? await argon2.hash(input.pin) : null,
        language: input.language,
        email: input.email ?? null,
        branches: {
          create: (input.branchIds ?? []).map((branchId) => ({ branchId })),
        },
      },
      select: userSelect,
    });
    if (user.email)
      await this.account.sendVerification({ ...user, email: user.email });
    await this.audit.log({
      userId: actorId,
      action: 'USER_CREATE',
      entity: 'User',
      entityId: user.id,
      after: { username: user.username, group: user.group.name },
    });
    return toView(user);
  }

  /** Branch ids must belong to this company. */
  private async assertBranches(ids?: string[]) {
    if (!ids?.length) return;
    const found = await this.prisma.branch.count({
      where: { id: { in: ids } },
    });
    if (found !== ids.length) throw new BadRequestException('Unknown branch');
  }

  async update(
    id: string,
    input: UpdateUserInput,
    actorId: string,
  ): Promise<UserView> {
    const before = await this.get(id);
    if (id === actorId && (input.isActive === false || input.groupId)) {
      throw new BadRequestException(
        'You cannot deactivate yourself or change your own group',
      );
    }
    if (input.groupId) {
      await this.prisma.userGroup.findUniqueOrThrow({
        where: { id: input.groupId },
      });
    }
    if (input.isActive === false || input.groupId) {
      await this.assertNotLastAdmin(id, input.groupId);
    }

    await this.assertBranches(input.branchIds);
    const { branchIds, ...fields } = input;
    const user = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id },
        data: {
          ...fields,
          // A new address must be confirmed again.
          ...(fields.email !== undefined &&
            fields.email !== before.email && { emailVerifiedAt: null }),
          ...(branchIds && {
            branches: {
              deleteMany: {},
              create: branchIds.map((branchId) => ({ branchId })),
            },
          }),
        },
        select: userSelect,
      });
      if (input.isActive === false) await this.revokeSessions(tx, id);
      return updated;
    });
    if (user.email && user.email !== before.email) {
      await this.account.sendVerification({ ...user, email: user.email });
    }
    await this.audit.log({
      userId: actorId,
      action: 'USER_UPDATE',
      entity: 'User',
      entityId: id,
      before: {
        fullName: before.fullName,
        group: before.group.name,
        isActive: before.isActive,
      },
      after: {
        fullName: user.fullName,
        group: user.group.name,
        isActive: user.isActive,
      },
    });
    return toView(user);
  }

  /** Sets a new password, clears any lock and signs the user out everywhere. */
  async resetPassword(id: string, newPassword: string, actorId: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          passwordHash: await argon2.hash(newPassword),
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
      await this.revokeSessions(tx, id);
    });
    await this.audit.log({
      userId: actorId,
      action: 'USER_PASSWORD_RESET',
      entity: 'User',
      entityId: id,
    });
  }

  async setPin(id: string, pin: string | null, actorId: string) {
    await this.prisma.user.update({
      where: { id },
      data: { pinHash: pin ? await argon2.hash(pin) : null },
    });
    await this.audit.log({
      userId: actorId,
      action: pin ? 'USER_PIN_SET' : 'USER_PIN_CLEAR',
      entity: 'User',
      entityId: id,
    });
  }

  async unlock(id: string, actorId: string): Promise<UserView> {
    const user = await this.prisma.user.update({
      where: { id },
      data: { failedLoginCount: 0, lockedUntil: null },
      select: userSelect,
    });
    await this.audit.log({
      userId: actorId,
      action: 'USER_UNLOCK',
      entity: 'User',
      entityId: id,
    });
    return toView(user);
  }

  /** Refuses to remove the last active user that holds "*" (would lock everyone out of admin). */
  private async assertNotLastAdmin(id: string, newGroupId?: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id },
      include: { group: true },
    });
    if (!user.isActive || !user.group.permissions.includes(ALL_PERMISSIONS)) {
      return;
    }
    if (newGroupId) {
      const target = await this.prisma.userGroup.findUniqueOrThrow({
        where: { id: newGroupId },
      });
      if (target.permissions.includes(ALL_PERMISSIONS)) return;
    }
    const admins = await this.prisma.user.count({
      where: {
        isActive: true,
        group: { permissions: { has: ALL_PERMISSIONS } },
      },
    });
    if (admins <= 1) {
      throw new ConflictException(
        'Cannot remove the last active administrator',
      );
    }
  }

  private async revokeSessions(tx: Prisma.TransactionClient, userId: string) {
    await tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
