import { createHash, randomBytes } from 'node:crypto';
import {
  ConflictException,
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
import { RequestContext } from '../common/request-context.js';
import { isLang } from '../i18n/i18n.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { EntitlementsService } from '../tenancy/entitlements.service.js';
import type { AccessTokenPayload, AuthTokens, AuthUser } from './auth.types.js';

/** Failed password/PIN attempts before the account is locked. */
export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;

const userWithGroup = {
  group: true,
  branches: { select: { branchId: true } },
} as const;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthService {
  /** Verified for unknown e-mails/usernames so timing does not reveal valid accounts. */
  private readonly dummyHash = argon2.hash('not-a-real-password');

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly entitlements: EntitlementsService,
  ) {}

  async login(
    tenantCode: string | undefined,
    email: string | undefined,
    username: string | undefined,
    password: string,
  ): Promise<AuthTokens> {
    // Keep the old username request shape working for existing API clients.
    if (!email) {
      await this.enterTenant(tenantCode);
      const user = await this.verifyCredential(username!, (u) =>
        argon2.verify(u.passwordHash, password),
      );
      return this.issueTokens(
        user.id,
        this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * 24,
      );
    }

    const defaultTenant = this.config.get('DEFAULT_TENANT_CODE', {
      infer: true,
    });
    if (tenantCode || defaultTenant) {
      await this.enterTenant(tenantCode);
      const user = await this.verifyEmailCredential(email, password);
      return this.issueTokens(
        user.id,
        this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * 24,
      );
    }

    const users = await RequestContext.asPlatform(() =>
      this.prisma.user.findMany({
        where: { email, isActive: true, tenant: { isActive: true } },
        include: { tenant: { select: { code: true, name: true } } },
      }),
    );
    if (!users.length) {
      await argon2.verify(await this.dummyHash, 'x');
      throw this.invalidCredentials('Invalid e-mail or password');
    }

    const now = Date.now();
    const unlocked = users.filter(
      (user) => !user.lockedUntil || user.lockedUntil.getTime() <= now,
    );
    const matches: typeof users = [];
    for (const user of unlocked) {
      if (await argon2.verify(user.passwordHash, password)) matches.push(user);
    }

    if (!matches.length) {
      if (!unlocked.length) {
        const lockedUntil = users
          .map((user) => user.lockedUntil)
          .filter((value): value is Date => !!value)
          .sort((a, b) => b.getTime() - a.getTime())[0];
        throw new HttpException(
          { message: 'Account is temporarily locked', lockedUntil },
          HttpStatus.LOCKED,
        );
      }
      await RequestContext.asPlatform(() =>
        Promise.all(
          unlocked.map(async (user) => {
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
          }),
        ),
      );
      throw this.invalidCredentials('Invalid e-mail or password');
    }

    if (matches.length > 1) {
      const companyMap = new Map(
        matches.map((user) => [user.tenant.code, user.tenant]),
      );
      throw new ConflictException({
        message: 'Choose the company to sign in to',
        code: 'TENANT_REQUIRED',
        companies: [...companyMap.values()],
      });
    }

    const user = matches[0];
    await this.enterTenant(user.tenant.code);
    if (user.failedLoginCount > 0 || user.lockedUntil) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
    }
    return this.issueTokens(
      user.id,
      this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * 24,
    );
  }

  private invalidCredentials(message: string) {
    return new UnauthorizedException({ message, code: 'INVALID_CREDENTIALS' });
  }

  /** A password-length session for a user already authenticated another way (Google, sign-up). */
  startSession(userId: string): Promise<AuthTokens> {
    return this.issueTokens(
      userId,
      this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * 24,
    );
  }

  /**
   * Sign in with Google: the user linked to this Google account, or with this confirmed
   * e-mail (then linked). Without a company code the account may be in one company only.
   */
  async googleLogin(
    identity: { sub: string; email: string; emailVerified: boolean },
    tenantCode: string | undefined,
  ): Promise<AuthTokens> {
    // A Google account is global: without a code, look in every company.
    const code = tenantCode;
    const matches = await RequestContext.asPlatform(() =>
      this.prisma.user.findMany({
        where: {
          isActive: true,
          tenant: { isActive: true, ...(code && { code }) },
          OR: [
            { googleSub: identity.sub },
            ...(identity.emailVerified
              ? [{ email: identity.email, emailVerifiedAt: { not: null } }]
              : []),
          ],
        },
        include: { tenant: { select: { code: true, name: true } } },
        take: 20,
      }),
    );
    if (matches.length === 0) {
      throw new UnauthorizedException({
        message: 'No account uses this Google account',
        code: 'GOOGLE_ACCOUNT_UNKNOWN',
      });
    }
    const companies = new Map(matches.map((u) => [u.tenantId, u.tenant]));
    if (companies.size > 1) {
      throw new ConflictException({
        message: 'This Google account is in several companies; choose one',
        code: 'TENANT_REQUIRED',
        companies: [...companies.values()],
      });
    }
    // Prefer the account already linked to this Google id.
    const user =
      matches.find((u) => u.googleSub === identity.sub) ?? matches[0];
    if (matches.length > 1 && user.googleSub !== identity.sub) {
      throw new ConflictException({
        message: 'Several users share this e-mail; sign in with the password',
        code: 'GOOGLE_ACCOUNT_AMBIGUOUS',
      });
    }
    await this.enterTenant(user.tenant.code);
    if (user.googleSub !== identity.sub) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { googleSub: identity.sub },
      });
    }
    return this.startSession(user.id);
  }

  /** Links the signed-in user to a Google account (confirms the e-mail when it matches). */
  async linkGoogle(
    userId: string,
    identity: { sub: string; email: string; emailVerified: boolean },
  ): Promise<AuthUser> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        googleSub: identity.sub,
        ...(identity.emailVerified &&
          user.email === identity.email && { emailVerifiedAt: new Date() }),
      },
    });
    return (await this.findActiveUser(userId))!;
  }

  async pinLogin(
    tenantCode: string | undefined,
    username: string,
    pin: string,
  ): Promise<AuthTokens> {
    await this.enterTenant(tenantCode);
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
    // The token row is not tenant-scoped; its user decides the tenant from here on.
    RequestContext.setTenant(stored.user.tenantId);
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

  async updateMe(userId: string, input: { language: string | null }) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { language: input.language },
    });
    return (await this.findActiveUser(userId))!;
  }

  async findActiveUser(id: string): Promise<AuthUser | null> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: userWithGroup,
    });
    if (!user?.isActive) return null;
    return {
      id: user.id,
      tenantId: user.tenantId,
      username: user.username,
      fullName: user.fullName,
      groupId: user.groupId,
      groupName: user.group.name,
      permissions: user.group.permissions,
      branchIds: user.branches.length
        ? user.branches.map((b) => b.branchId)
        : null,
      email: user.email,
      emailVerified: user.emailVerifiedAt !== null,
      googleLinked: user.googleSub !== null,
      language: user.language,
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
   * account is locked for LOCK_MINUTES. Errors never say whether the account exists.
   */
  async verifyCredential(
    username: string,
    check: (user: User) => Promise<boolean>,
  ) {
    const user = await this.prisma.user.findFirst({ where: { username } });
    return this.verifyUserCredential(user, check);
  }

  private async verifyEmailCredential(email: string, password: string) {
    const user = await this.prisma.user.findFirst({ where: { email } });
    return this.verifyUserCredential(user, (candidate) =>
      argon2.verify(candidate.passwordHash, password),
    );
  }

  private async verifyUserCredential(
    user: User | null,
    check: (user: User) => Promise<boolean>,
    invalidMessage = 'Invalid username or credentials',
  ) {
    if (!user || !user.isActive) {
      await argon2.verify(await this.dummyHash, 'x');
      throw this.invalidCredentials(invalidMessage);
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
      throw this.invalidCredentials(invalidMessage);
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
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: user.tenantId },
      select: { code: true },
    });

    const expiresIn = this.config.get('ACCESS_TOKEN_TTL', { infer: true });
    const payload: AccessTokenPayload = {
      sub: user.id,
      tid: user.tenantId,
      typ: 'access',
    };
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

    return {
      accessToken,
      refreshToken,
      expiresIn,
      tenantCode: tenant.code,
      user,
    };
  }

  /**
   * Resolves the company a login is for and scopes the rest of the request to it. Unknown
   * and inactive companies get the same error as a wrong password.
   */
  private async enterTenant(code: string | undefined): Promise<void> {
    const tenantCode =
      code ?? this.config.get('DEFAULT_TENANT_CODE', { infer: true });
    const tenant = tenantCode
      ? await this.prisma.tenant.findUnique({ where: { code: tenantCode } })
      : null;
    if (!tenant?.isActive) {
      await argon2.verify(await this.dummyHash, 'x');
      throw new UnauthorizedException({
        message: 'Invalid sign-in details',
        code: 'INVALID_CREDENTIALS',
      });
    }
    const e = await this.entitlements.get(tenant.id);
    this.entitlements.assertNotBlocked(e);
    const store = RequestContext.get();
    if (store && isLang(e.defaultLanguage))
      store.tenantLang = e.defaultLanguage;
    RequestContext.setTenant(tenant.id);
  }

  private async revokeAllSessions(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
