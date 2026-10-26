import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { AuditService } from '../common/audit.service.js';
import { DocNumberService } from '../common/doc-number.service.js';
import { pageArgs, toPage } from '../common/pagination.js';
import { startOfLocalDay } from '../common/time.js';
import { openDebtWhere } from '../customers/customers.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ExchangeRatesService } from '../settings/exchange-rates.service.js';
import { toLakAmount } from '../sales/sale-math.js';
import type {
  ListDebtPaymentsQuery,
  ReceiveDebtInput,
} from './debts.schemas.js';

const Decimal = Prisma.Decimal;

@Injectable()
export class DebtsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rates: ExchangeRatesService,
    private readonly docNumbers: DocNumberService,
    private readonly audit: AuditService,
  ) {}

  /** A customer's unpaid credit sales, oldest first, with what is still due. */
  async openDebts(
    customerId: string,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const sales = await db.sale.findMany({
      where: { customerId, ...openDebtWhere },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        receiptNo: true,
        createdAt: true,
        dueDate: true,
        totalLak: true,
        paidLak: true,
        paymentStatus: true,
      },
    });
    const now = Date.now();
    return sales.map((s) => ({
      ...s,
      dueLak: s.totalLak.sub(s.paidLak),
      overdue: s.dueDate !== null && s.dueDate.getTime() < now,
    }));
  }

  /**
   * Records a customer's payment against their credit sales (one sale, or oldest first).
   * Cash goes into the receiver's open shift; other types may be taken without a shift.
   */
  async receive(input: ReceiveDebtInput, user: AuthUser) {
    const ids = await this.prisma.$transaction(
      async (tx) => {
        const type = await tx.paymentType.findUniqueOrThrow({
          where: { id: input.paymentTypeId },
        });
        if (!type.isActive || type.kind === 'CREDIT') {
          throw new BadRequestException(
            'Choose an active non-credit payment type',
          );
        }
        if (type.requiresReference && !input.reference) {
          throw new BadRequestException(
            `${type.name} needs a reference number`,
          );
        }
        if (input.currency === 'LAK' && !Number.isInteger(input.amount)) {
          throw new BadRequestException('LAK amounts are whole kip');
        }
        const shift = await tx.shift.findFirst({
          where: { userId: user.id, status: 'OPEN' },
        });
        if (type.kind === 'CASH' && !shift) {
          throw new ConflictException({
            message: 'Open a shift to take cash',
            code: 'NO_OPEN_SHIFT',
          });
        }

        // Lock the customer's open credit sales so concurrent payments cannot overpay.
        await tx.$queryRaw`
          SELECT "id" FROM "Sale" WHERE "customerId" = ${input.customerId}
          AND "status" = 'COMPLETED' AND "paymentStatus" <> 'PAID' FOR UPDATE`;
        let debts = await this.openDebts(input.customerId, tx);
        if (input.saleId) debts = debts.filter((d) => d.id === input.saleId);
        const dueLak = debts.reduce((s, d) => s.add(d.dueLak), new Decimal(0));
        if (dueLak.isZero()) throw new ConflictException('Nothing is owed');

        const lakPerUnit = (await this.rates.current(tx))[input.currency]
          .lakPerUnit;
        const amountLak = toLakAmount(input.amount, lakPerUnit);
        if (amountLak.gt(dueLak)) {
          throw new BadRequestException(
            `Only ${dueLak.toString()} LAK is owed`,
          );
        }

        const receiptNo = await this.docNumbers.daily(tx, 'DP');
        const created: string[] = [];
        let left = amountLak;
        let leftAmount = new Decimal(input.amount);
        for (const [i, debt] of debts.entries()) {
          if (left.isZero()) break;
          const takeLak = Decimal.min(left, debt.dueLak);
          left = left.sub(takeLak);
          // The last allocation takes the remainder so currency amounts add up exactly.
          const takeAmount = left.isZero()
            ? leftAmount
            : takeLak.div(lakPerUnit).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
          leftAmount = leftAmount.sub(takeAmount);
          const row = await tx.debtPayment.create({
            data: {
              receiptNo:
                i === 0 && left.isZero() ? receiptNo : `${receiptNo}-${i + 1}`,
              customerId: input.customerId,
              saleId: debt.id,
              paymentTypeId: type.id,
              currency: input.currency,
              amount: takeAmount,
              lakPerUnit,
              amountLak: takeLak,
              reference: input.reference,
              shiftId: shift?.id,
              receivedById: user.id,
            },
          });
          const paid = debt.paidLak.add(takeLak);
          await tx.sale.update({
            where: { id: debt.id },
            data: {
              paidLak: paid,
              paymentStatus: paid.gte(debt.totalLak) ? 'PAID' : 'PARTIAL',
            },
          });
          created.push(row.id);
        }
        await this.audit.log(
          {
            userId: user.id,
            action: 'DEBT_PAYMENT',
            entity: 'Customer',
            entityId: input.customerId,
            after: { receiptNo, amountLak, sales: created.length },
          },
          tx,
        );
        return created;
      },
      { timeout: 30_000 },
    );
    return this.prisma.debtPayment.findMany({
      where: { id: { in: ids } },
      include: {
        sale: {
          select: {
            id: true,
            receiptNo: true,
            totalLak: true,
            paidLak: true,
            paymentStatus: true,
          },
        },
      },
    });
  }

  async list(query: ListDebtPaymentsQuery) {
    const where: Prisma.DebtPaymentWhereInput = {
      customerId: query.customerId,
      createdAt: {
        gte: query.from && startOfLocalDay(query.from),
        lt:
          query.to &&
          new Date(startOfLocalDay(query.to).getTime() + 86_400_000),
      },
      ...(query.q && { receiptNo: { contains: query.q, mode: 'insensitive' } }),
    };
    const [items, total] = await Promise.all([
      this.prisma.debtPayment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { id: true, code: true, name: true } },
          sale: { select: { id: true, receiptNo: true } },
          paymentType: { select: { id: true, name: true, kind: true } },
          receivedBy: { select: { id: true, fullName: true } },
        },
        ...pageArgs(query),
      }),
      this.prisma.debtPayment.count({ where }),
    ]);
    return toPage(items, total, query);
  }
}
