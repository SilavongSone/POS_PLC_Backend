import {
  Body,
  Controller,
  Get,
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
import {
  createReturnSchema,
  listReturnsSchema,
  type CreateReturnInput,
  type ListReturnsQuery,
} from './returns.schemas.js';
import { ReturnsService } from './returns.service.js';

const id = new ParseUUIDPipe();

/** return.create, or a manager approvalToken for it, is checked in the service. */
@ApiTags('returns')
@ApiBearerAuth()
@RequirePermissions('sale.create')
@Controller()
export class ReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  @Post('sales/:id/returns')
  @ApiOperation({
    summary: 'Return items of a sale: refund, restock or mark defective',
  })
  @ApiZodBody(createReturnSchema)
  create(
    @Param('id', id) saleId: string,
    @Body(zod(createReturnSchema)) body: CreateReturnInput,
    @CurrentUser() u: AuthUser,
  ) {
    return this.returns.create(saleId, body, u);
  }

  @Get('returns')
  list(@Query(zod(listReturnsSchema)) query: ListReturnsQuery) {
    return this.returns.list(query);
  }

  @Get('returns/:id')
  get(@Param('id', id) returnId: string) {
    return this.returns.get(returnId);
  }
}
