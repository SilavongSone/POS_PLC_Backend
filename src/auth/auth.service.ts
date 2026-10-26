import { createHash, randomBytes } from 'node:crypto';
import {
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import type { Env } from '../config/env.js';
import type { User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AccessTokenPayload, AuthTokens, AuthUser } from './auth.types.js';

/** Failed password/PIN attempts before the account is locked. */
export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;

const userWithGroup = { group: true } as const;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthService {
  /** Verified against when the username is unknown, so response time doesn't reveal valid usernames. */
  private readonly dummyHash = argon2.hash('not-a-real-password');

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async login(username: string, password: string): Promise<AuthTokens> {
    const user = await this.verifyCredential(username, (u) =>
      argon2.verify(u.passwordHash, password),
    );
    return this.issueTokens(
      user.id,
      this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * 24,
    );
  }

  async pinLogin(username: string, pin: string): Promise<AuthTokens> {
    const user = await this.verifyCredential(username, (u) =>
      u.pinHash ? argon2.verify(u.pinHash, pin) : Promise.resolve(false),
    );
    return this.issueTokens(
      user.id,
      this.config.get('PIN_SESSION_TTL_HOURS', { infer: true }),
    );
  }

  /** Rotates a refresh token. Presenting an already-used token revokes every session of that user. */
  async refresh(refreshToken: string): Promise<AuthTokens> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
      include: { user: true },
    });
    if (!stored || stored.expiresAt <= new Date() || !stored.user.isActive) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (stored.revokedAt) {
      // Reuse of a rotated token means it may have been stolen.
      await this.revokeAllSessions(stored.userId);
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    // Revoke only if still unrevoked, so two concurrent refreshes can't both succeed.
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) throw new UnauthorizedException('Invalid refresh token');

    // The new session ends when the old one would have.
    const hoursLeft = (stored.expiresAt.getTime() - Date.now()) / 3_600_000;
    return this.issueTokens(stored.userId, hoursLeft);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Changes the password and signs the user out everywhere. */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    await this.verifyPassword(userId, currentPassword);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await argon2.hash(newPassword) },
    });
    await this.revokeAllSessions(userId);
  }

  async setPin(
    userId: string,
    currentPassword: string,
    pin: string,
  ): Promise<void> {
    await this.verifyPassword(userId, currentPassword);
    await this.prisma.user.update({
      where: { id: userId },
      data: { pinHash: await argon2.hash(pin) },
    });
  }

  async findActiveUser(id: string): Promise<AuthUser | null> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: userWithGroup,
    });
    if (!user?.isActive) return null;
    return {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      groupId: user.groupId,
      groupName: user.group.name,
      permissions: user.group.permissions,
    };
  }

  private async verifyPassword(userId: string, password: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    if (!(await argon2.verify(user.passwordHash, password))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
  }

  /**
   * Checks a password or PIN with lockout: after MAX_FAILED_LOGINS wrong attempts the
   * account is locked for LOCK_MINUTES. Errors never say whether the username exists.
   */
  async verifyCredential(
    username: string,
    check: (user: User) => Promise<boolean>,
  ) {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user || !user.isActive) {
      await argon2.verify(await this.dummyHash, 'x');
      throw new UnauthorizedException('Invalid username or credentials');
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new HttpException(
        {
          message: 'Account is temporarily locked',
          lockedUntil: user.lockedUntil,
        },
        HttpStatus.LOCKED,
      );
    }

    if (!(await check(user))) {
      const failed = user.failedLoginCount + 1;
      const lock = failed >= MAX_FAILED_LOGINS;
      await this.prisma.user.update({
        where: { id: user.id },
        data: lock
          ? {
              failedLoginCount: 0,
              lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000),
            }
          : { failedLoginCount: failed },
      });
      throw new UnauthorizedException('Invalid username or credentials');
    }

    if (user.failedLoginCount > 0 || user.lockedUntil) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
    }
    return user;
  }

  private async issueTokens(
    userId: string,
    refreshTtlHours: number,
  ): Promise<AuthTokens> {
    const user = await this.findActiveUser(userId);
    if (!user) throw new UnauthorizedException('User is inactive or missing');

    const expiresIn = this.config.get('ACCESS_TOKEN_TTL', { infer: true });
    const payload: AccessTokenPayload = { sub: user.id, typ: 'access' };
    const accessToken = await this.jwt.signAsync(payload, { expiresIn });

    // Housekeeping: drop this user's expired tokens. Revoked ones are kept until they
    // expire so reuse of a rotated token is still detected.
    await this.prisma.refreshToken.deleteMany({
      where: { userId: user.id, expiresAt: { lt: new Date() } },
    });
    const refreshToken = randomBytes(32).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + refreshTtlHours * 3_600_000),
      },
    });

    return { accessToken, refreshToken, expiresIn, user };
  }

  private async revokeAllSessions(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
