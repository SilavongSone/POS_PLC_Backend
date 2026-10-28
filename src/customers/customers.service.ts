import { Injectable } from '@nestjs/common';
import { AuditService } from '../common/audit.service.js';
import { DocNumberService } from '../common/doc-number.service.js';
import { pageArgs, toPage } from '../common/pagination.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateCustomerInput,
  ListCustomersQuery,
  UpdateCustomerInput,
} from './customers.schemas.js';

/** Completed sales that still have an unpaid (credit) part. */
export const openDebtWhere = {
  status: 'COMPLETED',
  paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
} satisfies Prisma.SaleWhereInput;

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly docNumbers: DocNumberService,
    private readonly audit: AuditService,
  ) {}

  /** Total unpaid credit in LAK for one customer. */
  async outstandingLak(
    customerId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Prisma.Decimal> {
    const sums = await (tx ?? this.prisma).sale.aggregate({
      where: { customerId, ...openDebtWhere },
      _sum: { totalLak: true, paidLak: true },
    });
    return (sums._sum.totalLak ?? new Prisma.Decimal(0)).sub(
      sums._sum.paidLak ?? 0,
    );
  }

  async list(query: ListCustomersQuery) {
    const where: Prisma.CustomerWhereInput = {
      type: query.type,
      isActive: query.isActive,
      ...(query.withDebt && { sales: { some: openDebtWhere } }),
      ...(query.q && {
        OR: [
          { name: { contains: query.q, mode: 'insensitive' } },
          { companyName: { contains: query.q, mode: 'insensitive' } },
          { code: { contains: query.q, mode: 'insensitive' } },
          { phone: { contains: query.q } },
        ],
      }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        orderBy: { name: 'asc' },
        ...pageArgs(query),
      }),
      this.prisma.customer.count({ where }),
    ]);
    // One grouped query for the whole page instead of one per customer.
    const debts = await this.prisma.sale.groupBy({
      by: ['customerId'],
      where: { customerId: { in: rows.map((c) => c.id) }, ...openDebtWhere },
      _sum: { totalLak: true, paidLak: true },
    });
    const owed = new Map(
      debts.map((d) => [
        d.customerId,
        new Prisma.Decimal(d._sum.totalLak ?? 0).sub(d._sum.paidLak ?? 0),
      ]),
    );
    const items = rows.map((c) => ({
      ...c,
      outstandingLak: owed.get(c.id) ?? new Prisma.Decimal(0),
    }));
    return toPage(items, total, query);
  }

  async get(id: string) {
    const customer = await this.prisma.customer.findUniqueOrThrow({
      where: { id },
    });
    const [outstandingLak, purchases] = await Promise.all([
      this.outstandingLak(id),
      this.prisma.sale.aggregate({
        where: { customerId: id, status: 'COMPLETED' },
        _sum: { totalLak: true },
        _count: true,
        _max: { createdAt: true },
      }),
    ]);
    return {
      ...customer,
      outstandingLak,
      purchases: {
        count: purchases._count,
        totalLak: purchases._sum.totalLak ?? new Prisma.Decimal(0),
        lastAt: purchases._max.createdAt,
      },
    };
  }

  async create(input: CreateCustomerInput, actorId: string) {
    const customer = await this.prisma.$transaction(async (tx) =>
      tx.customer.create({
        data: { ...input, code: await this.docNumbers.sequential(tx, 'C', 5) },
      }),
    );
    await this.audit.log({
      userId: actorId,
      action: 'CUSTOMER_CREATE',
      entity: 'Customer',
      entityId: customer.id,
      after: customer,
    });
    return customer;
  }

  async update(id: string, input: UpdateCustomerInput, actorId: string) {
    const before = await this.prisma.customer.findUniqueOrThrow({
      where: { id },
    });
    const customer = await this.prisma.customer.update({
      where: { id },
      data: input,
    });
    await this.audit.log({
      userId: actorId,
      action: 'CUSTOMER_UPDATE',
      entity: 'Customer',
      entityId: id,
      before,
      after: customer,
    });
    return customer;
  }
}
