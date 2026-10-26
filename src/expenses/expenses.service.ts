import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { AuditService } from '../common/audit.service.js';
import { pageArgs, toPage } from '../common/pagination.js';
import { startOfLocalDay } from '../common/time.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toLakAmount } from '../sales/sale-math.js';
import { ExchangeRatesService } from '../settings/exchange-rates.service.js';
import type {
  CreateExpenseInput,
  ExpenseCategoryInput,
  ListExpensesQuery,
} from './expenses.schemas.js';

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rates: ExchangeRatesService,
    private readonly audit: AuditService,
  ) {}

  categories() {
    return this.prisma.expenseCategory.findMany({ orderBy: { name: 'asc' } });
  }

  createCategory(input: ExpenseCategoryInput) {
    return this.prisma.expenseCategory.create({ data: input });
  }

  updateCategory(id: string, input: Partial<ExpenseCategoryInput>) {
    return this.prisma.expenseCategory.update({ where: { id }, data: input });
  }

  async create(input: CreateExpenseInput, user: AuthUser) {
    const [category, type] = await Promise.all([
      this.prisma.expenseCategory.findUniqueOrThrow({
        where: { id: input.categoryId },
      }),
      this.prisma.paymentType.findUniqueOrThrow({
        where: { id: input.paymentTypeId },
      }),
    ]);
    if (!category.isActive)
      throw new BadRequestException('Expense category is inactive');
    if (type.kind === 'CREDIT')
      throw new BadRequestException('Expenses cannot be paid on credit');

    let shiftId: string | undefined;
    if (input.fromDrawer) {
      if (type.kind !== 'CASH')
        throw new BadRequestException('Only cash is paid from the drawer');
      const shift = await this.prisma.shift.findFirst({
        where: { userId: user.id, status: 'OPEN' },
      });
      if (!shift)
        throw new ConflictException({
          message: 'Open a shift to pay from the drawer',
          code: 'NO_OPEN_SHIFT',
        });
      shiftId = shift.id;
    }
    const lakPerUnit = (await this.rates.current())[input.currency].lakPerUnit;
    const expense = await this.prisma.expense.create({
      data: {
        categoryId: category.id,
        description: input.description,
        currency: input.currency,
        amount: input.amount,
        lakPerUnit,
        amountLak: toLakAmount(input.amount, lakPerUnit),
        paymentTypeId: type.id,
        shiftId,
        spentAt: input.spentAt,
        attachmentUrl: input.attachmentUrl,
        createdById: user.id,
      },
    });
    await this.audit.log({
      userId: user.id,
      action: 'EXPENSE_CREATE',
      entity: 'Expense',
      entityId: expense.id,
      after: expense,
    });
    return expense;
  }

  async list(query: ListExpensesQuery) {
    const where: Prisma.ExpenseWhereInput = {
      categoryId: query.categoryId,
      spentAt: {
        gte: query.from && startOfLocalDay(query.from),
        lt:
          query.to &&
          new Date(startOfLocalDay(query.to).getTime() + 86_400_000),
      },
      ...(query.q && {
        description: { contains: query.q, mode: 'insensitive' },
      }),
    };
    const [items, total, sum] = await Promise.all([
      this.prisma.expense.findMany({
        where,
        orderBy: { spentAt: 'desc' },
        include: {
          category: { select: { id: true, name: true } },
          paymentType: { select: { id: true, name: true } },
          createdBy: { select: { id: true, fullName: true } },
        },
        ...pageArgs(query),
      }),
      this.prisma.expense.count({ where }),
      this.prisma.expense.aggregate({ where, _sum: { amountLak: true } }),
    ]);
    return { ...toPage(items, total, query), totalLak: sum._sum.amountLak };
  }

  /** Deleting is allowed while the drawer shift (if any) is still open. */
  async remove(id: string, user: AuthUser) {
    const expense = await this.prisma.expense.findUniqueOrThrow({
      where: { id },
      include: { shift: true },
    });
    if (expense.shift && expense.shift.status !== 'OPEN') {
      throw new ConflictException(
        'The shift this expense was paid from is closed',
      );
    }
    await this.prisma.expense.delete({ where: { id } });
    await this.audit.log({
      userId: user.id,
      action: 'EXPENSE_DELETE',
      entity: 'Expense',
      entityId: id,
      before: expense,
    });
  }
}
