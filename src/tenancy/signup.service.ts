import { randomInt, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import argon2 from 'argon2';
import { hashSecret } from '../account/account.service.js';
import type { GoogleIdentity } from '../account/google-identity.service.js';
import { AuthService } from '../auth/auth.service.js';
import { RequestContext } from '../common/request-context.js';
import type { Env } from '../config/env.js';
import { currentLang } from '../i18n/i18n.js';
import { MailService } from '../mail/mail.service.js';
import { mailTemplates } from '../mail/templates.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProvisioningService } from './provisioning.service.js';
import type { GoogleSignupInput, SignupInput } from './tenancy.schemas.js';

const CODE_MINUTES = 30;
const MAX_ATTEMPTS = 5;
const MAX_RESENDS = 3;
const PER_EMAIL_PER_HOUR = 5;

type Payload = Omit<SignupInput, 'owner'> & {
  owner: { username: string; fullName: string; passwordHash: string };
  resends?: number;
};

const codeInvalid = () =>
  new BadRequestException({
    message: 'The code is wrong or has expired',
    code: 'SIGNUP_CODE_INVALID',
  });

/**
 * Self-service sign-up. With e-mail: the company is created only after the owner types
 * the 6-digit code we mailed. With Google: Google has proven the address already.
 */
@Injectable()
export class SignupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provisioning: ProvisioningService,
    private readonly auth: AuthService,
    private readonly mail: MailService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async request(input: SignupInput) {
    await this.provisioning.assertCodeFree(input.code);
    await this.provisioning.planFor(input.planCode, { publicOnly: true });
    const recent = await this.prisma.signupRequest.count({
      where: {
        email: input.email,
        createdAt: { gt: new Date(Date.now() - 3_600_000) },
      },
    });
    if (recent >= PER_EMAIL_PER_HOUR) {
      throw new HttpException(
        {
          message: 'Too many sign-ups for this e-mail',
          code: 'TOO_MANY_REQUESTS',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const { owner, ...company } = input;
    const payload: Payload = {
      ...company,
      owner: {
        username: owner.username,
        fullName: owner.fullName,
        passwordHash: await argon2.hash(owner.password),
      },
    };
    const code = this.newCode();
    const req = await this.prisma.signupRequest.create({
      data: {
        email: input.email,
        code: input.code,
        payload,
        codeHash: hashSecret(code),
        expiresAt: this.expiry(),
      },
    });
    await this.sendCode(req.id, input.email, code, input.name);
    return { requestId: req.id, email: input.email, expiresAt: req.expiresAt };
  }

  async resend(requestId: string) {
    const req = await this.prisma.signupRequest.findUnique({
      where: { id: requestId },
    });
    const payload = req?.payload as Payload | undefined;
    if (
      !req ||
      req.verifiedAt ||
      !payload ||
      (payload.resends ?? 0) >= MAX_RESENDS
    )
      throw codeInvalid();
    const code = this.newCode();
    const updated = await this.prisma.signupRequest.update({
      where: { id: req.id },
      data: {
        codeHash: hashSecret(code),
        attempts: 0,
        expiresAt: this.expiry(),
        payload: { ...payload, resends: (payload.resends ?? 0) + 1 },
      },
    });
    await this.sendCode(req.id, req.email, code, payload.name);
    return {
      requestId: req.id,
      email: req.email,
      expiresAt: updated.expiresAt,
    };
  }

  async verify(requestId: string, code: string) {
    const req = await this.prisma.signupRequest.findUnique({
      where: { id: requestId },
    });
    if (
      !req ||
      req.verifiedAt ||
      req.expiresAt <= new Date() ||
      req.attempts >= MAX_ATTEMPTS
    )
      throw codeInvalid();
    const given = Buffer.from(hashSecret(code));
    if (!timingSafeEqual(given, Buffer.from(req.codeHash))) {
      await this.prisma.signupRequest.update({
        where: { id: req.id },
        data: { attempts: { increment: 1 } },
      });
      throw codeInvalid();
    }
    // Claim it so a double click cannot create two companies.
    const { count } = await this.prisma.signupRequest.updateMany({
      where: { id: req.id, verifiedAt: null },
      data: { verifiedAt: new Date() },
    });
    if (count === 0) throw codeInvalid();

    const payload = req.payload as Payload;
    try {
      const { tenant, owner } = await this.provisioning.provision(
        {
          ...payload,
          status: 'TRIAL',
          owner: { ...payload.owner, email: req.email, emailVerified: true },
        },
        { publicOnly: true },
      );
      return this.signedIn(tenant, owner.id);
    } catch (error) {
      // Let the owner try again (e.g. after someone else took the code meanwhile).
      await this.prisma.signupRequest.update({
        where: { id: req.id },
        data: { verifiedAt: null },
      });
      throw error;
    }
  }

  async withGoogle(input: GoogleSignupInput, identity: GoogleIdentity) {
    if (!identity.emailVerified) {
      throw new BadRequestException({
        message: 'Google has not confirmed this e-mail',
        code: 'GOOGLE_EMAIL_UNVERIFIED',
      });
    }
    await this.provisioning.assertCodeFree(input.code);
    const { idToken: _token, ...company } = input;
    const username =
      identity.email
        .split('@')[0]
        .replace(/[^a-zA-Z0-9._-]/g, '')
        .slice(0, 50) || 'owner';
    const { tenant, owner } = await this.provisioning.provision(
      {
        ...company,
        email: identity.email,
        status: 'TRIAL',
        owner: {
          username: username.length >= 3 ? username : `owner-${username}`,
          fullName: identity.name,
          email: identity.email,
          emailVerified: true,
          googleSub: identity.sub,
        },
      },
      { publicOnly: true },
    );
    return this.signedIn(tenant, owner.id);
  }

  private async signedIn(
    tenant: { id: string; code: string; name: string },
    ownerId: string,
  ) {
    RequestContext.setTenant(tenant.id);
    const tokens = await this.auth.startSession(ownerId);
    return {
      tenant: { id: tenant.id, code: tenant.code, name: tenant.name },
      ...tokens,
    };
  }

  private newCode() {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
  }

  private expiry() {
    return new Date(Date.now() + CODE_MINUTES * 60_000);
  }

  private async sendCode(
    requestId: string,
    email: string,
    code: string,
    company: string,
  ) {
    const base = this.config.get('APP_URL', { infer: true }).replace(/\/$/, '');
    const url = `${base}/signup/verify?request=${requestId}&code=${code}`;
    await this.mail.send(
      mailTemplates.signupCode(currentLang(), email, code, company, url),
    );
  }
}
