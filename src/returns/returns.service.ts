import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { ApprovalService } from '../auth/approval.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { BranchAccessService } from '../branches/branch-access.service.js';
import { AuditService } from '../common/audit.service.js';
import { DocNumberService } from '../common/doc-number.service.js';
import { pageArgs, toPage } from '../common/pagination.js';
import { startOfLocalDay } from '../common/time.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { lak } from '../sales/sale-math.js';
import { excessGifts, type GiftRule } from '../sales/promotion-math.js';
import { StockLedgerService } from '../stock/stock-ledger.service.js';
import type { CreateReturnInput, ListReturnsQuery } from './returns.schemas.js';
import { RequestContext } from '../common/request-context.js';

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
  paymentType: { select: { id: true, name: true, nameI18n: true, kind: true } },
  createdBy: { select: { id: true, fullName: true } },
  sale: {
    select: {
      id: true,
      receiptNo: true,
      customerId: true,
      branch: { select: { id: true, code: true, name: true } },
    },
  },
} satisfies Prisma.SaleReturnInclude;

@Injectable()
export class ReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: StockLedgerService,
    private readonly approvals: ApprovalService,
    private readonly docNumbers: DocNumberService,
    private readonly audit: AuditService,
    private readonly branches: BranchAccessService,
  ) {}

  /**
   * Value of gifts kept beyond what the items still bought earn, minus what earlier returns
   * already took (negative when a kept gift comes back after a charge).
   */
  private giftCharge(
    rules: GiftRule[],
    items: {
      id: string;
      quantity: number;
      returnItems: { quantity: number }[];
    }[],
    returning: Map<string, number>,
  ) {
    const before = (id: string) =>
      items
        .find((i) => i.id === id)
        ?.returnItems.reduce((n, r) => n + r.quantity, 0) ?? 0;
    const sold = (id: string) => items.find((i) => i.id === id)?.quantity ?? 0;
    let charge = new Decimal(0);
    for (const rule of rules) {
      const bought = (withNow: boolean) =>
        rule.qualifying.reduce(
          (n, q) =>
            n +
            (sold(q.saleItemId) -
              before(q.saleItemId) -
              (withNow ? (returning.get(q.saleItemId) ?? 0) : 0)) *
              q.unitsPerItem,
          0,
        );
      for (const g of rule.gifts) {
        // Units of the gift line that come back count against its free units first.
        const kept = (withNow: boolean) =>
          Math.max(
            0,
            g.units -
              before(g.saleItemId) -
              (withNow ? (returning.get(g.saleItemId) ?? 0) : 0),
          );
        const extra =
          excessGifts(rule, bought(true), kept(true)) -
          excessGifts(rule, bought(false), kept(false));
        charge = charge.add(new Decimal(g.valueLak).mul(extra));
      }
    }
    return charge;
  }

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
        await tx.$queryRaw`SELECT "id" FROM "Sale" WHERE "id" = ${saleId} AND "tenantId" = ${RequestContext.tenantId()} FOR UPDATE`;
        const sale = await tx.sale.findUniqueOrThrow({
          where: { id: saleId },
          include: {
            items: {
              include: {
                serialNumbers: true,
                returnItems: true,
                product: {
                  include: { bundleItems: { include: { component: true } } },
                },
              },
            },
            returns: { include: { paymentType: true } },
          },
        });
        this.branches.assertAccess(user, sale.branchId);
        if (sale.status !== 'COMPLETED')
          throw new ConflictException('Only completed sales can be returned');

        const items = new Map(sale.items.map((i) => [i.id, i]));
        const rules = (sale.giftRules ?? []) as unknown as GiftRule[];
        // Free units of each gift line: they come back first and refund nothing.
        const freeOf = new Map(
          rules.flatMap((r) => r.gifts.map((g) => [g.saleItemId, g.units])),
        );
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
          // Serials per unit: 1 for a serialized product, the serialized components for a bundle.
          const perUnit =
            item.product.type === 'BUNDLE'
              ? item.product.bundleItems
                  .filter((b) => b.component.trackSerial)
                  .reduce((n, b) => n + b.quantity, 0)
              : item.product.trackSerial
                ? 1
                : 0;
          if (perUnit || serials.length) {
            const sold = new Set(
              item.serialNumbers
                .filter((s) => s.status === 'SOLD')
                .map((s) => s.serial),
            );
            const needed = perUnit * line.quantity;
            if (
              serials.length !== needed ||
              new Set(serials).size !== needed ||
              serials.some((s) => !sold.has(s))
            ) {
              throw new BadRequestException(
                `${at}: list the ${needed} sold serial(s) being returned`,
              );
            }
          }
          const free = freeOf.get(item.id) ?? 0;
          const freeBack = Math.min(line.quantity, Math.max(0, free - already));
          const paidUnits = item.quantity - free;
          const paidBack = line.quantity - freeBack;
          const amountLak =
            sale.subtotalLak.isZero() || paidBack === 0 || paidUnits <= 0
              ? new Decimal(0)
              : lak(
                  sale.totalLak
                    .mul(item.lineTotalLak)
                    .mul(paidBack)
                    .div(paidUnits)
                    .div(sale.subtotalLak),
                );
          refundLak = refundLak.add(amountLak);
          return { line, item, serials, amountLak };
        });

        // Gifts (GIFT promotions): bought items coming back while their gift stays with the
        // customer → the gift's value comes off the refund; given back later when it returns.
        const giftChargeLak = this.giftCharge(
          rules,
          sale.items,
          new Map(input.items.map((l) => [l.saleItemId, l.quantity])),
        );
        if (giftChargeLak.gt(refundLak)) {
          throw new ConflictException({
            message: `Return the free gift too, or the refund cannot cover its value (${giftChargeLak.toString()} LAK)`,
            code: 'GIFT_NOT_RETURNED',
            valueLak: giftChargeLak.toString(),
          });
        }
        refundLak = refundLak.sub(giftChargeLak);

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
            giftChargeLak,
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
          // Returned goods go back into the stock of the branch that sold them.
          branchId: sale.branchId,
        };
        for (const { line, item, serials } of lines) {
          await this.ledger.restoreSoldUnits(
            tx,
            {
              productId: item.productId,
              quantity: line.quantity,
              unitFactor: item.unitFactor,
              serialIds: item.serialNumbers
                .filter((s) => serials.includes(s.serial))
                .map((s) => s.id),
              unitCostLak: item.unitCostLak,
              type: 'RETURN_IN',
              status: line.restock ? 'IN_STOCK' : 'DEFECTIVE',
            },
            ref,
          );
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

  async list(query: ListReturnsQuery, user: AuthUser) {
    const scope = this.branches.scope(user, query.branchId);
    const where: Prisma.SaleReturnWhereInput = {
      ...(scope && { sale: { branchId: { in: scope } } }),
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
