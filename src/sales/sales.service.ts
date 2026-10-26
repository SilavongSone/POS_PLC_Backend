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
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { ShiftsService } from '../shifts/shifts.service.js';
import { StockLedgerService } from '../stock/stock-ledger.service.js';
import { lakToLaoWords } from './lao-words.js';
import { SalePricingService } from './sale-pricing.service.js';
import type {
  CreateSaleInput,
  ListSalesQuery,
  QuoteSaleInput,
} from './sales.schemas.js';

const saleInclude = {
  items: {
    include: {
      serialNumbers: {
        select: {
          id: true,
          serial: true,
          warrantyEndsAt: true,
          condition: true,
        },
      },
      promotion: { select: { id: true, name: true } },
    },
  },
  payments: {
    include: { paymentType: { select: { id: true, name: true, kind: true } } },
  },
  customer: {
    select: {
      id: true,
      code: true,
      name: true,
      companyName: true,
      phone: true,
      taxId: true,
    },
  },
  cashier: { select: { id: true, fullName: true } },
  voidedBy: { select: { id: true, fullName: true } },
  register: { select: { id: true, code: true, name: true } },
  taxInvoices: {
    where: { cancelledAt: null },
    select: { id: true, invoiceNo: true },
  },
} satisfies Prisma.SaleInclude;

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: SalePricingService,
    private readonly ledger: StockLedgerService,
    private readonly approvals: ApprovalService,
    private readonly shifts: ShiftsService,
    private readonly docNumbers: DocNumberService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  /** Prices a cart without saving anything (for the till's running total). */
  async quote(input: QuoteSaleInput) {
    return this.prisma.$transaction(async (tx) => {
      const cart = await this.pricing.price(tx, input);
      const plan = input.payments.length
        ? await this.pricing
            .planPayments(tx, cart, input.payments)
            .catch((e: Error) => ({
              error: e.message,
            }))
        : null;
      return { ...cart, payment: plan };
    });
  }

  async create(input: CreateSaleInput, user: AuthUser) {
    const saleId = await this.prisma.$transaction(
      async (tx) => {
        const shift = await this.shifts.requireOpenShift(
          tx,
          user,
          input.registerId,
        );
        const cart = await this.pricing.price(tx, input);

        const approvedBy: Record<string, string> = {};
        for (const permission of cart.needsApproval) {
          approvedBy[permission] = await this.approvals.authorize(
            user,
            permission,
            input.approvals[permission],
          );
        }
        const plan = await this.pricing.planPayments(tx, cart, input.payments);
        if (plan.creditLak.isZero() && input.dueDate) {
          throw new BadRequestException(
            'A due date only applies to credit sales',
          );
        }

        const now = new Date();
        const sale = await tx.sale.create({
          data: {
            receiptNo: await this.docNumbers.daily(
              tx,
              `S-${shift.register.code}`,
              now,
            ),
            paymentStatus: plan.paymentStatus,
            cashierId: user.id,
            registerId: shift.registerId,
            shiftId: shift.id,
            customerId: cart.customer?.id,
            quotationId: input.quotationId,
            priceTier: cart.priceTier,
            subtotalLak: cart.subtotalLak,
            discountLak: cart.discountLak,
            taxRateId: cart.taxRateId,
            vatPercent: cart.vatPercent,
            pricesIncludeVat: cart.pricesIncludeVat,
            vatLak: cart.vatLak,
            totalLak: cart.totalLak,
            paidLak: plan.paidLak,
            changeLak: plan.changeLak,
            dueDate: input.dueDate,
            note: input.note,
            createdAt: now,
            payments: {
              create: plan.payments.map((p) => ({
                paymentTypeId: p.paymentTypeId,
                currency: p.currency,
                amount: p.amount,
                lakPerUnit: p.lakPerUnit,
                amountLak: p.amountLak,
                reference: p.reference,
              })),
            },
          },
        });

        const ref = { refType: 'SALE', refId: sale.id, userId: user.id };
        for (const line of cart.lines) {
          const item = await tx.saleItem.create({
            data: {
              saleId: sale.id,
              productId: line.productId,
              productName: line.productName,
              quantity: line.quantity,
              listPriceLak: line.listPriceLak,
              unitPriceLak: line.unitPriceLak,
              priceOverriddenById: line.overridden
                ? approvedBy['price.override']
                : null,
              promotionId: line.promotionId,
              discountLak: line.discountLak,
              lineTotalLak: line.lineTotalLak,
              unitCostLak: 0,
              warrantyMonths: line.warrantyMonths,
            },
          });
          const { costLak } = await this.ledger.remove(
            tx,
            line.productId,
            {
              quantity: line.quantity,
              type: 'SALE_OUT',
              serials: line.serials,
              serialStatus: 'SOLD',
              serialData: {
                saleItemId: item.id,
                soldAt: now,
                warrantyEndsAt: line.warrantyMonths
                  ? addMonths(now, line.warrantyMonths)
                  : null,
              },
            },
            ref,
          );
          await tx.saleItem.update({
            where: { id: item.id },
            data: { unitCostLak: costLak },
          });
        }

        if (input.heldBillId) {
          await tx.heldBill.deleteMany({ where: { id: input.heldBillId } });
        }
        if (input.quotationId) {
          await tx.quotation.update({
            where: { id: input.quotationId },
            data: { status: 'CONVERTED' },
          });
        }
        for (const [permission, approverId] of Object.entries(approvedBy)) {
          if (approverId === user.id) continue;
          await this.audit.log(
            {
              userId: user.id,
              action:
                permission === 'price.override'
                  ? 'SALE_PRICE_OVERRIDE'
                  : 'SALE_DISCOUNT',
              entity: 'Sale',
              entityId: sale.id,
              after: { approvedBy: approverId },
            },
            tx,
          );
        }
        return sale.id;
      },
      { timeout: 30_000 },
    );
    return this.get(saleId);
  }

  get(id: string) {
    return this.prisma.sale.findUniqueOrThrow({
      where: { id },
      include: saleInclude,
    });
  }

  async list(query: ListSalesQuery) {
    const where: Prisma.SaleWhereInput = {
      status: query.status,
      paymentStatus: query.paymentStatus,
      customerId: query.customerId,
      registerId: query.registerId,
      cashierId: query.cashierId,
      shiftId: query.shiftId,
      createdAt: {
        gte: query.from,
        lt: query.to && new Date(query.to.getTime() + 86_400_000),
      },
      ...(query.q && { receiptNo: { contains: query.q, mode: 'insensitive' } }),
    };
    const [items, total] = await Promise.all([
      this.prisma.sale.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { id: true, name: true } },
          cashier: { select: { id: true, fullName: true } },
          register: { select: { id: true, code: true } },
          _count: { select: { items: true } },
        },
        ...pageArgs(query),
      }),
      this.prisma.sale.count({ where }),
    ]);
    return toPage(items, total, query);
  }

  /** Everything a receipt needs (store details, lines, payments, warranties). */
  async receipt(id: string) {
    const [sale, store] = await Promise.all([
      this.get(id),
      this.settings.getAll(),
    ]);
    return {
      store: {
        name: store['store.name'],
        companyName: store['store.companyName'],
        taxId: store['store.taxId'],
        phone: store['store.phone'],
        address: store['store.address'],
        logoUrl: store['store.logoUrl'],
        footer: store['receipt.footer'],
      },
      paperSize: store['receipt.defaultSize'],
      sale,
      totalInWords: lakToLaoWords(sale.totalLak.toString()),
      isReprint: sale.printCount > 0,
    };
  }

  /** Records a print; any print after the first is a reprint and is audited. */
  async markPrinted(id: string, user: AuthUser) {
    const sale = await this.prisma.sale.update({
      where: { id },
      data: { printCount: { increment: 1 } },
    });
    if (sale.printCount > 1) {
      await this.audit.log({
        userId: user.id,
        action: 'SALE_REPRINT',
        entity: 'Sale',
        entityId: id,
        after: { printCount: sale.printCount },
      });
    }
    return { printCount: sale.printCount };
  }

  /**
   * Voids a sale in the same open shift: stock and serials go back, the sale stays on
   * record as VOIDED. Later corrections go through returns.
   */
  async void(
    id: string,
    reason: string,
    approvalToken: string | undefined,
    user: AuthUser,
  ) {
    const approverId = await this.approvals.authorize(
      user,
      'sale.void',
      approvalToken,
    );
    await this.prisma.$transaction(
      async (tx) => {
        const sale = await tx.sale.findUniqueOrThrow({
          where: { id },
          include: {
            shift: true,
            items: { include: { serialNumbers: true } },
            _count: {
              select: {
                debtPayments: true,
                returns: true,
                taxInvoices: { where: { cancelledAt: null } },
              },
            },
          },
        });
        if (sale.shift?.status !== 'OPEN') {
          throw new ConflictException(
            'Only sales of an open shift can be voided; use a return',
          );
        }
        if (sale._count.taxInvoices)
          throw new ConflictException('Cancel the tax invoice first');
        if (sale._count.debtPayments) {
          throw new ConflictException(
            'This credit sale already has payments; use a return',
          );
        }
        if (sale._count.returns)
          throw new ConflictException('This sale already has returns');

        const claimed = await tx.sale.updateMany({
          where: { id, status: 'COMPLETED' },
          data: {
            status: 'VOIDED',
            voidedById: user.id,
            voidedAt: new Date(),
            voidReason: reason,
          },
        });
        if (claimed.count === 0)
          throw new ConflictException('The sale is already voided');

        const ref = { refType: 'SALE', refId: id, userId: user.id };
        for (const item of sale.items) {
          if (item.serialNumbers.length) {
            await this.ledger.restoreSerials(
              tx,
              item.productId,
              item.serialNumbers.map((s) => s.id),
              'VOID_IN',
              ref,
            );
          } else {
            await this.ledger.restoreQuantity(
              tx,
              item.productId,
              item.quantity,
              item.unitCostLak,
              'VOID_IN',
              ref,
            );
          }
        }
        if (sale.quotationId) {
          await tx.quotation.update({
            where: { id: sale.quotationId },
            data: { status: 'ACCEPTED' },
          });
        }
        await this.audit.log(
          {
            userId: user.id,
            action: 'SALE_VOID',
            entity: 'Sale',
            entityId: id,
            after: { reason, approvedBy: approverId, totalLak: sale.totalLak },
          },
          tx,
        );
      },
      { timeout: 30_000 },
    );
    return this.get(id);
  }
}
