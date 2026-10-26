import { Injectable } from '@nestjs/common';
import { CategoriesService } from '../catalog/categories.service.js';
import { APP_TIMEZONE, localToday, startOfLocalDay } from '../common/time.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  BestSellersQuery,
  DateRange,
  SalesSummaryQuery,
  StockDocsReportQuery,
} from './reports.schemas.js';

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;
const DAY = 86_400_000;
const zero = () => new Decimal(0);

/** Local timestamp of a UTC "timestamp without time zone" column. */
const local = (column: string) =>
  Prisma.raw(`(${column} AT TIME ZONE 'UTC') AT TIME ZONE '${APP_TIMEZONE}'`);

type SummaryRow = {
  key: string;
  label: string | null;
  count: number;
  totalLak: Decimal;
  vatLak: Decimal;
  discountLak: Decimal;
  costLak: Decimal;
};

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoriesService,
  ) {}

  /** Inclusive local dates → [start, end) instants. Defaults to today. */
  range(q: DateRange) {
    const today = localToday();
    const fromDate = q.from ?? q.to ?? today;
    const toDate = q.to ?? q.from ?? today;
    return {
      fromDate,
      toDate,
      start: startOfLocalDay(fromDate),
      end: new Date(startOfLocalDay(toDate).getTime() + DAY),
    };
  }

  private withProfit<
    T extends { totalLak: Decimal; vatLak: Decimal; costLak: Decimal },
  >(row: T, canViewCost: boolean) {
    const netLak = row.totalLak.sub(row.vatLak);
    if (!canViewCost) {
      const { costLak: _cost, ...rest } = row;
      return { ...rest, netLak };
    }
    const profitLak = netLak.sub(row.costLak);
    return {
      ...row,
      netLak,
      profitLak,
      marginPercent: netLak.isZero()
        ? null
        : profitLak.div(netLak).mul(100).toDecimalPlaces(2),
    };
  }

  /** Sales totals with VAT, discounts, cost and profit, grouped by day/month/cashier/register/payment type. */
  async salesSummary(q: SalesSummaryQuery, canViewCost: boolean) {
    const r = this.range(q);
    const sales = Prisma.sql`
      SELECT s.*, (SELECT COALESCE(SUM(i."unitCostLak" * i."quantity"), 0)
                   FROM "SaleItem" i WHERE i."saleId" = s."id") AS cost
      FROM "Sale" s
      WHERE s."status" = 'COMPLETED' AND s."createdAt" >= ${r.start} AND s."createdAt" < ${r.end}`;

    const totals = await this.prisma.$queryRaw<
      Omit<SummaryRow, 'key' | 'label'>[]
    >`
      WITH s AS (${sales})
      SELECT count(*)::int AS count, COALESCE(SUM("totalLak"), 0) AS "totalLak",
             COALESCE(SUM("vatLak"), 0) AS "vatLak", COALESCE(SUM("discountLak"), 0) AS "discountLak",
             COALESCE(SUM(cost), 0) AS "costLak"
      FROM s`;

    let groups: unknown[];
    if (q.groupBy === 'paymentType') {
      groups = await this.prisma.$queryRaw`
        SELECT t."id" AS key, t."name" AS label, t."kind", p."currency",
               count(*)::int AS count, SUM(p."amount") AS amount, SUM(p."amountLak") AS "amountLak"
        FROM "Payment" p
        JOIN "Sale" s ON s."id" = p."saleId"
        JOIN "PaymentType" t ON t."id" = p."paymentTypeId"
        WHERE s."status" = 'COMPLETED' AND s."createdAt" >= ${r.start} AND s."createdAt" < ${r.end}
        GROUP BY t."id", t."name", t."kind", p."currency"
        ORDER BY "amountLak" DESC`;
    } else {
      const key = {
        day: Prisma.sql`to_char(${local('s."createdAt"')}, 'YYYY-MM-DD')`,
        month: Prisma.sql`to_char(${local('s."createdAt"')}, 'YYYY-MM')`,
        cashier: Prisma.sql`s."cashierId"`,
        register: Prisma.sql`COALESCE(s."registerId", '')`,
      }[q.groupBy];
      const label = {
        day: Prisma.sql`NULL`,
        month: Prisma.sql`NULL`,
        cashier: Prisma.sql`(SELECT u."fullName" FROM "User" u WHERE u."id" = s."cashierId")`,
        register: Prisma.sql`(SELECT g."code" FROM "Register" g WHERE g."id" = s."registerId")`,
      }[q.groupBy];
      const rows = await this.prisma.$queryRaw<SummaryRow[]>`
        WITH s AS (${sales})
        SELECT ${key} AS key, MIN(${label}) AS label, count(*)::int AS count,
               SUM(s."totalLak") AS "totalLak", SUM(s."vatLak") AS "vatLak",
               SUM(s."discountLak") AS "discountLak", SUM(s.cost) AS "costLak"
        FROM s GROUP BY 1 ORDER BY 1`;
      groups = rows.map((row) => this.withProfit(row, canViewCost));
    }

    return {
      from: r.fromDate,
      to: r.toDate,
      groupBy: q.groupBy,
      totals: this.withProfit(totals[0], canViewCost),
      groups,
    };
  }

  /** Top products by quantity, revenue or profit. Revenue is line totals (before the bill discount). */
  async bestSellers(q: BestSellersQuery, canViewCost: boolean) {
    const r = this.range(q);
    const categoryFilter = q.categoryId
      ? Prisma.sql`AND p."categoryId" IN (${Prisma.join(await this.categories.withDescendants(q.categoryId))})`
      : Prisma.empty;
    const order = {
      quantity: Prisma.sql`quantity DESC`,
      revenue: Prisma.sql`"revenueLak" DESC`,
      profit: Prisma.sql`("revenueLak" - "costLak") DESC`,
    }[canViewCost ? q.by : q.by === 'profit' ? 'revenue' : q.by];
    const rows = await this.prisma.$queryRaw<
      {
        productId: string;
        sku: string;
        name: string;
        quantity: number;
        revenueLak: Decimal;
        costLak: Decimal;
      }[]
    >`
      SELECT p."id" AS "productId", p."sku", p."name",
             SUM(i."quantity")::int AS quantity, SUM(i."lineTotalLak") AS "revenueLak",
             SUM(i."unitCostLak" * i."quantity") AS "costLak"
      FROM "SaleItem" i
      JOIN "Sale" s ON s."id" = i."saleId"
      JOIN "Product" p ON p."id" = i."productId"
      WHERE s."status" = 'COMPLETED' AND s."createdAt" >= ${r.start} AND s."createdAt" < ${r.end}
      ${categoryFilter}
      GROUP BY p."id", p."sku", p."name"
      ORDER BY ${order}
      LIMIT ${q.limit}`;
    return {
      from: r.fromDate,
      to: r.toDate,
      items: rows.map(({ costLak, ...row }) =>
        canViewCost
          ? { ...row, costLak, profitLak: row.revenueLak.sub(costLak) }
          : row,
      ),
    };
  }

  /** Stock on hand and its value at average cost. */
  async stockValue() {
    const products = await this.prisma.product.findMany({
      where: { type: 'STANDARD', trackStock: true, isActive: true },
      orderBy: { sku: 'asc' },
      select: {
        id: true,
        sku: true,
        name: true,
        stockQty: true,
        lowStockAlert: true,
        avgCostLak: true,
        category: { select: { name: true } },
      },
    });
    const items = products.map((p) => ({
      ...p,
      valueLak: p.avgCostLak.mul(Math.max(p.stockQty, 0)),
      low: p.stockQty <= p.lowStockAlert,
    }));
    return {
      items,
      totals: {
        products: items.length,
        units: items.reduce((s, p) => s + Math.max(p.stockQty, 0), 0),
        valueLak: items.reduce((s, p) => s.add(p.valueLak), zero()),
        lowStock: items.filter((p) => p.low).length,
        outOfStock: items.filter((p) => p.stockQty <= 0).length,
      },
    };
  }

  /** Goods received / issued / adjusted in the period, per product. */
  async stockDocuments(q: StockDocsReportQuery) {
    const r = this.range(q);
    const rows = await this.prisma.$queryRaw<
      {
        productId: string;
        sku: string;
        name: string;
        quantity: number;
        valueLak: Decimal;
        documents: number;
      }[]
    >`
      SELECT p."id" AS "productId", p."sku", p."name", SUM(i."quantity")::int AS quantity,
             SUM(i."unitCostLak" * i."quantity") AS "valueLak", count(DISTINCT d."id")::int AS documents
      FROM "StockDocumentItem" i
      JOIN "StockDocument" d ON d."id" = i."documentId"
      JOIN "Product" p ON p."id" = i."productId"
      WHERE d."type" = ${q.type}::"StockDocType" AND d."status" = 'POSTED'
        AND d."postedAt" >= ${r.start} AND d."postedAt" < ${r.end}
      GROUP BY p."id", p."sku", p."name"
      ORDER BY p."sku"`;
    return {
      from: r.fromDate,
      to: r.toDate,
      type: q.type,
      items: rows,
      totals: {
        quantity: rows.reduce((s, x) => s + x.quantity, 0),
        valueLak: rows.reduce((s, x) => s.add(x.valueLak), zero()),
      },
    };
  }

  async debtPayments(q: DateRange) {
    const r = this.range(q);
    const groups = await this.prisma.debtPayment.groupBy({
      by: ['paymentTypeId', 'currency'],
      where: { createdAt: { gte: r.start, lt: r.end } },
      _count: true,
      _sum: { amount: true, amountLak: true },
    });
    const types = new Map(
      (await this.prisma.paymentType.findMany()).map((t) => [t.id, t.name]),
    );
    return {
      from: r.fromDate,
      to: r.toDate,
      byPaymentType: groups.map((g) => ({
        paymentTypeId: g.paymentTypeId,
        name: types.get(g.paymentTypeId),
        currency: g.currency,
        count: g._count,
        amount: g._sum.amount,
        amountLak: g._sum.amountLak,
      })),
      totalLak: groups.reduce((s, g) => s.add(g._sum.amountLak ?? 0), zero()),
    };
  }

  /** Outstanding credit per customer, aged by due date (or sale date when no due date). */
  async debtAging() {
    const sales = await this.prisma.sale.findMany({
      where: {
        status: 'COMPLETED',
        paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
      },
      select: {
        customerId: true,
        createdAt: true,
        dueDate: true,
        totalLak: true,
        paidLak: true,
        customer: { select: { code: true, name: true, phone: true } },
      },
    });
    const buckets = ['notDue', 'd1_30', 'd31_60', 'd61_90', 'over90'] as const;
    type Row = {
      customerId: string;
      code?: string;
      name?: string;
      phone?: string | null;
      totalLak: Decimal;
    } & Record<(typeof buckets)[number], Decimal>;
    const byCustomer = new Map<string, Row>();
    const now = Date.now();
    for (const s of sales) {
      const due = s.totalLak.sub(s.paidLak);
      const days = Math.floor(
        (now - (s.dueDate ?? s.createdAt).getTime()) / DAY,
      );
      const bucket =
        days <= 0
          ? 'notDue'
          : days <= 30
            ? 'd1_30'
            : days <= 60
              ? 'd31_60'
              : days <= 90
                ? 'd61_90'
                : 'over90';
      const row =
        byCustomer.get(s.customerId!) ??
        ({
          customerId: s.customerId!,
          ...s.customer,
          totalLak: zero(),
          ...Object.fromEntries(buckets.map((b) => [b, zero()])),
        } as Row);
      row[bucket] = row[bucket].add(due);
      row.totalLak = row.totalLak.add(due);
      byCustomer.set(s.customerId!, row);
    }
    const items = [...byCustomer.values()].sort((a, b) =>
      b.totalLak.comparedTo(a.totalLak),
    );
    return {
      items,
      totals: Object.fromEntries(
        [...buckets, 'totalLak' as const].map((b) => [
          b,
          items.reduce((s, x) => s.add(x[b]), zero()),
        ]),
      ),
    };
  }

  async expenses(q: DateRange) {
    const r = this.range(q);
    const groups = await this.prisma.expense.groupBy({
      by: ['categoryId'],
      where: { spentAt: { gte: r.start, lt: r.end } },
      _count: true,
      _sum: { amountLak: true },
    });
    const names = new Map(
      (await this.prisma.expenseCategory.findMany()).map((c) => [c.id, c.name]),
    );
    return {
      from: r.fromDate,
      to: r.toDate,
      byCategory: groups
        .map((g) => ({
          categoryId: g.categoryId,
          name: names.get(g.categoryId),
          count: g._count,
          amountLak: g._sum.amountLak ?? zero(),
        }))
        .sort((a, b) => b.amountLak.comparedTo(a.amountLak)),
      totalLak: groups.reduce((s, g) => s.add(g._sum.amountLak ?? 0), zero()),
    };
  }

  async voidedSales(q: DateRange) {
    const r = this.range(q);
    const items = await this.prisma.sale.findMany({
      where: { status: 'VOIDED', voidedAt: { gte: r.start, lt: r.end } },
      orderBy: { voidedAt: 'desc' },
      select: {
        id: true,
        receiptNo: true,
        createdAt: true,
        voidedAt: true,
        voidReason: true,
        totalLak: true,
        cashier: { select: { id: true, fullName: true } },
        voidedBy: { select: { id: true, fullName: true } },
      },
    });
    return {
      from: r.fromDate,
      to: r.toDate,
      items,
      totals: {
        count: items.length,
        totalLak: items.reduce((s, x) => s.add(x.totalLak), zero()),
      },
    };
  }

  async customerPurchases(q: DateRange) {
    const r = this.range(q);
    const groups = await this.prisma.sale.groupBy({
      by: ['customerId'],
      where: {
        status: 'COMPLETED',
        customerId: { not: null },
        createdAt: { gte: r.start, lt: r.end },
      },
      _count: true,
      _sum: { totalLak: true },
      _max: { createdAt: true },
      orderBy: { _sum: { totalLak: 'desc' } },
    });
    const customers = new Map(
      (
        await this.prisma.customer.findMany({
          where: { id: { in: groups.map((g) => g.customerId!) } },
          select: { id: true, code: true, name: true, companyName: true },
        })
      ).map((c) => [c.id, c]),
    );
    return {
      from: r.fromDate,
      to: r.toDate,
      items: groups.map((g) => ({
        customer: customers.get(g.customerId!),
        count: g._count,
        totalLak: g._sum.totalLak,
        lastPurchaseAt: g._max.createdAt,
      })),
    };
  }

  async repairs(q: DateRange) {
    const r = this.range(q);
    const [received, byStatus, delivered] = await Promise.all([
      this.prisma.serviceTicket.count({
        where: { receivedAt: { gte: r.start, lt: r.end } },
      }),
      this.prisma.serviceTicket.groupBy({ by: ['status'], _count: true }),
      this.prisma.serviceTicket.findMany({
        where: { deliveredAt: { gte: r.start, lt: r.end } },
        select: {
          underWarranty: true,
          sale: { select: { totalLak: true, status: true } },
        },
      }),
    ]);
    const charged = delivered
      .filter((d) => d.sale?.status === 'COMPLETED')
      .reduce((s, d) => s.add(d.sale!.totalLak), zero());
    return {
      from: r.fromDate,
      to: r.toDate,
      received,
      delivered: delivered.length,
      deliveredUnderWarranty: delivered.filter((d) => d.underWarranty).length,
      chargedLak: charged,
      openByStatus: Object.fromEntries(
        byStatus.map((s) => [s.status, s._count]),
      ),
    };
  }

  /** One-screen overview for the owner. */
  async dashboard(canViewCost: boolean) {
    const today = localToday();
    const weekAgo = localToday(new Date(Date.now() - 6 * DAY));
    const [
      todaySales,
      week,
      top,
      lowStock,
      expiring,
      debts,
      openShifts,
      readyTickets,
    ] = await Promise.all([
      this.salesSummary(
        { from: today, to: today, groupBy: 'day' },
        canViewCost,
      ),
      this.salesSummary(
        { from: weekAgo, to: today, groupBy: 'day' },
        canViewCost,
      ),
      this.bestSellers(
        { from: today, to: today, limit: 5, by: 'quantity' },
        canViewCost,
      ),
      this.prisma.product.count({
        where: {
          isActive: true,
          type: 'STANDARD',
          trackStock: true,
          stockQty: { lte: this.prisma.product.fields.lowStockAlert },
        },
      }),
      this.prisma.stockLot.count({
        where: {
          qty: { gt: 0 },
          expiryDate: { lte: new Date(Date.now() + 30 * DAY) },
        },
      }),
      this.prisma.sale.aggregate({
        where: {
          status: 'COMPLETED',
          paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
        },
        _sum: { totalLak: true, paidLak: true },
        _count: true,
      }),
      this.prisma.shift.findMany({
        where: { status: 'OPEN' },
        select: {
          id: true,
          openedAt: true,
          register: { select: { code: true } },
          user: { select: { fullName: true } },
        },
      }),
      this.prisma.serviceTicket.count({ where: { status: 'READY' } }),
    ]);
    const overdue = await this.prisma.sale.findMany({
      where: {
        status: 'COMPLETED',
        paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
        dueDate: { lt: new Date() },
      },
      select: { totalLak: true, paidLak: true },
    });
    return {
      date: today,
      today: todaySales.totals,
      last7Days: week.groups,
      topProductsToday: top.items,
      alerts: {
        lowStockProducts: lowStock,
        lotsExpiringIn30Days: expiring,
        repairsReadyForPickup: readyTickets,
      },
      debts: {
        openSales: debts._count,
        outstandingLak: new Decimal(debts._sum.totalLak ?? 0).sub(
          debts._sum.paidLak ?? 0,
        ),
        overdueLak: overdue.reduce(
          (s, x) => s.add(x.totalLak.sub(x.paidLak)),
          zero(),
        ),
      },
      openShifts,
    };
  }
}
