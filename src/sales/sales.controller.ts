import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator.js';
import { ApiZodBody, zod } from '../common/zod-validation.pipe.js';
import { HeldBillsService } from './held-bills.service.js';
import {
  cancelTaxInvoiceSchema,
  createSaleSchema,
  heldBillSchema,
  issueTaxInvoiceSchema,
  listSalesSchema,
  listTaxInvoicesSchema,
  quoteSaleSchema,
  voidSaleSchema,
  type CreateSaleInput,
  type HeldBillInput,
  type IssueTaxInvoiceInput,
  type ListSalesQuery,
  type ListTaxInvoicesQuery,
  type QuoteSaleInput,
} from './sales.schemas.js';
import { SalesService } from './sales.service.js';
import { TaxInvoicesService } from './tax-invoices.service.js';

const id = new ParseUUIDPipe();

@ApiTags('sales')
@ApiBearerAuth()
@Controller('sales')
export class SalesController {
  constructor(
    private readonly sales: SalesService,
    private readonly invoices: TaxInvoicesService,
  ) {}

  @Post('quote')
  @HttpCode(200)
  @RequirePermissions('sale.create')
  @ApiOperation({
    summary: 'Price a cart (tier, promotions, VAT, payments) without saving',
  })
  @ApiZodBody(quoteSaleSchema)
  quote(@Body(zod(quoteSaleSchema)) body: QuoteSaleInput) {
    return this.sales.quote(body);
  }

  @Post()
  @RequirePermissions('sale.create')
  @ApiOperation({
    summary:
      'Complete a sale in the open shift: stock/serials out, payments in any currency, credit within limit',
  })
  @ApiZodBody(createSaleSchema)
  create(
    @Body(zod(createSaleSchema)) body: CreateSaleInput,
    @CurrentUser() u: AuthUser,
  ) {
    return this.sales.create(body, u);
  }

  @Get()
  @RequirePermissions('sale.create')
  @ApiOperation({
    summary:
      'Sales (?from, to, status, paymentStatus, customerId, registerId, cashierId, shiftId, q)',
  })
  list(@Query(zod(listSalesSchema)) query: ListSalesQuery) {
    return this.sales.list(query);
  }

  @Get(':id')
  @RequirePermissions('sale.create')
  get(@Param('id', id) saleId: string) {
    return this.sales.get(saleId);
  }

  @Get(':id/receipt')
  @RequirePermissions('sale.create')
  @ApiOperation({
    summary: 'Receipt data: store, lines, payments, total in Lao words',
  })
  receipt(@Param('id', id) saleId: string) {
    return this.sales.receipt(saleId);
  }

  @Post(':id/printed')
  @HttpCode(200)
  @RequirePermissions('sale.reprint')
  @ApiOperation({
    summary: 'Record a print (prints after the first are audited reprints)',
  })
  printed(@Param('id', id) saleId: string, @CurrentUser() u: AuthUser) {
    return this.sales.markPrinted(saleId, u);
  }

  @Post(':id/void')
  @HttpCode(200)
  @RequirePermissions('sale.create')
  @ApiOperation({
    summary:
      'Void a sale of the open shift (sale.void or a manager approvalToken)',
  })
  @ApiZodBody(voidSaleSchema)
  void(
    @Param('id', id) saleId: string,
    @Body(zod(voidSaleSchema)) body: { reason: string; approvalToken?: string },
    @CurrentUser() u: AuthUser,
  ) {
    return this.sales.void(saleId, body.reason, body.approvalToken, u);
  }

  @Post(':id/tax-invoice')
  @RequirePermissions('taxInvoice.issue')
  @ApiOperation({
    summary: 'Issue a VAT invoice (buyer defaults to the customer)',
  })
  @ApiZodBody(issueTaxInvoiceSchema)
  issueInvoice(
    @Param('id', id) saleId: string,
    @Body(zod(issueTaxInvoiceSchema)) body: IssueTaxInvoiceInput,
    @CurrentUser() u: AuthUser,
  ) {
    return this.invoices.issue(saleId, body, u);
  }
}

@ApiTags('sales')
@ApiBearerAuth()
@RequirePermissions('taxInvoice.issue')
@Controller('tax-invoices')
export class TaxInvoicesController {
  constructor(private readonly invoices: TaxInvoicesService) {}

  @Get()
  list(@Query(zod(listTaxInvoicesSchema)) query: ListTaxInvoicesQuery) {
    return this.invoices.list(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Invoice with seller, buyer, lines and amounts for A4 printing',
  })
  get(@Param('id', id) invoiceId: string) {
    return this.invoices.get(invoiceId);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions('sale.void')
  @ApiZodBody(cancelTaxInvoiceSchema)
  cancel(
    @Param('id', id) invoiceId: string,
    @Body(zod(cancelTaxInvoiceSchema)) body: { reason: string },
    @CurrentUser() u: AuthUser,
  ) {
    return this.invoices.cancel(invoiceId, body.reason, u);
  }
}

@ApiTags('sales')
@ApiBearerAuth()
@RequirePermissions('sale.hold')
@Controller('held-bills')
export class HeldBillsController {
  constructor(private readonly bills: HeldBillsService) {}

  @Get()
  list() {
    return this.bills.list();
  }

  @Get(':id')
  get(@Param('id', id) billId: string) {
    return this.bills.get(billId);
  }

  @Post()
  @ApiOperation({ summary: 'Park the current cart' })
  @ApiZodBody(heldBillSchema)
  create(
    @Body(zod(heldBillSchema)) body: HeldBillInput,
    @CurrentUser() u: AuthUser,
  ) {
    return this.bills.create(body, u);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', id) billId: string, @CurrentUser() u: AuthUser) {
    await this.bills.remove(billId, u);
  }
}
