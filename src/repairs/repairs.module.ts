import { Module } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module.js';
import { StockModule } from '../stock/stock.module.js';
import { RepairsController } from './repairs.controller.js';
import { RepairsService } from './repairs.service.js';

@Module({
  imports: [SalesModule, StockModule],
  controllers: [RepairsController],
  providers: [RepairsService],
})
export class RepairsModule {}
