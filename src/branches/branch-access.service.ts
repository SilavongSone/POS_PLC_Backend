import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Which branches a user may work in. A user with no UserBranch rows (branchIds = null)
 * may use every branch of the company.
 */
@Injectable()
export class BranchAccessService {
  constructor(private readonly prisma: PrismaService) {}

  assertAccess(user: AuthUser, branchId: string): void {
    if (user.branchIds && !user.branchIds.includes(branchId)) {
      throw new ForbiddenException({
        message: 'You do not have access to this branch',
        code: 'BRANCH_FORBIDDEN',
      });
    }
  }

  /**
   * The branch a back-office action (stock document, repair ticket …) happens at: the one
   * given, or — when omitted — the only branch the user can use.
   */
  async resolve(
    user: AuthUser,
    branchId?: string | null,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    const db = tx ?? this.prisma;
    if (branchId) {
      const branch = await db.branch.findFirst({
        where: { id: branchId, isActive: true },
        select: { id: true },
      });
      if (!branch) throw new NotFoundException('Branch not found');
      this.assertAccess(user, branchId);
      return branchId;
    }
    const usable = await db.branch.findMany({
      where: {
        isActive: true,
        ...(user.branchIds && { id: { in: user.branchIds } }),
      },
      select: { id: true },
      take: 2,
    });
    if (usable.length === 1) return usable[0].id;
    throw new BadRequestException({
      message: 'Choose a branch (branchId)',
      code: 'BRANCH_REQUIRED',
    });
  }

  /**
   * Branch filter for lists and reports: the requested branch (if allowed), else the
   * user's branches, else undefined = every branch.
   */
  scope(user: AuthUser, branchId?: string): string[] | undefined {
    if (branchId) {
      this.assertAccess(user, branchId);
      return [branchId];
    }
    return user.branchIds ?? undefined;
  }
}
