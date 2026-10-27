import {
  ConflictException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';

/** Maps common Prisma errors to HTTP errors instead of 500s (used by AppExceptionFilter). */
export function toHttpException(
  error: Prisma.PrismaClientKnownRequestError,
): HttpException | undefined {
  switch (error.code) {
    case 'P2002': {
      const target = (error.meta?.target ??
        (
          error.meta?.driverAdapterError as {
            cause?: { constraint?: { fields?: string[] } };
          }
        )?.cause?.constraint?.fields) as string[] | string | undefined;
      const fields = Array.isArray(target) ? target.join(', ') : target;
      return new ConflictException({
        message: fields ? `Already exists: ${fields}` : 'Already exists',
        code: 'ALREADY_EXISTS',
        fields,
      });
    }
    case 'P2025':
      return new NotFoundException('Record not found');
    case 'P2003':
      return new ConflictException({
        message: 'Operation violates a reference to another record',
        code: 'IN_USE',
      });
    default:
      return undefined;
  }
}
