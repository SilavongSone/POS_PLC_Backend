import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

@Module({
  imports: [CatalogModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
