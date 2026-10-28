import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../common/audit.service.js';
import { pageArgs, toPage, type PageQuery } from '../common/pagination.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  ListMovementsQuery,
  ListSerialsQuery,
  UpdateSerialInput,
} from './stock.schemas.js';

const dayAfter = (d?: Date) => d && new Date(d.getTime() + 86_400_000);

@Injectable()
export class StockQueriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Stock card: every movement, newest first. */
  async movements(query: ListMovementsQuery, canViewCost: boolean) {
    const where: Prisma.StockMovementWhereInput = {
      productId: query.productId,
      type: query.type,
      createdAt: { gte: query.from, lt: dayAfter(query.to) },
    };
    const [rows, total] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { balanceAfter: 'desc' }],
        include: {
          product: { select: { id: true, sku: true, name: true } },
          serial: { select: { serial: true } },
          lot: { select: { lotNo: true, expiryDate: true } },
          user: { select: { id: true, fullName: true } },
        },
        ...pageArgs(query),
      }),
      this.prisma.stockMovement.count({ where }),
    ]);
    const items = canViewCost
      ? rows
      : rows.map(({ unitCostLak: _cost, ...m }) => m);
    return toPage(items, total, query);
  }

  async serials(query: ListSerialsQuery, canViewCost: boolean) {
    const where: Prisma.SerialNumberWhereInput = {
      productId: query.productId,
      status: query.status,
      condition: query.condition,
      ...(query.q && { serial: { contains: query.q, mode: 'insensitive' } }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.serialNumber.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { product: { select: { id: true, sku: true, name: true } } },
        ...pageArgs(query),
      }),
      this.prisma.serialNumber.count({ where }),
    ]);
    const items = canViewCost
      ? rows
      : rows.map(({ costLak: _cost, ...s }) => s);
    return toPage(items, total, query);
  }

  /**
   * Warranty lookup: where a unit came from, who bought it, warranty left, repairs.
   */
  async serialHistory(serial: string, canViewCost: boolean) {
    const unit = await this.prisma.serialNumber.findFirst({
      where: { serial },
      include: {
        product: {
          select: { id: true, sku: true, name: true, warrantyMonths: true },
        },
        receivedItem: {
          select: {
            document: {
              select: {
                id: true,
                docNo: true,
                postedAt: true,
                supplier: { select: { id: true, name: true } },
              },
            },
          },
        },
        saleItem: {
          select: {
            sale: {
              select: {
                id: true,
                receiptNo: true,
                createdAt: true,
                status: true,
                customer: { select: { id: true, name: true, phone: true } },
              },
            },
          },
        },
        movements: {
          orderBy: { createdAt: 'asc' },
          select: {
            type: true,
            quantity: true,
            refType: true,
            refId: true,
            createdAt: true,
          },
        },
        tickets: {
          orderBy: { receivedAt: 'desc' },
          select: {
            id: true,
            ticketNo: true,
            status: true,
            problem: true,
            receivedAt: true,
          },
        },
      },
    });
    if (!unit) throw new NotFoundException(`Serial ${serial} not found`);

    const now = Date.now();
    const daysLeft = (end: Date | null) =>
      end ? Math.max(0, Math.ceil((end.getTime() - now) / 86_400_000)) : null;
    const { costLak, receivedItem, saleItem, ...rest } = unit;
    return {
      ...rest,
      ...(canViewCost && { costLak }),
      received: receivedItem?.document ?? null,
      sale: saleItem?.sale ?? null,
      warranty: {
        endsAt: unit.warrantyEndsAt,
        daysLeft: daysLeft(unit.warrantyEndsAt),
        active: unit.warrantyEndsAt
          ? unit.warrantyEndsAt.getTime() > now
          : false,
      },
      supplierWarranty: {
        endsAt: unit.supplierWarrantyEndsAt,
        daysLeft: daysLeft(unit.supplierWarrantyEndsAt),
      },
    };
  }

  async updateSerial(id: string, input: UpdateSerialInput, actorId: string) {
    const before = await this.prisma.serialNumber.findUniqueOrThrow({
      where: { id },
    });
    const serial = await this.prisma.serialNumber.update({
      where: { id },
      data: input,
    });
    await this.audit.log({
      userId: actorId,
      action: 'SERIAL_UPDATE',
      entity: 'SerialNumber',
      entityId: id,
      before,
      after: serial,
    });
    return serial;
  }

  /** Lots with stock left that expire within `withinDays` (already expired ones included). */
  async expiringLots(
    query: { withinDays: number; productId?: string } & PageQuery,
  ) {
    const where: Prisma.StockLotWhereInput = {
      productId: query.productId,
      qty: { gt: 0 },
      expiryDate: { lte: new Date(Date.now() + query.withinDays * 86_400_000) },
    };
    const [items, total] = await Promise.all([
      this.prisma.stockLot.findMany({
        where,
        orderBy: { expiryDate: 'asc' },
        include: {
          product: {
            select: { id: true, sku: true, name: true, location: true },
          },
        },
        ...pageArgs(query),
      }),
      this.prisma.stockLot.count({ where }),
    ]);
    return toPage(items, total, query);
  }
}
