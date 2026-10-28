import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator.js';
import { ApiZodBody, zod } from '../common/zod-validation.pipe.js';
import {
  convertQuotationSchema,
  listQuotationsSchema,
  quotationSchema,
  quotationStatusSchema,
  type ConvertQuotationInput,
  type ListQuotationsQuery,
  type QuotationInput,
} from './quotations.schemas.js';
import { QuotationsService } from './quotations.service.js';
import { RequireFeature } from '../tenancy/require-feature.decorator.js';

const id = new ParseUUIDPipe();

@ApiTags('quotations')
@ApiBearerAuth()
@RequirePermissions('quotation.manage')
@RequireFeature('quotations')
@Controller('quotations')
export class QuotationsController {
  constructor(private readonly quotations: QuotationsService) {}

  @Get()
  list(@Query(zod(listQuotationsSchema)) query: ListQuotationsQuery) {
    return this.quotations.list(query);
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'Quotation with seller details and total in Lao words (for A4/PDF)',
  })
  get(@Param('id', id) quotationId: string) {
    return this.quotations.get(quotationId);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a quotation priced like a sale (Q-YYMMDD-0001)',
  })
  @ApiZodBody(quotationSchema)
  create(
    @Body(zod(quotationSchema)) body: QuotationInput,
    @CurrentUser() u: AuthUser,
  ) {
    return this.quotations.create(body, u);
  }

  @Put(':id')
  @ApiZodBody(quotationSchema)
  update(
    @Param('id', id) quotationId: string,
    @Body(zod(quotationSchema)) body: QuotationInput,
  ) {
    return this.quotations.update(quotationId, body);
  }

  @Post(':id/status')
  @HttpCode(200)
  @ApiZodBody(quotationStatusSchema)
  setStatus(
    @Param('id', id) quotationId: string,
    @Body(zod(quotationStatusSchema))
    body: { status: 'SENT' | 'ACCEPTED' | 'REJECTED' },
    @CurrentUser() u: AuthUser,
  ) {
    return this.quotations.setStatus(quotationId, body.status, u);
  }

  @Post(':id/convert')
  @RequirePermissions('quotation.manage', 'sale.create')
  @ApiOperation({
    summary: 'Sell a sent/accepted quotation at the quoted prices',
  })
  @ApiZodBody(convertQuotationSchema)
  convert(
    @Param('id', id) quotationId: string,
    @Body(zod(convertQuotationSchema)) body: ConvertQuotationInput,
    @CurrentUser() u: AuthUser,
  ) {
    return this.quotations.convert(quotationId, body, u);
  }
}
