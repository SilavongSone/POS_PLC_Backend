import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator.js';
import { ApiZodResponse } from '../common/openapi.js';
import {
  customerDetailSchema,
  customerPageSchema,
} from './customers.responses.js';
import { ApiZodBody, zod } from '../common/zod-validation.pipe.js';
import {
  createCustomerSchema,
  listCustomersSchema,
  updateCustomerSchema,
  type CreateCustomerInput,
  type ListCustomersQuery,
  type UpdateCustomerInput,
} from './customers.schemas.js';
import { CustomersService } from './customers.service.js';

const id = new ParseUUIDPipe();

@ApiTags('customers')
@ApiBearerAuth()
@RequirePermissions('customer.manage')
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @ApiZodResponse(customerPageSchema)
  @Get()
  @ApiOperation({
    summary: 'Search customers (?q name/company/code/phone, type, withDebt)',
  })
  list(@Query(zod(listCustomersSchema)) query: ListCustomersQuery) {
    return this.customers.list(query);
  }

  @ApiZodResponse(customerDetailSchema)
  @Get(':id')
  @ApiOperation({ summary: 'Customer with unpaid credit and purchase totals' })
  get(@Param('id', id) customerId: string) {
    return this.customers.get(customerId);
  }

  @Post()
  @ApiZodBody(createCustomerSchema)
  create(
    @Body(zod(createCustomerSchema)) body: CreateCustomerInput,
    @CurrentUser() u: AuthUser,
  ) {
    return this.customers.create(body, u.id);
  }

  @Patch(':id')
  @ApiZodBody(updateCustomerSchema)
  update(
    @Param('id', id) customerId: string,
    @Body(zod(updateCustomerSchema)) body: UpdateCustomerInput,
    @CurrentUser() u: AuthUser,
  ) {
    return this.customers.update(customerId, body, u.id);
  }
}
