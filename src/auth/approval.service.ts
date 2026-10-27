import { ForbiddenException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import { hasPermission, type Permission } from '../common/permissions.js';
import { AuthService } from './auth.service.js';
import type { ApprovalTokenPayload, AuthUser } from './auth.types.js';

/** Approval tokens are valid this long — enough to finish one action at the till. */
export const APPROVAL_TTL_SECONDS = 120;

export type Approval = {
  approvalToken: string;
  expiresIn: number;
  permission: Permission;
  approver: { id: string; fullName: string };
};

/**
 * Manager approval at the till: a manager enters their username + PIN (or password)
 * on the cashier's screen, and the cashier gets a short-lived token for one permission.
 */
@Injectable()
export class ApprovalService {
  constructor(
    private readonly auth: AuthService,
    private readonly jwt: JwtService,
  ) {}

  async approve(
    requester: AuthUser,
    input: {
      username: string;
      pin?: string;
      password?: string;
      permission: Permission;
    },
  ): Promise<Approval> {
    const approverRow = await this.auth.verifyCredential(
      input.username,
      (u) => {
        if (input.pin)
          return u.pinHash
            ? argon2.verify(u.pinHash, input.pin)
            : Promise.resolve(false);
        return argon2.verify(u.passwordHash, input.password ?? '');
      },
    );
    const approver = await this.auth.findActiveUser(approverRow.id);
    if (!approver || !hasPermission(approver.permissions, input.permission)) {
      throw new ForbiddenException(
        `${input.username} cannot approve ${input.permission}`,
      );
    }

    const payload: ApprovalTokenPayload = {
      sub: approver.id,
      tid: approver.tenantId,
      typ: 'approval',
      perm: input.permission,
      req: requester.id,
    };
    return {
      approvalToken: await this.jwt.signAsync(payload, {
        expiresIn: APPROVAL_TTL_SECONDS,
      }),
      expiresIn: APPROVAL_TTL_SECONDS,
      permission: input.permission,
      approver: { id: approver.id, fullName: approver.fullName },
    };
  }

  /**
   * Returns who authorized `permission` for `user`: the user themselves when they hold it,
   * otherwise the manager behind a valid approval token issued to this user.
   */
  async authorize(
    user: AuthUser,
    permission: Permission,
    approvalToken?: string,
  ): Promise<string> {
    if (hasPermission(user.permissions, permission)) return user.id;
    if (!approvalToken) {
      throw new ForbiddenException({
        message: `Manager approval required: ${permission}`,
        code: 'APPROVAL_REQUIRED',
        permission,
      });
    }

    let payload: ApprovalTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<ApprovalTokenPayload>(approvalToken);
    } catch {
      throw new ForbiddenException('Approval expired or invalid');
    }
    if (
      payload.typ !== 'approval' ||
      payload.tid !== user.tenantId ||
      payload.perm !== permission ||
      payload.req !== user.id
    ) {
      throw new ForbiddenException('Approval does not match this action');
    }
    // The approver may have been deactivated or lost the permission since.
    const approver = await this.auth.findActiveUser(payload.sub);
    if (!approver || !hasPermission(approver.permissions, permission)) {
      throw new ForbiddenException('Approver no longer has this permission');
    }
    return approver.id;
  }
}
