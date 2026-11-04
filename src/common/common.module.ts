import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { LocalizeInterceptor } from '../i18n/localize.interceptor.js';
import { AuditLogsController } from './audit-logs.controller.js';
import { AuditService } from './audit.service.js';
import { DocNumberService } from './doc-number.service.js';
import { ImageStoreService } from './image-store.service.js';
import { UploadsController } from './uploads.controller.js';
import { AppExceptionFilter } from '../i18n/exception.filter.js';

@Global()
@Module({
  controllers: [AuditLogsController, UploadsController],
  providers: [
    AuditService,
    DocNumberService,
    ImageStoreService,
    { provide: APP_FILTER, useClass: AppExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: LocalizeInterceptor },
  ],
  exports: [AuditService, DocNumberService, ImageStoreService],
})
export class CommonModule {}
