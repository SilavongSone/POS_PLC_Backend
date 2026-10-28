import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { AuditService } from '../common/audit.service.js';
import { ALL_PERMISSIONS } from '../common/permissions.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateGroupInput, UpdateGroupInput } from './users.schemas.js';

@Injectable()
export class UserGroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const groups = await this.prisma.userGroup.findMany({
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { users: true } } },
    });
    return groups.map(({ _count, ...g }) => ({
      ...g,
      userCount: _count.users,
    }));
  }

  async create(input: CreateGroupInput, actorId: string) {
    const group = await this.prisma.userGroup.create({ data: input });
    await this.audit.log({
      userId: actorId,
      action: 'GROUP_CREATE',
      entity: 'UserGroup',
      entityId: group.id,
      after: group,
    });
    return group;
  }

  async update(id: string, input: UpdateGroupInput, actorId: string) {
    const before = await this.prisma.userGroup.findUniqueOrThrow({
      where: { id },
    });
    if (before.isSystem && input.name && input.name !== before.name) {
      throw new BadRequestException('Built-in groups cannot be renamed');
    }
    // Keeps at least one group able to manage everything.
    if (
      before.permissions.includes(ALL_PERMISSIONS) &&
      input.permissions &&
      !input.permissions.includes(ALL_PERMISSIONS)
    ) {
      const others = await this.prisma.userGroup.count({
        where: { id: { not: id }, permissions: { has: ALL_PERMISSIONS } },
      });
      if (others === 0) {
        throw new ConflictException(
          'At least one group must keep full access ("*")',
        );
      }
    }

    const group = await this.prisma.userGroup.update({
      where: { id },
      data: input,
    });
    await this.audit.log({
      userId: actorId,
      action: 'GROUP_UPDATE',
      entity: 'UserGroup',
      entityId: id,
      before,
      after: group,
    });
    return group;
  }

  async remove(id: string, actorId: string) {
    const group = await this.prisma.userGroup.findUniqueOrThrow({
      where: { id },
      include: { _count: { select: { users: true } } },
    });
    if (group.isSystem) {
      throw new BadRequestException('Built-in groups cannot be deleted');
    }
    if (group._count.users > 0) {
      throw new ConflictException('Move the users to another group first');
    }
    await this.prisma.userGroup.delete({ where: { id } });
    await this.audit.log({
      userId: actorId,
      action: 'GROUP_DELETE',
      entity: 'UserGroup',
      entityId: id,
      before: group,
    });
  }
}
