import {
  ArgumentsHost,
  Catch,
  ConflictException,
  ExceptionFilter,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Prisma } from '../generated/prisma/client.js';

/** Maps common Prisma errors to HTTP errors instead of 500s. */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter
  extends BaseExceptionFilter
  implements ExceptionFilter
{
  catch(error: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    super.catch(toHttpException(error) ?? error, host);
  }
}

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
      return new ConflictException(
        fields ? `Already exists: ${fields}` : 'Already exists',
      );
    }
    case 'P2025':
      return new NotFoundException('Record not found');
    case 'P2003':
      return new ConflictException(
        'Operation violates a reference to another record',
      );
    default:
      return undefined;
  }
}
