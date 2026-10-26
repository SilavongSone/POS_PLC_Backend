import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator.js';
import { hasPermission } from '../common/permissions.js';
import { zod } from '../common/zod-validation.pipe.js';
import {
  bestSellersSchema,
  dateRangeSchema,
  salesSummarySchema,
  stockDocsReportSchema,
  type BestSellersQuery,
  type DateRange,
  type SalesSummaryQuery,
  type StockDocsReportQuery,
} from './reports.schemas.js';
import { ReportsService } from './reports.service.js';

const canViewCost = (u: AuthUser) =>
  hasPermission(u.permissions, 'product.viewCost');

/** All dates are local (Asia/Vientiane) YYYY-MM-DD, inclusive; default today. */
@ApiTags('reports')
@ApiBearerAuth()
@RequirePermissions('report.view')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('dashboard')
  @ApiOperation({
    summary:
      "Today's sales, last 7 days, top products, alerts, debts, open shifts",
  })
  dashboard(@CurrentUser() u: AuthUser) {
    return this.reports.dashboard(canViewCost(u));
  }

  @Get('sales-summary')
  @ApiOperation({
    summary:
      'Sales totals (VAT, discounts, cost, profit) by day, month, cashier, register or payment type',
  })
  salesSummary(
    @Query(zod(salesSummarySchema)) q: SalesSummaryQuery,
    @CurrentUser() u: AuthUser,
  ) {
    return this.reports.salesSummary(q, canViewCost(u));
  }

  @Get('best-sellers')
  bestSellers(
    @Query(zod(bestSellersSchema)) q: BestSellersQuery,
    @CurrentUser() u: AuthUser,
  ) {
    return this.reports.bestSellers(q, canViewCost(u));
  }

  @Get('stock-value')
  @RequirePermissions('report.view', 'product.viewCost')
  @ApiOperation({ summary: 'Stock on hand valued at average cost' })
  stockValue() {
    return this.reports.stockValue();
  }

  @Get('stock-documents')
  @ApiOperation({
    summary: 'Goods received / issued / adjusted per product (?type)',
  })
  stockDocuments(@Query(zod(stockDocsReportSchema)) q: StockDocsReportQuery) {
    return this.reports.stockDocuments(q);
  }

  @Get('debt-payments')
  debtPayments(@Query(zod(dateRangeSchema)) q: DateRange) {
    return this.reports.debtPayments(q);
  }

  @Get('debt-aging')
  @ApiOperation({ summary: 'Outstanding credit per customer by days overdue' })
  debtAging() {
    return this.reports.debtAging();
  }

  @Get('expenses')
  expenses(@Query(zod(dateRangeSchema)) q: DateRange) {
    return this.reports.expenses(q);
  }

  @Get('voided-sales')
  voidedSales(@Query(zod(dateRangeSchema)) q: DateRange) {
    return this.reports.voidedSales(q);
  }

  @Get('customer-purchases')
  customerPurchases(@Query(zod(dateRangeSchema)) q: DateRange) {
    return this.reports.customerPurchases(q);
  }

  @Get('repairs')
  repairs(@Query(zod(dateRangeSchema)) q: DateRange) {
    return this.reports.repairs(q);
  }
}
