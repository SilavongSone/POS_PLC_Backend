import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { BranchAccessService } from '../branches/branch-access.service.js';
import { AuditService } from '../common/audit.service.js';
import { pageArgs, toPage } from '../common/pagination.js';
import { hasPermission } from '../common/permissions.js';
import { Prisma, type Currency } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CashCount,
  CashMovementInput,
  CloseShiftInput,
  ListShiftsQuery,
  OpenShiftInput,
} from './shifts.schemas.js';

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;
const CURRENCIES: Currency[] = ['LAK', 'THB', 'USD'];
type Cash = Record<Currency, Decimal>;

const toCash = (json: unknown): Cash => {
  const c = (json ?? {}) as Partial<Record<Currency, string | number>>;
  return {
    LAK: new Decimal(c.LAK ?? 0),
    THB: new Decimal(c.THB ?? 0),
    USD: new Decimal(c.USD ?? 0),
  };
};
const cashJson = (c: Cash | CashCount) =>
  Object.fromEntries(CURRENCIES.map((k) => [k, String(c[k])])) as Record<
    Currency,
    string
  >;

@Injectable()
export class ShiftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly branches: BranchAccessService,
  ) {}

  async open(input: OpenShiftInput, user: AuthUser) {
    const register = await this.prisma.register.findUniqueOrThrow({
      where: { id: input.registerId },
    });
    if (!register.isActive)
      throw new BadRequestException('This register is inactive');
    this.branches.assertAccess(user, register.branchId);
    try {
      const shift = await this.prisma.shift.create({
        data: {
          registerId: register.id,
          userId: user.id,
          openingCash: cashJson(input.openingCash),
        },
        include: { register: true },
      });
      await this.audit.log({
        userId: user.id,
        action: 'SHIFT_OPEN',
        entity: 'Shift',
        entityId: shift.id,
        after: { register: register.code, openingCash: shift.openingCash },
      });
      return shift;
    } catch (error) {
      // Partial unique indexes: one open shift per register and per user.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'A shift is already open on this register or for this user',
        );
      }
      throw error;
    }
  }

  /** The signed-in user's open shift, or null. */
  current(user: AuthUser) {
    return this.prisma.shift.findFirst({
      where: { userId: user.id, status: 'OPEN' },
      include: { register: true },
    });
  }

  async list(query: ListShiftsQuery, user: AuthUser) {
    const scope = this.branches.scope(user, query.branchId);
    const where: Prisma.ShiftWhereInput = {
      registerId: query.registerId,
      userId: query.userId,
      status: query.status,
      ...(scope && { register: { branchId: { in: scope } } }),
    };
    const [items, total] = await Promise.all([
      this.prisma.shift.findMany({
        where,
        orderBy: { openedAt: 'desc' },
        include: {
          register: { select: { id: true, code: true, name: true } },
          user: { select: { id: true, fullName: true } },
        },
        ...pageArgs(query),
      }),
      this.prisma.shift.count({ where }),
    ]);
    return toPage(items, total, query);
  }

  private async getForUser(id: string, user: AuthUser) {
    const shift = await this.prisma.shift.findUniqueOrThrow({
      where: { id },
      include: {
        register: {
          select: { id: true, code: true, name: true, branchId: true },
        },
        user: { select: { id: true, fullName: true } },
      },
    });
    if (shift.userId !== user.id) {
      if (!hasPermission(user.permissions, 'report.view')) {
        throw new ForbiddenException(
          'Only the shift owner or a manager can see this shift',
        );
      }
      // Managers see shifts of their own branches only.
      this.branches.assertAccess(user, shift.register.branchId);
    }
    return shift;
  }

  async addCashMovement(
    shiftId: string,
    input: CashMovementInput,
    user: AuthUser,
  ) {
    const shift = await this.getForUser(shiftId, user);
    if (shift.status !== 'OPEN')
      throw new ConflictException('The shift is closed');
    return this.prisma.cashMovement.create({
      data: { shiftId, ...input, userId: user.id },
    });
  }

  cashMovements(shiftId: string) {
    return this.prisma.cashMovement.findMany({
      where: { shiftId },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, fullName: true } } },
    });
  }

  /** Z-report: sales and money for the shift, and the cash that should be in the drawer. */
  async report(shiftId: string, user: AuthUser) {
    const shift = await this.getForUser(shiftId, user);
    const completed = { shiftId, status: 'COMPLETED' } as const;

    const [
      sales,
      voided,
      payments,
      debtPayments,
      movements,
      expenses,
      returns,
    ] = await Promise.all([
      this.prisma.sale.aggregate({
        where: completed,
        _count: true,
        _sum: {
          totalLak: true,
          vatLak: true,
          discountLak: true,
          changeLak: true,
          paidLak: true,
        },
      }),
      this.prisma.sale.aggregate({
        where: { shiftId, status: 'VOIDED' },
        _count: true,
        _sum: { totalLak: true },
      }),
      this.prisma.payment.groupBy({
        by: ['paymentTypeId', 'currency'],
        where: { sale: completed },
        _sum: { amount: true, amountLak: true },
      }),
      this.prisma.debtPayment.groupBy({
        by: ['paymentTypeId', 'currency'],
        where: { shiftId },
        _sum: { amount: true, amountLak: true },
      }),
      this.prisma.cashMovement.groupBy({
        by: ['type', 'currency'],
        where: { shiftId },
        _sum: { amount: true },
      }),
      this.prisma.expense.groupBy({
        by: ['paymentTypeId', 'currency'],
        where: { shiftId },
        _sum: { amount: true, amountLak: true },
      }),
      this.prisma.saleReturn.groupBy({
        by: ['paymentTypeId'],
        where: { shiftId },
        _count: true,
        _sum: { refundLak: true },
      }),
    ]);

    const types = new Map(
      (await this.prisma.paymentType.findMany()).map((t) => [t.id, t]),
    );
    const isCash = (paymentTypeId: string) =>
      types.get(paymentTypeId)?.kind === 'CASH';
    const byType = (rows: typeof payments) =>
      rows.map((r) => ({
        paymentTypeId: r.paymentTypeId,
        name: types.get(r.paymentTypeId)?.name,
        kind: types.get(r.paymentTypeId)?.kind,
        currency: r.currency,
        amount: r._sum.amount ?? new Decimal(0),
        amountLak: r._sum.amountLak ?? new Decimal(0),
      }));

    const expected = toCash(shift.openingCash);
    const add = (c: Currency, v: Prisma.Decimal | number | null) =>
      (expected[c] = expected[c].add(v ?? 0));
    for (const p of payments)
      if (isCash(p.paymentTypeId)) add(p.currency, p._sum.amount);
    add('LAK', new Decimal(sales._sum.changeLak ?? 0).neg());
    for (const p of debtPayments)
      if (isCash(p.paymentTypeId)) add(p.currency, p._sum.amount);
    for (const m of movements) {
      add(
        m.currency,
        m.type === 'PAY_IN'
          ? m._sum.amount
          : new Decimal(m._sum.amount ?? 0).neg(),
      );
    }
    for (const e of expenses) {
      if (isCash(e.paymentTypeId))
        add(e.currency, new Decimal(e._sum.amount ?? 0).neg());
    }
    for (const r of returns) {
      if (isCash(r.paymentTypeId))
        add('LAK', new Decimal(r._sum.refundLak ?? 0).neg());
    }

    const counted = shift.closingCash ? toCash(shift.closingCash) : null;
    const creditLak = byType(payments)
      .filter((p) => p.kind === 'CREDIT')
      .reduce((s, p) => s.add(p.amountLak), new Decimal(0));

    return {
      shift,
      sales: {
        count: sales._count,
        totalLak: sales._sum.totalLak ?? new Decimal(0),
        vatLak: sales._sum.vatLak ?? new Decimal(0),
        billDiscountLak: sales._sum.discountLak ?? new Decimal(0),
        creditLak,
      },
      voided: {
        count: voided._count,
        totalLak: voided._sum.totalLak ?? new Decimal(0),
      },
      payments: byType(payments),
      debtPayments: byType(debtPayments),
      cashMovements: movements.map((m) => ({
        type: m.type,
        currency: m.currency,
        amount: m._sum.amount,
      })),
      expenses: byType(expenses),
      returns: returns.map((r) => ({
        paymentTypeId: r.paymentTypeId,
        name: types.get(r.paymentTypeId)?.name,
        count: r._count,
        refundLak: r._sum.refundLak,
      })),
      cash: {
        opening: cashJson(toCash(shift.openingCash)),
        expected: cashJson(expected),
        counted: counted && cashJson(counted),
        difference:
          counted &&
          cashJson(
            Object.fromEntries(
              CURRENCIES.map((c) => [c, counted[c].sub(expected[c])]),
            ) as Cash,
          ),
      },
    };
  }

  async close(shiftId: string, input: CloseShiftInput, user: AuthUser) {
    const before = await this.report(shiftId, user);
    if (before.shift.status !== 'OPEN')
      throw new ConflictException('The shift is already closed');
    const held = await this.prisma.heldBill.count({
      where: { cashierId: before.shift.userId },
    });

    const { count } = await this.prisma.shift.updateMany({
      where: { id: shiftId, status: 'OPEN' },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
        closingCash: cashJson(input.closingCash),
        expectedCash: before.cash.expected,
        note: input.note,
      },
    });
    if (count === 0) throw new ConflictException('The shift is already closed');
    const report = await this.report(shiftId, user);
    await this.audit.log({
      userId: user.id,
      action: 'SHIFT_CLOSE',
      entity: 'Shift',
      entityId: shiftId,
      after: report.cash,
    });
    return { ...report, heldBillsLeft: held };
  }

  /** The open shift a sale or payment is recorded in; the user must own it on that register. */
  async requireOpenShift(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    registerId?: string,
  ) {
    const shift = await tx.shift.findFirst({
      where: {
        userId: user.id,
        status: 'OPEN',
        ...(registerId && { registerId }),
      },
      include: { register: true },
    });
    if (!shift) {
      throw new NotFoundException({
        message: 'Open a shift on this register first',
        code: 'NO_OPEN_SHIFT',
      });
    }
    return shift;
  }
}
