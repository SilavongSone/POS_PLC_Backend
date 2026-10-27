import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import type { Request } from 'express';
import { LOCK_MINUTES, MAX_FAILED_LOGINS } from '../auth/auth.service.js';
import { RequestContext } from '../common/request-context.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Platform tokens: separate claim type, never accepted by the company API (and vice versa). */
export type PlatformTokenPayload = { sub: string; typ: 'platform' };
export type PlatformAdminUser = { id: string; email: string; fullName: string };

const TOKEN_TTL_SECONDS = 8 * 3600;

@Injectable()
export class PlatformAuthService {
  private readonly dummyHash = argon2.hash('not-a-real-password');

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string) {
    const admin = await this.prisma.platformAdmin.findUnique({
      where: { email },
    });
    if (!admin?.isActive) {
      await argon2.verify(await this.dummyHash, 'x');
      throw new UnauthorizedException({
        message: 'Invalid email or password',
        code: 'INVALID_CREDENTIALS',
      });
    }
    if (admin.lockedUntil && admin.lockedUntil > new Date()) {
      throw new HttpException(
        {
          message: 'Account is temporarily locked',
          lockedUntil: admin.lockedUntil,
        },
        HttpStatus.LOCKED,
      );
    }
    if (!(await argon2.verify(admin.passwordHash, password))) {
      const failed = admin.failedLoginCount + 1;
      await this.prisma.platformAdmin.update({
        where: { id: admin.id },
        data:
          failed >= MAX_FAILED_LOGINS
            ? {
                failedLoginCount: 0,
                lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000),
              }
            : { failedLoginCount: failed },
      });
      throw new UnauthorizedException({
        message: 'Invalid email or password',
        code: 'INVALID_CREDENTIALS',
      });
    }
    if (admin.failedLoginCount || admin.lockedUntil) {
      await this.prisma.platformAdmin.update({
        where: { id: admin.id },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
    }
    const payload: PlatformTokenPayload = { sub: admin.id, typ: 'platform' };
    return {
      accessToken: await this.jwt.signAsync(payload, {
        expiresIn: TOKEN_TTL_SECONDS,
      }),
      expiresIn: TOKEN_TTL_SECONDS,
      admin: { id: admin.id, email: admin.email, fullName: admin.fullName },
    };
  }

  async verify(token: string): Promise<PlatformAdminUser> {
    let payload: PlatformTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<PlatformTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (payload.typ !== 'platform')
      throw new UnauthorizedException('Invalid or expired token');
    const admin = await this.prisma.platformAdmin.findUnique({
      where: { id: payload.sub },
    });
    if (!admin?.isActive)
      throw new UnauthorizedException('Admin is inactive or missing');
    return { id: admin.id, email: admin.email, fullName: admin.fullName };
  }
}

/**
 * Guards /platform routes (which are @Public() to the company JwtAuthGuard): a platform
 * token is required, and the request runs without tenant scoping.
 */
@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(private readonly auth: PlatformAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { platformAdmin?: PlatformAdminUser }>();
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token)
      throw new UnauthorizedException('Missing bearer token');
    request.platformAdmin = await this.auth.verify(token);
    const store = RequestContext.get();
    if (store) store.platform = true;
    return true;
  }
}
