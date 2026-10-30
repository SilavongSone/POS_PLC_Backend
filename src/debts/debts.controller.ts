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
  listDebtPaymentsSchema,
  receiveDebtSchema,
  type ListDebtPaymentsQuery,
  type ReceiveDebtInput,
} from './debts.schemas.js';
import { DebtsService } from './debts.service.js';
import { RequireFeature } from '../tenancy/require-feature.decorator.js';
import { ApiZodResponse } from '../common/openapi.js';
import { openDebtsSchema } from '../customers/customers.responses.js';
import { Idempotent } from '../common/idempotency.interceptor.js';

@ApiTags('debts')
@ApiBearerAuth()
@RequirePermissions('debt.receive')
@RequireFeature('creditSales')
@Controller()
export class DebtsController {
  constructor(private readonly debts: DebtsService) {}

  @ApiZodResponse(openDebtsSchema)
  @Get('customers/:id/debts')
  @ApiOperation({ summary: "A customer's unpaid credit sales, oldest first" })
  openDebts(@Param('id', new ParseUUIDPipe()) customerId: string) {
    return this.debts.openDebts(customerId, undefined, 500);
  }

  @Idempotent()
  @Post('debt-payments')
  @ApiOperation({
    summary: 'Receive a debt payment (one sale, or oldest debts first)',
  })
  @ApiZodBody(receiveDebtSchema)
  receive(
    @Body(zod(receiveDebtSchema)) body: ReceiveDebtInput,
    @CurrentUser() u: AuthUser,
  ) {
    return this.debts.receive(body, u);
  }

  @Get('debt-payments')
  list(@Query(zod(listDebtPaymentsSchema)) query: ListDebtPaymentsQuery) {
    return this.debts.list(query);
  }
}
