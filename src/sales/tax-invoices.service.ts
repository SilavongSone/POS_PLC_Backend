import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { AuditService } from '../common/audit.service.js';
import { DocNumberService } from '../common/doc-number.service.js';
import { pageArgs, toPage } from '../common/pagination.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { startOfLocalDay } from '../common/time.js';
import { SettingsService } from '../settings/settings.service.js';
import { lakToWords, lakToWordsAll } from '../i18n/amount-words.js';
import type {
  IssueTaxInvoiceInput,
  ListTaxInvoicesQuery,
} from './sales.schemas.js';

@Injectable()
export class TaxInvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly docNumbers: DocNumberService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  /** Issues a VAT invoice for a completed sale; buyer details default to the customer's. */
  async issue(saleId: string, input: IssueTaxInvoiceInput, user: AuthUser) {
    const sale = await this.prisma.sale.findUniqueOrThrow({
      where: { id: saleId },
      include: { customer: true },
    });
    if (sale.status !== 'COMPLETED') {
      throw new ConflictException('Only completed sales get a tax invoice');
    }
    const c = sale.customer;
    const buyerName = input.buyerName ?? c?.companyName ?? c?.name;
    if (!buyerName) throw new BadRequestException('Give the buyer name');

    try {
      const invoice = await this.prisma.$transaction(async (tx) =>
        tx.taxInvoice.create({
          data: {
            invoiceNo: await this.docNumbers.yearly(tx, 'INV'),
            saleId,
            buyerName,
            buyerTaxId: input.buyerTaxId ?? c?.taxId,
            buyerAddress: input.buyerAddress ?? c?.address,
            buyerPhone: input.buyerPhone ?? c?.phone,
            issuedById: user.id,
          },
        }),
      );
      await this.audit.log({
        userId: user.id,
        action: 'TAX_INVOICE_ISSUE',
        entity: 'TaxInvoice',
        entityId: invoice.id,
        after: invoice,
      });
      return this.get(invoice.id);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'This sale already has a tax invoice; cancel it to reissue',
        );
      }
      throw error;
    }
  }

  /** Invoice with its sale and the seller's details, ready to print on A4. */
  async get(id: string) {
    const [invoice, store] = await Promise.all([
      this.prisma.taxInvoice.findUniqueOrThrow({
        where: { id },
        include: {
          issuedBy: { select: { id: true, fullName: true } },
          sale: {
            include: {
              items: {
                include: { serialNumbers: { select: { serial: true } } },
              },
              payments: {
                include: {
                  paymentType: {
                    select: { name: true, nameI18n: true, kind: true },
                  },
                },
              },
            },
          },
        },
      }),
      this.settings.getAll(),
    ]);
    // The invoice never shows cost; cashiers who issue invoices may not see it.
    const sale = {
      ...invoice.sale,
      items: invoice.sale.items.map(({ unitCostLak: _cost, ...item }) => item),
    };
    const amountBeforeVat = sale.pricesIncludeVat
      ? sale.totalLak.sub(sale.vatLak)
      : sale.subtotalLak.sub(sale.discountLak);
    return {
      ...invoice,
      sale,
      seller: {
        name: store['store.companyName'] || store['store.name'],
        taxId: store['store.taxId'],
        address: store['store.address'],
        phone: store['store.phone'],
        logoUrl: store['store.logoUrl'],
      },
      amounts: {
        beforeVatLak: amountBeforeVat,
        vatPercent: sale.vatPercent,
        vatLak: sale.vatLak,
        totalLak: sale.totalLak,
        totalInWords: lakToWords(sale.totalLak.toString()),
        totalInWordsAll: lakToWordsAll(sale.totalLak.toString()),
      },
    };
  }

  async list(query: ListTaxInvoicesQuery) {
    const where: Prisma.TaxInvoiceWhereInput = {
      issuedAt: {
        gte: query.from && startOfLocalDay(query.from),
        lt:
          query.to &&
          new Date(startOfLocalDay(query.to).getTime() + 86_400_000),
      },
      ...(query.q && {
        OR: [
          { invoiceNo: { contains: query.q, mode: 'insensitive' } },
          { buyerName: { contains: query.q, mode: 'insensitive' } },
          { buyerTaxId: { contains: query.q } },
        ],
      }),
    };
    const [items, total] = await Promise.all([
      this.prisma.taxInvoice.findMany({
        where,
        orderBy: { issuedAt: 'desc' },
        include: {
          sale: {
            select: { id: true, receiptNo: true, totalLak: true, vatLak: true },
          },
        },
        ...pageArgs(query),
      }),
      this.prisma.taxInvoice.count({ where }),
    ]);
    return toPage(items, total, query);
  }

  /** Cancelled invoices keep their number; a new one can then be issued. */
  async cancel(id: string, reason: string, user: AuthUser) {
    const { count } = await this.prisma.taxInvoice.updateMany({
      where: { id, cancelledAt: null },
      data: { cancelledAt: new Date(), cancelReason: reason },
    });
    if (count === 0) {
      await this.prisma.taxInvoice.findUniqueOrThrow({ where: { id } });
      throw new ConflictException('The invoice is already cancelled');
    }
    await this.audit.log({
      userId: user.id,
      action: 'TAX_INVOICE_CANCEL',
      entity: 'TaxInvoice',
      entityId: id,
      after: { reason },
    });
    return this.get(id);
  }
}
