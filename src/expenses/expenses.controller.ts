import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
import { ApiZodBody, zod } from '../common/zod-validation.pipe.js';
import {
  createExpenseSchema,
  expenseCategorySchema,
  listExpensesSchema,
  updateExpenseCategorySchema,
  type CreateExpenseInput,
  type ExpenseCategoryInput,
  type ListExpensesQuery,
} from './expenses.schemas.js';
import { ExpensesService } from './expenses.service.js';

const id = new ParseUUIDPipe();

@ApiTags('expenses')
@ApiBearerAuth()
@RequirePermissions('expense.manage')
@Controller()
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get('expense-categories')
  categories() {
    return this.expenses.categories();
  }

  @Post('expense-categories')
  @ApiZodBody(expenseCategorySchema)
  createCategory(@Body(zod(expenseCategorySchema)) body: ExpenseCategoryInput) {
    return this.expenses.createCategory(body);
  }

  @Patch('expense-categories/:id')
  @ApiZodBody(updateExpenseCategorySchema)
  updateCategory(
    @Param('id', id) categoryId: string,
    @Body(zod(updateExpenseCategorySchema)) body: Partial<ExpenseCategoryInput>,
  ) {
    return this.expenses.updateCategory(categoryId, body);
  }

  @Get('expenses')
  @ApiOperation({
    summary: 'Expenses (?categoryId, from, to, q) with the LAK total',
  })
  list(@Query(zod(listExpensesSchema)) query: ListExpensesQuery) {
    return this.expenses.list(query);
  }

  @Post('expenses')
  @ApiOperation({
    summary:
      'Record an expense (fromDrawer=true takes cash from the open shift)',
  })
  @ApiZodBody(createExpenseSchema)
  create(
    @Body(zod(createExpenseSchema)) body: CreateExpenseInput,
    @CurrentUser() u: AuthUser,
  ) {
    return this.expenses.create(body, u);
  }

  @Delete('expenses/:id')
  @HttpCode(204)
  async remove(@Param('id', id) expenseId: string, @CurrentUser() u: AuthUser) {
    await this.expenses.remove(expenseId, u);
  }
}
