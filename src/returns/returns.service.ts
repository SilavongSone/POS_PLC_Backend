import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { ApprovalService } from '../auth/approval.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { AuditService } from '../common/audit.service.js';
import { DocNumberService } from '../common/doc-number.service.js';
import { pageArgs, toPage } from '../common/pagination.js';
import { startOfLocalDay } from '../common/time.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { lak } from '../sales/sale-math.js';
import { StockLedgerService } from '../stock/stock-ledger.service.js';
import type { CreateReturnInput, ListReturnsQuery } from './returns.schemas.js';

const Decimal = Prisma.Decimal;

const returnInclude = {
  items: {
    include: {
      saleItem: {
        select: {
          id: true,
          productId: true,
          productName: true,
          quantity: true,
        },
      },
    },
  },
  paymentType: { select: { id: true, name: true, kind: true } },
  createdBy: { select: { id: true, fullName: true } },
  sale: { select: { id: true, receiptNo: true, customerId: true } },
} satisfies Prisma.SaleReturnInclude;

@Injectable()
export class ReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: StockLedgerService,
    private readonly approvals: ApprovalService,
    private readonly docNumbers: DocNumberService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Returns items of a completed sale. The refund is the share of what the customer
   * actually paid for those units (bill discount and added VAT included). Cash refunds
   * come out of the user's open shift; a CREDIT refund lowers the customer's debt.
   */
  async create(saleId: string, input: CreateReturnInput, user: AuthUser) {
    const approverId = await this.approvals.authorize(
      user,
      'return.create',
      input.approvalToken,
    );
    const id = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Sale" WHERE "id" = ${saleId} FOR UPDATE`;
        const sale = await tx.sale.findUniqueOrThrow({
          where: { id: saleId },
          include: {
            items: { include: { serialNumbers: true, returnItems: true } },
            returns: { include: { paymentType: true } },
          },
        });
        if (sale.status !== 'COMPLETED')
          throw new ConflictException('Only completed sales can be returned');

        const items = new Map(sale.items.map((i) => [i.id, i]));
        let refundLak = new Decimal(0);
        const lines = input.items.map((line, index) => {
          const at = `items[${index}]`;
          const item = items.get(line.saleItemId);
          if (!item)
            throw new BadRequestException(`${at}: not a line of this sale`);
          const already = item.returnItems.reduce((s, r) => s + r.quantity, 0);
          if (line.quantity > item.quantity - already) {
            throw new BadRequestException(
              `${at}: only ${item.quantity - already} left to return`,
            );
          }
          const serials = line.serials ?? [];
          if (item.serialNumbers.length || serials.length) {
            const sold = new Set(
              item.serialNumbers
                .filter((s) => s.status === 'SOLD')
                .map((s) => s.serial),
            );
            if (
              serials.length !== line.quantity ||
              serials.some((s) => !sold.has(s))
            ) {
              throw new BadRequestException(
                `${at}: list the ${line.quantity} sold serial(s) being returned`,
              );
            }
          }
          const amountLak = sale.subtotalLak.isZero()
            ? new Decimal(0)
            : lak(
                sale.totalLak
                  .mul(item.lineTotalLak)
                  .mul(line.quantity)
                  .div(item.quantity)
                  .div(sale.subtotalLak),
              );
          refundLak = refundLak.add(amountLak);
          return { line, item, serials, amountLak };
        });

        const type = await tx.paymentType.findUniqueOrThrow({
          where: { id: input.paymentTypeId },
        });
        if (!type.isActive)
          throw new BadRequestException('Payment type is not available');
        const shift = await tx.shift.findFirst({
          where: { userId: user.id, status: 'OPEN' },
        });
        if (type.kind === 'CASH' && !shift) {
          throw new ConflictException({
            message: 'Open a shift to refund cash',
            code: 'NO_OPEN_SHIFT',
          });
        }

        const refundedBefore = sale.returns.reduce(
          (s, r) => s.add(r.refundLak),
          new Decimal(0),
        );
        // Rounding can push the last return a kip over; never refund more than the sale.
        refundLak = Decimal.min(refundLak, sale.totalLak.sub(refundedBefore));

        // Money actually received for this sale and not yet given back.
        const sumWhere = (credit: boolean) =>
          sale.returns
            .filter((r) => (r.paymentType.kind === 'CREDIT') === credit)
            .reduce((s, r) => s.add(r.refundLak), new Decimal(0));
        const refundable = sale.paidLak
          .sub(sumWhere(true))
          .sub(sumWhere(false));
        if (type.kind !== 'CREDIT' && refundLak.gt(refundable)) {
          throw new BadRequestException(
            `Only ${refundable.toString()} LAK was paid; take the rest off the customer's debt (credit)`,
          );
        }

        if (type.kind === 'CREDIT') {
          const due = sale.totalLak.sub(sale.paidLak);
          if (refundLak.gt(due)) {
            throw new BadRequestException(
              `Only ${due.toString()} LAK of this sale is unpaid`,
            );
          }
          const paid = sale.paidLak.add(refundLak);
          await tx.sale.update({
            where: { id: saleId },
            data: {
              paidLak: paid,
              paymentStatus: paid.gte(sale.totalLak) ? 'PAID' : 'PARTIAL',
            },
          });
        }

        const saleReturn = await tx.saleReturn.create({
          data: {
            returnNo: await this.docNumbers.daily(tx, 'R'),
            saleId,
            reason: input.reason,
            refundLak,
            paymentTypeId: type.id,
            shiftId: shift?.id,
            createdById: user.id,
            items: {
              create: lines.map(({ line, serials, amountLak }) => ({
                saleItemId: line.saleItemId,
                quantity: line.quantity,
                serials,
                restock: line.restock,
                amountLak,
              })),
            },
          },
        });

        const ref = {
          refType: 'SALE_RETURN',
          refId: saleReturn.id,
          userId: user.id,
        };
        for (const { line, item, serials } of lines) {
          if (serials.length) {
            const ids = item.serialNumbers
              .filter((s) => serials.includes(s.serial))
              .map((s) => s.id);
            await this.ledger.restoreSerials(
              tx,
              item.productId,
              ids,
              'RETURN_IN',
              ref,
              line.restock ? 'IN_STOCK' : 'DEFECTIVE',
            );
          } else if (line.restock) {
            await this.ledger.restoreQuantity(
              tx,
              item.productId,
              line.quantity,
              item.unitCostLak,
              'RETURN_IN',
              ref,
            );
          }
        }
        await this.audit.log(
          {
            userId: user.id,
            action: 'SALE_RETURN',
            entity: 'Sale',
            entityId: saleId,
            after: {
              returnNo: saleReturn.returnNo,
              refundLak,
              approvedBy: approverId,
            },
          },
          tx,
        );
        return saleReturn.id;
      },
      { timeout: 30_000 },
    );
    return this.get(id);
  }

  get(id: string) {
    return this.prisma.saleReturn.findUniqueOrThrow({
      where: { id },
      include: returnInclude,
    });
  }

  async list(query: ListReturnsQuery) {
    const where: Prisma.SaleReturnWhereInput = {
      saleId: query.saleId,
      createdAt: {
        gte: query.from && startOfLocalDay(query.from),
        lt:
          query.to &&
          new Date(startOfLocalDay(query.to).getTime() + 86_400_000),
      },
      ...(query.q && { returnNo: { contains: query.q, mode: 'insensitive' } }),
    };
    const [items, total] = await Promise.all([
      this.prisma.saleReturn.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: returnInclude,
        ...pageArgs(query),
      }),
      this.prisma.saleReturn.count({ where }),
    ]);
    return toPage(items, total, query);
  }
}
