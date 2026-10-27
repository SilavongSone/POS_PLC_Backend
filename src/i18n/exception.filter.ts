import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { RequestContext } from '../common/request-context.js';
import { toHttpException } from '../common/prisma-errors.js';
import { Prisma } from '../generated/prisma/client.js';
import { t } from './i18n.js';

const CODE_FOR_STATUS: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  402: 'PAYMENT_REQUIRED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  423: 'ACCOUNT_LOCKED',
  429: 'TOO_MANY_REQUESTS',
  500: 'INTERNAL_ERROR',
};

/** Errors from body-parser and similar middleware carry an HTTP status of their own. */
function isClientHttpError(
  e: unknown,
): e is { status: number; message: string } {
  const status = (e as { status?: unknown } | null)?.status;
  return typeof status === 'number' && status >= 400 && status < 500;
}

/**
 * Every error response has the same shape, in the request's language:
 * `{ statusCode, code, message, detail?, requestId, ...params }`. `code` never changes
 * with the language (clients branch on it); `message` is for people; `detail` keeps the
 * original English text when it says more than the translated message.
 */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionsHandler');

  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    let e = error;
    if (e instanceof Prisma.PrismaClientKnownRequestError)
      e = toHttpException(e) ?? e;
    if (!(e instanceof HttpException) && isClientHttpError(e))
      e = new HttpException(e.message, e.status);

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: Record<string, unknown> = {};
    if (e instanceof HttpException) {
      status = e.getStatus();
      const r = e.getResponse();
      body = typeof r === 'string' ? { message: r } : { ...(r as object) };
    } else {
      this.logger.error(
        error instanceof Error ? (error.stack ?? error.message) : error,
      );
    }

    const original = Array.isArray(body.message)
      ? body.message.join('; ')
      : (body.message as string | undefined);
    const code =
      (body.code as string | undefined) ??
      (status === 400 && body.errors
        ? 'VALIDATION_FAILED'
        : (CODE_FOR_STATUS[status] ?? `HTTP_${status}`));
    const message = t(code, body) ?? original ?? code;
    delete body.error;
    if (response.headersSent) return;
    response.status(status).json({
      ...body,
      statusCode: status,
      code,
      message,
      ...(original &&
        original !== message &&
        status < 500 && { detail: original }),
      requestId: RequestContext.get()?.requestId,
    });
  }
}
