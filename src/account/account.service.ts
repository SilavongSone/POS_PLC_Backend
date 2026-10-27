import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import argon2 from 'argon2';
import { RequestContext } from '../common/request-context.js';
import type { Env } from '../config/env.js';
import type { UserTokenPurpose } from '../generated/prisma/client.js';
import { currentLang } from '../i18n/i18n.js';
import { MailService } from '../mail/mail.service.js';
import { mailTemplates } from '../mail/templates.js';
import { PrismaService } from '../prisma/prisma.service.js';

const HOUR = 3_600_000;
const TTL: Record<UserTokenPurpose, number> = {
  VERIFY_EMAIL: 72 * HOUR,
  RESET_PASSWORD: 1 * HOUR,
};

export const hashSecret = (s: string) =>
  createHash('sha256').update(s).digest('hex');

const invalidToken = () =>
  new BadRequestException({
    message: 'The link is invalid or has expired',
    code: 'TOKEN_INVALID',
  });

/** E-mail confirmation and password reset by one-time links. */
@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private link(path: string, token: string) {
    const base = this.config.get('APP_URL', { infer: true }).replace(/\/$/, '');
    return `${base}${path}?token=${encodeURIComponent(token)}`;
  }

  /** Creates a one-time token for the user (current tenant) and returns it. */
  private async issue(
    userId: string,
    email: string,
    purpose: UserTokenPurpose,
  ) {
    const token = randomBytes(32).toString('base64url');
    await this.prisma.userToken.create({
      data: {
        userId,
        email,
        purpose,
        tokenHash: hashSecret(token),
        expiresAt: new Date(Date.now() + TTL[purpose]),
      },
    });
    return token;
  }

  /** Sends a confirmation link to the user's (new) address. */
  async sendVerification(user: {
    id: string;
    email: string;
    fullName: string;
  }) {
    const token = await this.issue(user.id, user.email, 'VERIFY_EMAIL');
    await this.mail.send(
      mailTemplates.verifyEmail(
        currentLang(),
        user.email,
        user.fullName,
        this.link('/verify-email', token),
      ),
    );
  }

  /** Resolves a token (any tenant) and runs `fn` in its tenant. */
  private async useToken<T>(
    token: string,
    purpose: UserTokenPurpose,
    fn: (row: { id: string; userId: string; email: string }) => Promise<T>,
  ): Promise<T> {
    const row = await RequestContext.asPlatform(() =>
      this.prisma.userToken.findUnique({
        where: { tokenHash: hashSecret(token) },
      }),
    );
    if (
      !row ||
      row.purpose !== purpose ||
      row.usedAt ||
      row.expiresAt <= new Date()
    )
      throw invalidToken();
    return RequestContext.withTenant(row.tenantId, async () => {
      const { count } = await this.prisma.userToken.updateMany({
        where: { id: row.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (count === 0) throw invalidToken();
      return fn(row);
    });
  }

  async verifyEmail(token: string): Promise<{ email: string }> {
    return this.useToken(token, 'VERIFY_EMAIL', async (row) => {
      const user = await this.prisma.user.findUnique({
        where: { id: row.userId },
      });
      // The address changed after the link was sent.
      if (!user || user.email !== row.email) throw invalidToken();
      await this.prisma.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: new Date() },
      });
      return { email: row.email };
    });
  }

  /**
   * Sends reset links to the confirmed address in the given company (or, without a
   * code, in every company where it is confirmed). Silent when nothing matches, so the
   * response does not reveal which addresses exist.
   */
  async forgotPassword(tenantCode: string | undefined, email: string) {
    // Without a company code, every company where the address is confirmed.
    const code = tenantCode;
    const users = await RequestContext.asPlatform(() =>
      this.prisma.user.findMany({
        where: {
          email: email.toLowerCase(),
          emailVerifiedAt: { not: null },
          isActive: true,
          tenant: { isActive: true, ...(code && { code }) },
        },
        include: { tenant: { select: { name: true } } },
        take: 10,
      }),
    );
    for (const user of users) {
      const token = await RequestContext.withTenant(user.tenantId, () =>
        this.issue(user.id, user.email!, 'RESET_PASSWORD'),
      );
      await this.mail.send(
        mailTemplates.resetPassword(
          currentLang(),
          user.email!,
          `${user.fullName} (${user.tenant.name})`,
          this.link('/reset-password', token),
        ),
      );
    }
  }

  async resetPassword(token: string, newPassword: string) {
    await this.useToken(token, 'RESET_PASSWORD', async (row) => {
      await this.prisma.user.update({
        where: { id: row.userId },
        data: {
          passwordHash: await argon2.hash(newPassword),
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
      // Other reset links die, and every session signs out.
      await this.prisma.userToken.updateMany({
        where: { userId: row.userId, purpose: 'RESET_PASSWORD', usedAt: null },
        data: { usedAt: new Date() },
      });
      await this.prisma.refreshToken.updateMany({
        where: { userId: row.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }
}
