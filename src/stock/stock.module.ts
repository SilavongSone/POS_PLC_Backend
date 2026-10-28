import { Module } from '@nestjs/common';
import { StockDocumentsService } from './stock-documents.service.js';
import { StockLedgerService } from './stock-ledger.service.js';
import { StockQueriesService } from './stock-queries.service.js';
import {
  StockController,
  StockDocumentsController,
  SuppliersController,
} from './stock.controller.js';
import { SuppliersService } from './suppliers.service.js';

@Module({
  controllers: [SuppliersController, StockDocumentsController, StockController],
  providers: [
    StockLedgerService,
    StockDocumentsService,
    StockQueriesService,
    SuppliersService,
  ],
  exports: [StockLedgerService],
})
export class StockModule {}
