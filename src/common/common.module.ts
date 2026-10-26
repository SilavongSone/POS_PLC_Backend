import { Global, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuditService } from './audit.service.js';
import { DocNumberService } from './doc-number.service.js';
import { PrismaExceptionFilter } from './prisma-exception.filter.js';

@Global()
@Module({
  providers: [
    AuditService,
    DocNumberService,
    { provide: APP_FILTER, useClass: PrismaExceptionFilter },
  ],
  exports: [AuditService, DocNumberService],
})
export class CommonModule {}
