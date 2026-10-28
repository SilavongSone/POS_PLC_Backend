import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { CustomersModule } from '../customers/customers.module.js';
import { ShiftsModule } from '../shifts/shifts.module.js';
import { StockModule } from '../stock/stock.module.js';
import { HeldBillsService } from './held-bills.service.js';
import { SalePricingService } from './sale-pricing.service.js';
import {
  HeldBillsController,
  SalesController,
  TaxInvoicesController,
} from './sales.controller.js';
import { SalesService } from './sales.service.js';
import { TaxInvoicesService } from './tax-invoices.service.js';

@Module({
  imports: [
    AuthModule,
    CatalogModule,
    CustomersModule,
    ShiftsModule,
    StockModule,
  ],
  controllers: [SalesController, TaxInvoicesController, HeldBillsController],
  providers: [
    SalesService,
    SalePricingService,
    HeldBillsService,
    TaxInvoicesService,
  ],
  exports: [SalesService, SalePricingService],
})
export class SalesModule {}
