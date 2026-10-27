import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { BranchAccessService } from '../branches/branch-access.service.js';
import { DocNumberService } from '../common/doc-number.service.js';
import { pageArgs, toPage } from '../common/pagination.js';
import { Prisma, type TicketStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { lakToLaoWords } from '../sales/lao-words.js';
import type { SaleItemInput } from '../sales/sales.schemas.js';
import { SalesService } from '../sales/sales.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { StockLedgerService } from '../stock/stock-ledger.service.js';
import type {
  CreateTicketInput,
  DeliverTicketInput,
  ListTicketsQuery,
  TicketLinesInput,
  UpdateTicketInput,
} from './repairs.schemas.js';
import { RequestContext } from '../common/request-context.js';

type Tx = Prisma.TransactionClient;
const Decimal = Prisma.Decimal;

/** Generic service product that carries labour and loose parts on repair bills. */
export const REPAIR_SERVICE_SKU = 'SRV-REPAIR';

const include = {
  customer: { select: { id: true, code: true, name: true, phone: true } },
  serial: {
    select: {
      id: true,
      serial: true,
      status: true,
      warrantyEndsAt: true,
      supplierWarrantyEndsAt: true,
      product: { select: { id: true, sku: true, name: true } },
    },
  },
  lines: {
    include: {
      product: {
        select: { id: true, sku: true, name: true, trackSerial: true },
      },
    },
  },
  logs: {
    orderBy: { createdAt: 'asc' },
    include: { user: { select: { id: true, fullName: true } } },
  },
  receivedBy: { select: { id: true, fullName: true } },
  sale: { select: { id: true, receiptNo: true, totalLak: true, status: true } },
  supplier: { select: { id: true, name: true } },
} satisfies Prisma.ServiceTicketInclude;

const CLOSED: TicketStatus[] = ['DELIVERED', 'CANCELLED'];

@Injectable()
export class RepairsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sales: SalesService,
    private readonly ledger: StockLedgerService,
    private readonly docNumbers: DocNumberService,
    private readonly settings: SettingsService,
    private readonly branches: BranchAccessService,
  ) {}

  /** Receives a device. A shop serial fills in the device and whether it is under warranty. */
  async create(input: CreateTicketInput, user: AuthUser) {
    const branchId = await this.branches.resolve(user, input.branchId);
    const id = await this.prisma.$transaction(async (tx) => {
      await tx.customer.findUniqueOrThrow({ where: { id: input.customerId } });
      const unit = input.serial
        ? await tx.serialNumber.findFirst({
            where: { serial: input.serial },
            include: { product: true },
          })
        : null;
      if (input.serial && !unit && !input.deviceName) {
        throw new BadRequestException(
          `Serial ${input.serial} was not sold here; give the device name`,
        );
      }
      if (unit?.status === 'IN_SERVICE')
        throw new ConflictException('This unit is already in for repair');

      const ticket = await tx.serviceTicket.create({
        data: {
          ticketNo: await this.docNumbers.daily(tx, 'T'),
          branchId,
          customerId: input.customerId,
          serialId: unit?.id,
          deviceName: input.deviceName ?? unit!.product.name,
          deviceSerial: input.deviceSerial ?? input.serial,
          accessories: input.accessories,
          problem: input.problem,
          promisedAt: input.promisedAt,
          underWarranty: Boolean(
            unit?.warrantyEndsAt && unit.warrantyEndsAt > new Date(),
          ),
          warrantyTerms:
            (await this.settings.get('repair.warrantyTerms', tx)) || null,
          receivedById: user.id,
          logs: {
            create: {
              status: 'RECEIVED',
              userId: user.id,
              note: 'Device received',
            },
          },
        },
      });
      if (unit?.status === 'SOLD') {
        await tx.serialNumber.update({
          where: { id: unit.id },
          data: { status: 'IN_SERVICE' },
        });
      }
      return ticket.id;
    });
    return this.get(id);
  }

  /** Ticket with history, lines and print data (store, warranty, amounts in words). */
  async get(id: string, db: Tx = this.prisma) {
    const [ticket, store] = await Promise.all([
      db.serviceTicket.findUniqueOrThrow({ where: { id }, include }),
      this.settings.getAll(db),
    ]);
    const chargeLak = ticket.underWarranty ? new Decimal(0) : ticket.quotedLak;
    return {
      ...ticket,
      chargeLak,
      chargeInWords: lakToLaoWords(chargeLak.toString()),
      store: {
        name: store['store.name'],
        phone: store['store.phone'],
        address: store['store.address'],
        logoUrl: store['store.logoUrl'],
      },
    };
  }

  async list(query: ListTicketsQuery) {
    const where: Prisma.ServiceTicketWhereInput = {
      status:
        query.status ??
        (query.open === undefined
          ? undefined
          : query.open
            ? { notIn: CLOSED }
            : { in: CLOSED }),
      customerId: query.customerId,
      ...(query.q && {
        OR: [
          { ticketNo: { contains: query.q, mode: 'insensitive' } },
          { deviceSerial: { contains: query.q, mode: 'insensitive' } },
          { deviceName: { contains: query.q, mode: 'insensitive' } },
          { customer: { phone: { contains: query.q } } },
        ],
      }),
    };
    const [items, total] = await Promise.all([
      this.prisma.serviceTicket.findMany({
        where,
        orderBy: { receivedAt: 'desc' },
        include: {
          customer: { select: { id: true, name: true, phone: true } },
        },
        ...pageArgs(query),
      }),
      this.prisma.serviceTicket.count({ where }),
    ]);
    return toPage(items, total, query);
  }

  private async openTicket(tx: Tx, id: string) {
    const ticket = await tx.serviceTicket.findUniqueOrThrow({ where: { id } });
    if (CLOSED.includes(ticket.status))
      throw new ConflictException(`The ticket is ${ticket.status}`);
    return ticket;
  }

  async update(id: string, input: UpdateTicketInput) {
    await this.prisma.$transaction(async (tx) => {
      await this.openTicket(tx, id);
      if (input.supplierId)
        await tx.supplier.findUniqueOrThrow({
          where: { id: input.supplierId },
        });
      await tx.serviceTicket.update({ where: { id }, data: input });
    });
    return this.get(id);
  }

  /** Replaces the repair quotation lines (parts and labour). */
  async setLines(id: string, input: TicketLinesInput) {
    await this.prisma.$transaction(async (tx) => {
      await this.openTicket(tx, id);
      const productIds = input.lines.flatMap((l) =>
        l.productId ? [l.productId] : [],
      );
      const products = await tx.product.findMany({
        where: { id: { in: productIds } },
      });
      if (new Set(productIds).size !== products.length)
        throw new BadRequestException('Unknown part');
      if (products.some((p) => p.type === 'BUNDLE'))
        throw new BadRequestException('Bundles cannot be parts');
      const lines = input.lines.map((l) => ({
        ...l,
        ticketId: id,
        lineTotalLak: new Decimal(l.unitPriceLak).mul(l.quantity),
      }));
      await tx.serviceTicketLine.deleteMany({ where: { ticketId: id } });
      await tx.serviceTicketLine.createMany({ data: lines });
      await tx.serviceTicket.update({
        where: { id },
        data: {
          quotedLak: lines.reduce(
            (s, l) => s.add(l.lineTotalLak),
            new Decimal(0),
          ),
        },
      });
    });
    return this.get(id);
  }

  async setStatus(
    id: string,
    status: TicketStatus,
    note: string | undefined,
    user: AuthUser,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const ticket = await this.openTicket(tx, id);
      if (status === 'SENT_TO_VENDOR' && !ticket.supplierId) {
        throw new BadRequestException('Choose the supplier the device goes to');
      }
      await tx.serviceTicket.update({ where: { id }, data: { status } });
      await tx.serviceTicketLog.create({
        data: { ticketId: id, status, note, userId: user.id },
      });
    });
    return this.get(id);
  }

  /**
   * Hands the device back. A READY ticket is charged (unless under warranty) through a
   * normal sale in the open shift; parts leave stock either on that sale or, when free,
   * as an issue against the ticket. A CANCELLED ticket is just handed back.
   */
  async deliver(id: string, input: DeliverTicketInput, user: AuthUser) {
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "ServiceTicket" WHERE "id" = ${id} AND "tenantId" = ${RequestContext.tenantId()} FOR UPDATE`;
        const ticket = await tx.serviceTicket.findUniqueOrThrow({
          where: { id },
          include: { lines: { include: { product: true } } },
        });
        if (ticket.deliveredAt)
          throw new ConflictException('Already handed back');
        if (ticket.status !== 'READY' && ticket.status !== 'CANCELLED') {
          throw new ConflictException(
            'Mark the ticket READY (or CANCELLED) first',
          );
        }

        let saleId: string | null = null;
        const chargeable =
          ticket.status === 'READY' &&
          !ticket.underWarranty &&
          ticket.quotedLak.gt(0);
        const serialsLeft = Object.fromEntries(
          Object.entries(input.partSerials).map(([k, v]) => [k, [...v]]),
        );
        const takeSerials = (productId: string, qty: number) =>
          (serialsLeft[productId] ?? []).splice(0, qty);

        if (chargeable) {
          if (!input.registerId || !input.payments.length) {
            throw new BadRequestException(
              'Give the register and payments to charge the repair',
            );
          }
          const service = await this.repairServiceProduct(tx);
          const items: SaleItemInput[] = ticket.lines.map((l) =>
            l.product && l.product.type !== 'SERVICE'
              ? {
                  productId: l.product.id,
                  quantity: l.quantity,
                  unitPriceLak: Number(l.unitPriceLak),
                  discountLak: 0,
                  serials: l.product.trackSerial
                    ? takeSerials(l.product.id, l.quantity)
                    : undefined,
                }
              : {
                  productId: l.product?.id ?? service.id,
                  quantity: l.quantity,
                  unitPriceLak: Number(l.unitPriceLak),
                  discountLak: 0,
                  description: l.description,
                },
          );
          const sale = await this.sales.create(
            {
              registerId: input.registerId,
              customerId: ticket.customerId,
              items,
              discountLak: 0,
              payments: input.payments,
              note: input.note ?? `Repair ${ticket.ticketNo}`,
              approvals: {},
            },
            user,
            { preApproved: true, applyPromotions: false, tx },
          );
          saleId = sale.id;
        } else if (ticket.status === 'READY') {
          // Free (warranty) repair: parts still leave stock, against the ticket.
          const ref = {
            refType: 'SERVICE_TICKET',
            refId: id,
            userId: user.id,
            branchId: ticket.branchId,
          };
          for (const l of ticket.lines) {
            if (!l.product || l.product.type === 'SERVICE') continue;
            await this.ledger.remove(
              tx,
              l.product.id,
              {
                quantity: l.quantity,
                type: 'ISSUE_OUT',
                serials: l.product.trackSerial
                  ? takeSerials(l.product.id, l.quantity)
                  : undefined,
                serialStatus: 'ISSUED',
              },
              ref,
            );
          }
        }

        await tx.serviceTicket.update({
          where: { id },
          data: {
            status: ticket.status === 'READY' ? 'DELIVERED' : 'CANCELLED',
            deliveredAt: new Date(),
            saleId,
          },
        });
        await tx.serviceTicketLog.create({
          data: {
            ticketId: id,
            status: 'DELIVERED',
            userId: user.id,
            note: input.note ?? 'Handed back to the customer',
          },
        });
        if (ticket.serialId) {
          await tx.serialNumber.updateMany({
            where: { id: ticket.serialId, status: 'IN_SERVICE' },
            data: { status: 'SOLD' },
          });
        }
      },
      { timeout: 30_000 },
    );
    return this.get(id);
  }

  private async repairServiceProduct(tx: Tx) {
    const existing = await tx.product.findFirst({
      where: { sku: REPAIR_SERVICE_SKU },
    });
    if (existing) return existing;
    const category = await tx.category.findFirst({
      where: { slug: 'service' },
    });
    return tx.product.create({
      data: {
        sku: REPAIR_SERVICE_SKU,
        name: 'Repair service',
        type: 'SERVICE',
        trackStock: false,
        retailPrice: 0,
        categoryId: category?.id,
      },
    });
  }
}
