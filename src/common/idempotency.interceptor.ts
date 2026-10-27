import { createHash } from 'node:crypto';
import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  UseInterceptors,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { from, lastValueFrom, type Observable } from 'rxjs';
import type { AuthUser } from '../auth/auth.types.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Keys are remembered this long; a retry after that creates a new document. */
export const IDEMPOTENCY_TTL_HOURS = 24;
const KEY = /^[\w-]{8,100}$/;

/**
 * `Idempotency-Key` support for money-moving POSTs: a till that lost its connection can
 * resend the same request with the same key and gets the first response back instead of
 * a second sale. The key is per company; reusing it for a different request is refused.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request & { user?: AuthUser }>();
    const key = req.headers['idempotency-key'];
    if (key === undefined || !req.user) return next.handle();
    if (typeof key !== 'string' || !KEY.test(key)) {
      throw new BadRequestException(
        'Idempotency-Key must be 8–100 letters, digits, "-" or "_"',
      );
    }
    return from(this.run(key, req, http.getResponse<Response>(), next));
  }

  private async run(
    key: string,
    req: Request & { user?: AuthUser },
    res: Response,
    next: CallHandler,
  ): Promise<unknown> {
    const userId = req.user!.id;
    const requestHash = createHash('sha256')
      .update(`${req.method} ${req.path}\n${JSON.stringify(req.body ?? null)}`)
      .digest('hex');

    try {
      await this.prisma.idempotencyKey.create({
        data: { key, userId, method: req.method, path: req.path, requestHash },
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      )
        throw error;
      const seen = await this.prisma.idempotencyKey.findFirstOrThrow({
        where: { key },
      });
      if (seen.requestHash !== requestHash || seen.userId !== userId) {
        throw new ConflictException({
          message: 'This Idempotency-Key was used for a different request',
          code: 'IDEMPOTENCY_CONFLICT',
        });
      }
      if (seen.statusCode === null) {
        throw new ConflictException({
          message: 'The same request is still being processed',
          code: 'IDEMPOTENCY_IN_PROGRESS',
        });
      }
      res.status(seen.statusCode);
      res.setHeader('Idempotent-Replayed', 'true');
      return seen.response;
    }

    try {
      const body = await lastValueFrom(next.handle());
      await this.prisma.idempotencyKey.updateMany({
        where: { key },
        data: {
          statusCode: res.statusCode,
          response: JSON.parse(
            JSON.stringify(body ?? null),
          ) as Prisma.InputJsonValue,
        },
      });
      if (Math.random() < 0.01) void this.sweep();
      return body;
    } catch (error) {
      // Failed requests may be retried with the same key.
      await this.prisma.idempotencyKey.deleteMany({ where: { key } });
      throw error;
    }
  }

  /** Forgets old keys (this company's; each company sweeps its own). */
  private async sweep() {
    await this.prisma.idempotencyKey
      .deleteMany({
        where: {
          createdAt: {
            lt: new Date(Date.now() - IDEMPOTENCY_TTL_HOURS * 3_600_000),
          },
        },
      })
      .catch(() => undefined);
  }
}

/** Accepts an `Idempotency-Key` header on this route. */
export const Idempotent = () => UseInterceptors(IdempotencyInterceptor);
