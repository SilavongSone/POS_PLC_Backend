import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { AuditService } from '../common/audit.service.js';
import { DocNumberService } from '../common/doc-number.service.js';
import { pageArgs, toPage } from '../common/pagination.js';
import type { Prisma, QuotationStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { lakToWords, lakToWordsAll } from '../i18n/amount-words.js';
import { SalePricingService } from '../sales/sale-pricing.service.js';
import { SalesService } from '../sales/sales.service.js';
import { SettingsService } from '../settings/settings.service.js';
import type {
  ConvertQuotationInput,
  ListQuotationsQuery,
  QuotationInput,
} from './quotations.schemas.js';

const include = {
  customer: {
    select: {
      id: true,
      code: true,
      name: true,
      companyName: true,
      taxId: true,
      phone: true,
      address: true,
    },
  },
  createdBy: { select: { id: true, fullName: true } },
  items: {
    include: {
      product: {
        select: {
          id: true,
          sku: true,
          trackSerial: true,
          type: true,
          warrantyMonths: true,
        },
      },
    },
  },
  sale: { select: { id: true, receiptNo: true } },
} satisfies Prisma.QuotationInclude;

const EDITABLE: QuotationStatus[] = ['DRAFT', 'SENT'];

@Injectable()
export class QuotationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: SalePricingService,
    private readonly sales: SalesService,
    private readonly docNumbers: DocNumberService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  /** Prices the lines like a sale (manual prices allowed: quotation.manage covers them). */
  private async priced(tx: Prisma.TransactionClient, input: QuotationInput) {
    if (input.branchId)
      await tx.branch.findUniqueOrThrow({ where: { id: input.branchId } });
    const cart = await this.pricing.price(tx, input, { requireSerials: false });
    return {
      totals: {
        subtotalLak: cart.subtotalLak,
        discountLak: cart.discountLak,
        taxRateId: cart.taxRateId,
        vatPercent: cart.vatPercent,
        vatLak: cart.vatLak,
        totalLak: cart.totalLak,
      },
      items: cart.lines.map((l) => ({
        productId: l.productId,
        productName: l.productName,
        quantity: l.quantity,
        unitPriceLak: l.unitPriceLak,
        discountLak: l.discountLak,
        lineTotalLak: l.lineTotalLak,
      })),
    };
  }

  async create(input: QuotationInput, user: AuthUser) {
    const id = await this.prisma.$transaction(async (tx) => {
      const { totals, items } = await this.priced(tx, input);
      const q = await tx.quotation.create({
        data: {
          quoteNo: await this.docNumbers.daily(tx, 'Q'),
          customerId: input.customerId,
          branchId: input.branchId,
          validUntil: input.validUntil,
          note: input.note,
          createdById: user.id,
          ...totals,
          items: { create: items },
        },
      });
      return q.id;
    });
    return this.get(id);
  }

  async update(id: string, input: QuotationInput) {
    await this.prisma.$transaction(async (tx) => {
      const q = await tx.quotation.findUniqueOrThrow({ where: { id } });
      if (!EDITABLE.includes(q.status))
        throw new ConflictException(`A ${q.status} quotation cannot change`);
      const { totals, items } = await this.priced(tx, input);
      await tx.quotationItem.deleteMany({ where: { quotationId: id } });
      await tx.quotation.update({
        where: { id },
        data: {
          customerId: input.customerId,
          validUntil: input.validUntil,
          note: input.note,
          ...totals,
          items: { create: items },
        },
      });
    });
    return this.get(id);
  }

  async setStatus(
    id: string,
    status: 'SENT' | 'ACCEPTED' | 'REJECTED',
    user: AuthUser,
  ) {
    const q = await this.prisma.quotation.findUniqueOrThrow({ where: { id } });
    if (
      !EDITABLE.includes(q.status) &&
      !(q.status === 'ACCEPTED' && status === 'REJECTED')
    ) {
      throw new ConflictException(
        `A ${q.status} quotation cannot become ${status}`,
      );
    }
    await this.prisma.quotation.update({ where: { id }, data: { status } });
    await this.audit.log({
      userId: user.id,
      action: 'QUOTATION_STATUS',
      entity: 'Quotation',
      entityId: id,
      after: { status },
    });
    return this.get(id);
  }

  /** Quotation with seller details and the total in Lao words, for printing. */
  async get(id: string) {
    const [q, store] = await Promise.all([
      this.prisma.quotation.findUniqueOrThrow({ where: { id }, include }),
      this.settings.getAll(),
    ]);
    return {
      ...q,
      expired:
        EDITABLE.includes(q.status) || q.status === 'ACCEPTED'
          ? q.validUntil.getTime() + 86_400_000 < Date.now()
          : false,
      totalInWords: lakToWords(q.totalLak.toString()),
      totalInWordsAll: lakToWordsAll(q.totalLak.toString()),
      seller: {
        name: store['store.companyName'] || store['store.name'],
        taxId: store['store.taxId'],
        address: store['store.address'],
        phone: store['store.phone'],
        logoUrl: store['store.logoUrl'],
      },
    };
  }

  async list(query: ListQuotationsQuery) {
    const where: Prisma.QuotationWhereInput = {
      customerId: query.customerId,
      status: query.status,
      ...(query.q && { quoteNo: { contains: query.q, mode: 'insensitive' } }),
    };
    const [items, total] = await Promise.all([
      this.prisma.quotation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { id: true, name: true } },
        },
        ...pageArgs(query),
      }),
      this.prisma.quotation.count({ where }),
    ]);
    // Line counts for this page only (Prisma's _count would aggregate the whole table).
    const counts = await this.prisma.quotationItem.groupBy({
      by: ['quotationId'],
      where: { quotationId: { in: items.map((r) => r.id) } },
      _count: true,
    });
    const byId = new Map(counts.map((c) => [c.quotationId, c._count]));
    return toPage(
      items.map((r) => ({ ...r, _count: { items: byId.get(r.id) ?? 0 } })),
      total,
      query,
    );
  }

  /** Turns a sent/accepted quotation into a sale at the quoted prices (no extra approval). */
  async convert(id: string, input: ConvertQuotationInput, user: AuthUser) {
    const q = await this.get(id);
    if (!['SENT', 'ACCEPTED'].includes(q.status)) {
      throw new ConflictException(
        `A ${q.status} quotation cannot be converted`,
      );
    }
    if (q.expired) throw new ConflictException('The quotation has expired');
    const byLine = new Map(input.lines.map((l) => [l.quotationItemId, l]));
    for (const l of input.lines) {
      if (!q.items.some((i) => i.id === l.quotationItemId)) {
        throw new BadRequestException(
          `Unknown quotation line ${l.quotationItemId}`,
        );
      }
    }
    const sale = await this.sales.create(
      {
        registerId: input.registerId,
        customerId: q.customerId,
        quotationId: q.id,
        items: q.items.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
          unitPriceLak: Number(i.unitPriceLak),
          discountLak: Number(i.discountLak),
          serials: byLine.get(i.id)?.serials,
          componentSerials: byLine.get(i.id)?.componentSerials,
          description: i.product.type === 'SERVICE' ? i.productName : undefined,
        })),
        discountLak: Number(q.discountLak),
        payments: input.payments,
        dueDate: input.dueDate,
        note: input.note ?? `Quotation ${q.quoteNo}`,
        approvals: {},
      },
      user,
      { preApproved: true, applyPromotions: false },
    );
    return sale;
  }
}
