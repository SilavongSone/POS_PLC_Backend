import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator.js';
import type { PageQuery } from '../common/pagination.js';
import { hasPermission } from '../common/permissions.js';
import { ApiZodBody, zod } from '../common/zod-validation.pipe.js';
import { StockDocumentsService } from './stock-documents.service.js';
import { StockQueriesService } from './stock-queries.service.js';
import {
  cancelDocSchema,
  createSupplierSchema,
  expiringLotsSchema,
  listMovementsSchema,
  listSerialsSchema,
  listStockDocsSchema,
  listSuppliersSchema,
  stockDocSchema,
  updateSerialSchema,
  updateSupplierSchema,
  type CreateSupplierInput,
  type ListMovementsQuery,
  type ListSerialsQuery,
  type ListStockDocsQuery,
  type StockDocInput,
  type UpdateSerialInput,
  type UpdateSupplierInput,
} from './stock.schemas.js';
import { SuppliersService } from './suppliers.service.js';
import { RequireFeature } from '../tenancy/require-feature.decorator.js';
import { ApiZodQuery, ApiZodResponse } from '../common/openapi.js';
import {
  serialPageSchema,
  stockDocDetailSchema,
  stockDocPageSchema,
  stockMovementPageSchema,
  supplierPageSchema,
  supplierSchema,
} from './stock.responses.js';
import { BranchAccessService } from '../branches/branch-access.service.js';

const id = new ParseUUIDPipe();
const canViewCost = (u: AuthUser) =>
  hasPermission(u.permissions, 'product.viewCost');

@ApiTags('stock')
@ApiBearerAuth()
@RequirePermissions('stock.receive')
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  @ApiZodResponse(supplierPageSchema)
  list(@Query(zod(listSuppliersSchema)) query: PageQuery) {
    return this.suppliers.list(query);
  }

  @Get(':id')
  @ApiZodResponse(supplierSchema)
  get(@Param('id', id) supplierId: string) {
    return this.suppliers.get(supplierId);
  }

  @Post()
  @ApiZodBody(createSupplierSchema)
  create(
    @Body(zod(createSupplierSchema)) body: CreateSupplierInput,
    @CurrentUser() u: AuthUser,
  ) {
    return this.suppliers.create(body, u.id);
  }

  @Patch(':id')
  @ApiZodBody(updateSupplierSchema)
  update(
    @Param('id', id) supplierId: string,
    @Body(zod(updateSupplierSchema)) body: UpdateSupplierInput,
    @CurrentUser() u: AuthUser,
  ) {
    return this.suppliers.update(supplierId, body, u.id);
  }
}

/**
 * Documents show costs, so reading needs stock.receive. Writing checks the per-type
 * permission (stock.receive / stock.issue / stock.adjust) in the service.
 */
@ApiTags('stock')
@ApiBearerAuth()
@RequirePermissions('stock.receive')
@Controller('stock-documents')
export class StockDocumentsController {
  constructor(private readonly docs: StockDocumentsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Receipts, issues, adjustments and transfers (?type, branchId, status, supplierId, from, to, q)',
  })
  @ApiZodQuery(listStockDocsSchema)
  @ApiZodResponse(stockDocPageSchema)
  list(
    @Query(zod(listStockDocsSchema)) query: ListStockDocsQuery,
    @CurrentUser() user: AuthUser,
  ) {
    return this.docs.list(query, user);
  }

  @Get(':id')
  @ApiZodResponse(stockDocDetailSchema)
  get(@Param('id', id) docId: string, @CurrentUser() user: AuthUser) {
    return this.docs.get(docId, user);
  }

  @Post()
  @ApiOperation({
    summary: 'Save a draft (serials/lots per line); stock changes on post',
  })
  @ApiZodBody(stockDocSchema)
  create(
    @Body(zod(stockDocSchema)) body: StockDocInput,
    @CurrentUser() u: AuthUser,
  ) {
    return this.docs.create(body, u);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Replace a draft' })
  @ApiZodBody(stockDocSchema)
  update(
    @Param('id', id) docId: string,
    @Body(zod(stockDocSchema)) body: StockDocInput,
    @CurrentUser() u: AuthUser,
  ) {
    return this.docs.update(docId, body, u);
  }

  @Post(':id/post')
  @HttpCode(200)
  @ApiOperation({ summary: 'Apply the draft to stock' })
  post(@Param('id', id) docId: string, @CurrentUser() u: AuthUser) {
    return this.docs.post(docId, u);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Cancel a draft, or reverse a posted document if still possible',
  })
  @ApiZodBody(cancelDocSchema)
  cancel(
    @Param('id', id) docId: string,
    @Body(zod(cancelDocSchema)) body: { reason: string },
    @CurrentUser() u: AuthUser,
  ) {
    return this.docs.cancel(docId, body.reason, u);
  }
}

@ApiTags('stock')
@ApiBearerAuth()
@RequirePermissions('catalog.view')
@Controller('stock')
export class StockController {
  constructor(
    private readonly queries: StockQueriesService,
    private readonly branches: BranchAccessService,
  ) {}

  @Get('movements')
  @ApiOperation({ summary: 'Stock card (?productId, type, from, to)' })
  @ApiZodQuery(listMovementsSchema)
  @ApiZodResponse(stockMovementPageSchema)
  movements(
    @Query(zod(listMovementsSchema)) query: ListMovementsQuery,
    @CurrentUser() u: AuthUser,
  ) {
    return this.queries.movements(
      query,
      canViewCost(u),
      this.branches.scope(u, query.branchId),
    );
  }

  @Get('serials')
  @ApiOperation({
    summary: 'Serial numbers (?productId, status, condition, q)',
  })
  @ApiZodQuery(listSerialsSchema)
  @ApiZodResponse(serialPageSchema)
  serials(
    @Query(zod(listSerialsSchema)) query: ListSerialsQuery,
    @CurrentUser() u: AuthUser,
  ) {
    return this.queries.serials(
      query,
      canViewCost(u),
      this.branches.scope(u, query.branchId),
    );
  }

  @Get('serials/:serial/history')
  @ApiOperation({
    summary:
      'Warranty lookup: supplier, sale, customer, warranty left, repairs',
  })
  serialHistory(@Param('serial') serial: string, @CurrentUser() u: AuthUser) {
    return this.queries.serialHistory(serial, canViewCost(u));
  }

  @Patch('serials/:id')
  @RequirePermissions('product.manage')
  @ApiOperation({
    summary: 'Mark a unit as demo with its own price, or set supplier warranty',
  })
  @ApiZodBody(updateSerialSchema)
  updateSerial(
    @Param('id', id) serialId: string,
    @Body(zod(updateSerialSchema)) body: UpdateSerialInput,
    @CurrentUser() u: AuthUser,
  ) {
    return this.queries.updateSerial(serialId, body, u.id);
  }

  @RequireFeature('lots')
  @Get('lots/expiring')
  @ApiOperation({
    summary: 'Lots with stock expiring within ?withinDays (default 30)',
  })
  expiring(
    @Query(zod(expiringLotsSchema))
    query: { withinDays: number; productId?: string } & PageQuery,
  ) {
    return this.queries.expiringLots(query);
  }
}
