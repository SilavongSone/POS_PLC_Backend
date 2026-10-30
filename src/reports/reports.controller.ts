import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator.js';
import { hasPermission } from '../common/permissions.js';
import { BranchAccessService } from '../branches/branch-access.service.js';
import { type PageQuery } from '../common/pagination.js';
import { zod } from '../common/zod-validation.pipe.js';
import {
  bestSellersSchema,
  branchPageSchema,
  dateRangeSchema,
  pagedRangeSchema,
  salesSummarySchema,
  stockDocsReportSchema,
  type BestSellersQuery,
  type DateRange,
  type SalesSummaryQuery,
  type StockDocsReportQuery,
} from './reports.schemas.js';
import { ReportsService } from './reports.service.js';
import { RequireFeature } from '../tenancy/require-feature.decorator.js';
import { ApiZodQuery, ApiZodResponse } from '../common/openapi.js';
import {
  bestSellersReportSchema,
  dashboardSchema,
  salesSummarySchema as salesSummaryResponse,
} from './reports.responses.js';

const canViewCost = (u: AuthUser) =>
  hasPermission(u.permissions, 'product.viewCost');

/** All dates are local (Asia/Vientiane) YYYY-MM-DD, inclusive; default today. */
@ApiTags('reports')
@ApiBearerAuth()
@RequirePermissions('report.view')
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly branches: BranchAccessService,
  ) {}

  /** ?branchId= (checked against the user's branches), else the user's branches. */
  private scoped<T extends { branchId?: string }>(q: T, u: AuthUser) {
    return { ...q, branchIds: this.branches.scope(u, q.branchId) };
  }

  @Get('dashboard')
  @ApiZodQuery(branchPageSchema.pick({ branchId: true }))
  @ApiZodResponse(dashboardSchema)
  @ApiOperation({
    summary:
      "Today's sales, last 7 days, top products, alerts, debts, open shifts",
  })
  dashboard(
    @Query(zod(branchPageSchema.pick({ branchId: true })))
    q: { branchId?: string },
    @CurrentUser() u: AuthUser,
  ) {
    return this.reports.dashboard(canViewCost(u), this.scoped(q, u));
  }

  @ApiZodResponse(salesSummaryResponse)
  @Get('sales-summary')
  @ApiOperation({
    summary:
      'Sales totals (VAT, discounts, cost, profit) by day, month, cashier, register, branch or payment type',
  })
  salesSummary(
    @Query(zod(salesSummarySchema)) q: SalesSummaryQuery,
    @CurrentUser() u: AuthUser,
  ) {
    return this.reports.salesSummary(this.scoped(q, u), canViewCost(u));
  }

  @RequireFeature('advancedReports')
  @ApiZodResponse(bestSellersReportSchema)
  @Get('best-sellers')
  bestSellers(
    @Query(zod(bestSellersSchema)) q: BestSellersQuery,
    @CurrentUser() u: AuthUser,
  ) {
    return this.reports.bestSellers(this.scoped(q, u), canViewCost(u));
  }

  @RequireFeature('advancedReports')
  @Get('stock-value')
  @RequirePermissions('report.view', 'product.viewCost')
  @ApiOperation({ summary: 'Stock on hand valued at average cost' })
  stockValue(
    @Query(zod(branchPageSchema)) q: PageQuery & { branchId?: string },
    @CurrentUser() u: AuthUser,
  ) {
    return this.reports.stockValue(this.scoped(q, u));
  }

  @Get('stock-documents')
  @ApiOperation({
    summary: 'Goods received / issued / adjusted per product (?type)',
  })
  stockDocuments(
    @Query(zod(stockDocsReportSchema)) q: StockDocsReportQuery,
    @CurrentUser() u: AuthUser,
  ) {
    return this.reports.stockDocuments(this.scoped(q, u));
  }

  @Get('debt-payments')
  debtPayments(
    @Query(zod(dateRangeSchema)) q: DateRange,
    @CurrentUser() u: AuthUser,
  ) {
    return this.reports.debtPayments(this.scoped(q, u));
  }

  @RequireFeature('advancedReports')
  @Get('debt-aging')
  @ApiOperation({ summary: 'Outstanding credit per customer by days overdue' })
  debtAging(
    @Query(zod(branchPageSchema)) q: PageQuery & { branchId?: string },
    @CurrentUser() u: AuthUser,
  ) {
    return this.reports.debtAging(this.scoped(q, u));
  }

  @Get('expenses')
  expenses(
    @Query(zod(dateRangeSchema)) q: DateRange,
    @CurrentUser() u: AuthUser,
  ) {
    return this.reports.expenses(this.scoped(q, u));
  }

  @Get('voided-sales')
  voidedSales(
    @Query(zod(pagedRangeSchema)) q: DateRange & PageQuery,
    @CurrentUser() u: AuthUser,
  ) {
    return this.reports.voidedSales(this.scoped(q, u));
  }

  @RequireFeature('advancedReports')
  @Get('customer-purchases')
  customerPurchases(
    @Query(zod(pagedRangeSchema)) q: DateRange & PageQuery,
    @CurrentUser() u: AuthUser,
  ) {
    return this.reports.customerPurchases(this.scoped(q, u));
  }

  @Get('repairs')
  repairs(
    @Query(zod(dateRangeSchema)) q: DateRange,
    @CurrentUser() u: AuthUser,
  ) {
    return this.reports.repairs(this.scoped(q, u));
  }
}
