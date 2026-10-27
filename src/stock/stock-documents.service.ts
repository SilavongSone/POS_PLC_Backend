import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { BranchAccessService } from '../branches/branch-access.service.js';
import { AuditService } from '../common/audit.service.js';
import { DocNumberService } from '../common/doc-number.service.js';
import { pageArgs, toPage } from '../common/pagination.js';
import { hasPermission, type Permission } from '../common/permissions.js';
import { costToLak } from '../catalog/pricing.js';
import { Prisma, type StockDocType } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ExchangeRatesService } from '../settings/exchange-rates.service.js';
import {
  countsStock,
  StockLedgerService,
  type MoveRef,
} from './stock-ledger.service.js';
import type { ListStockDocsQuery, StockDocInput } from './stock.schemas.js';
import { EntitlementsService } from '../tenancy/entitlements.service.js';

const Decimal = Prisma.Decimal;

const PERMISSION_FOR: Record<StockDocType, Permission> = {
  RECEIVE: 'stock.receive',
  ISSUE: 'stock.issue',
  ADJUST: 'stock.adjust',
  TRANSFER: 'stock.transfer',
};
/** Receipts and positive adjustments bring stock in; issues and negative adjustments take it out. */
function isInbound(type: StockDocType, quantity: number): boolean {
  return type === 'RECEIVE' || (type === 'ADJUST' && quantity > 0);
}

const PREFIX_FOR: Record<StockDocType, string> = {
  RECEIVE: 'GR',
  ISSUE: 'GI',
  ADJUST: 'ADJ',
  TRANSFER: 'TR',
};

const branchSelect = { select: { id: true, code: true, name: true } } as const;

const detailInclude = {
  branch: branchSelect,
  toBranch: branchSelect,
  supplier: { select: { id: true, name: true } },
  createdBy: { select: { id: true, fullName: true } },
  items: {
    include: {
      product: {
        select: {
          id: true,
          sku: true,
          name: true,
          trackSerial: true,
          trackExpiry: true,
          unit: true,
        },
      },
      serials: {
        select: { id: true, serial: true, status: true, condition: true },
      },
    },
  },
} satisfies Prisma.StockDocumentInclude;

@Injectable()
export class StockDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: StockLedgerService,
    private readonly docNumbers: DocNumberService,
    private readonly rates: ExchangeRatesService,
    private readonly audit: AuditService,
    private readonly branches: BranchAccessService,
    private readonly entitlements: EntitlementsService,
  ) {}

  private assertCan(user: AuthUser, type: StockDocType) {
    if (!hasPermission(user.permissions, PERMISSION_FOR[type])) {
      throw new ForbiddenException(
        `Missing permission: ${PERMISSION_FOR[type]}`,
      );
    }
  }

  async list(query: ListStockDocsQuery, user: AuthUser) {
    const scope = this.branches.scope(user, query.branchId);
    const where: Prisma.StockDocumentWhereInput = {
      ...(scope && {
        AND: [
          {
            OR: [{ branchId: { in: scope } }, { toBranchId: { in: scope } }],
          },
        ],
      }),
      type: query.type,
      status: query.status,
      supplierId: query.supplierId,
      createdAt: {
        gte: query.from,
        lt: query.to && new Date(query.to.getTime() + 86_400_000),
      },
      ...(query.q && {
        OR: [
          { docNo: { contains: query.q, mode: 'insensitive' } },
          { reference: { contains: query.q, mode: 'insensitive' } },
        ],
      }),
    };
    const [items, total] = await Promise.all([
      this.prisma.stockDocument.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          branch: branchSelect,
          toBranch: branchSelect,
          supplier: { select: { id: true, name: true } },
          createdBy: { select: { id: true, fullName: true } },
        },
        ...pageArgs(query),
      }),
      this.prisma.stockDocument.count({ where }),
    ]);
    // Line counts for this page only (Prisma's _count would aggregate the whole table).
    const counts = await this.prisma.stockDocumentItem.groupBy({
      by: ['documentId'],
      where: { documentId: { in: items.map((r) => r.id) } },
      _count: true,
    });
    const byId = new Map(counts.map((c) => [c.documentId, c._count]));
    return toPage(
      items.map((r) => ({ ...r, _count: { items: byId.get(r.id) ?? 0 } })),
      total,
      query,
    );
  }

  async get(id: string, user?: AuthUser) {
    const doc = await this.prisma.stockDocument.findUniqueOrThrow({
      where: { id },
      include: detailInclude,
    });
    if (user) this.assertBranch(user, doc);
    return doc;
  }

  /** Users limited to some branches see documents that send to or from them. */
  private assertBranch(
    user: AuthUser,
    doc: { branchId: string; toBranchId: string | null },
  ) {
    if (
      user.branchIds &&
      !user.branchIds.includes(doc.branchId) &&
      !(doc.toBranchId && user.branchIds.includes(doc.toBranchId))
    ) {
      this.branches.assertAccess(user, doc.branchId);
    }
  }

  /** The sending branch, and for transfers a different, active receiving branch. */
  private async resolveBranches(input: StockDocInput, user: AuthUser) {
    const branchId = await this.branches.resolve(user, input.branchId);
    if (input.type !== 'TRANSFER') return { branchId, toBranchId: null };
    const to = await this.prisma.branch.findFirst({
      where: { id: input.toBranchId!, isActive: true },
      select: { id: true },
    });
    if (!to) throw new BadRequestException('Unknown receiving branch');
    if (to.id === branchId)
      throw new BadRequestException('Choose a different receiving branch');
    return { branchId, toBranchId: to.id };
  }

  /** Saves a DRAFT. Serial numbers are stored on the draft lines and applied on post. */
  async create(input: StockDocInput, user: AuthUser) {
    this.assertCan(user, input.type);
    if (input.type === 'TRANSFER')
      await this.entitlements.assertFeature('stockTransfers');
    const branches = await this.resolveBranches(input, user);
    const lakPerUnit = await this.resolveRate(input);
    await this.validateLines(input);
    const doc = await this.prisma.$transaction(async (tx) => {
      const docNo = await this.docNumbers.daily(tx, PREFIX_FOR[input.type]);
      return tx.stockDocument.create({
        data: {
          docNo,
          type: input.type,
          ...branches,
          supplierId: input.supplierId,
          reference: input.reference,
          note: input.note,
          currency: input.currency,
          lakPerUnit,
          createdById: user.id,
          totalLak: this.total(input, lakPerUnit),
          items: { create: this.lineData(input, lakPerUnit) },
        },
      });
    });
    return this.get(doc.id);
  }

  /** Replaces a DRAFT's header and lines. */
  async update(id: string, input: StockDocInput, user: AuthUser) {
    const doc = await this.prisma.stockDocument.findUniqueOrThrow({
      where: { id },
    });
    if (doc.status !== 'DRAFT')
      throw new ConflictException('Only drafts can be edited');
    if (doc.type !== input.type)
      throw new BadRequestException('The type cannot change');
    this.assertCan(user, doc.type);
    this.branches.assertAccess(user, doc.branchId);
    const branches = await this.resolveBranches(input, user);
    const lakPerUnit = await this.resolveRate(input);
    await this.validateLines(input);
    await this.prisma.$transaction([
      this.prisma.stockDocumentItem.deleteMany({ where: { documentId: id } }),
      this.prisma.stockDocument.update({
        where: { id },
        data: {
          ...branches,
          supplierId: input.supplierId ?? null,
          reference: input.reference,
          note: input.note,
          currency: input.currency,
          lakPerUnit,
          totalLak: this.total(input, lakPerUnit),
          items: { create: this.lineData(input, lakPerUnit) },
        },
      }),
    ]);
    return this.get(id);
  }

  /** Applies a DRAFT to stock in one transaction. */
  async post(id: string, user: AuthUser) {
    await this.prisma.$transaction(
      async (tx) => {
        const doc = await tx.stockDocument.findUniqueOrThrow({
          where: { id },
          include: { items: { include: { product: true } } },
        });
        this.assertCan(user, doc.type);
        this.branches.assertAccess(user, doc.branchId);
        // Claim the draft first so two posts cannot both apply it.
        const claimed = await tx.stockDocument.updateMany({
          where: { id, status: 'DRAFT' },
          data: { status: 'POSTED', postedAt: new Date() },
        });
        if (claimed.count === 0)
          throw new ConflictException('Only drafts can be posted');

        const ref: MoveRef = {
          refType: 'STOCK_DOC',
          refId: id,
          userId: user.id,
          branchId: doc.branchId,
        };
        for (const item of doc.items) {
          const serials = item.draftSerials;
          if (doc.type === 'TRANSFER') {
            await this.ledger.transfer(
              tx,
              item.productId,
              { quantity: item.quantity, serials, toBranchId: doc.toBranchId! },
              ref,
            );
          } else if (
            doc.type === 'RECEIVE' ||
            (doc.type === 'ADJUST' && item.quantity > 0)
          ) {
            const isReceipt = doc.type === 'RECEIVE';
            const unitCostLak = isReceipt
              ? item.unitCostLak
              : item.product.avgCostLak;
            await this.ledger.receive(
              tx,
              item.productId,
              {
                quantity: item.quantity,
                unitCostLak,
                type: isReceipt ? 'RECEIVE_IN' : 'ADJUST_IN',
                serials,
                condition: item.condition,
                lot: item.expiryDate
                  ? { lotNo: item.lotNo, expiryDate: item.expiryDate }
                  : undefined,
                receivedItemId: item.id,
                updateAverageCost: isReceipt,
              },
              ref,
            );
            if (isReceipt) {
              await tx.product.update({
                where: { id: item.productId },
                data: { costPrice: item.unitCost, costCurrency: doc.currency },
              });
            }
          } else {
            await this.ledger.remove(
              tx,
              item.productId,
              {
                quantity: Math.abs(item.quantity),
                type: doc.type === 'ISSUE' ? 'ISSUE_OUT' : 'ADJUST_OUT',
                serials,
                serialStatus: 'ISSUED',
              },
              ref,
            );
          }
        }
        await this.audit.log(
          {
            userId: user.id,
            action: 'STOCK_DOC_POST',
            entity: 'StockDocument',
            entityId: id,
          },
          tx,
        );
      },
      { timeout: 30_000 },
    );
    return this.get(id);
  }

  /**
   * Cancels a draft, or reverses a posted document (only while its effect can still be
   * undone: received serials/lots unsold, issued serials not re-used).
   */
  async cancel(id: string, reason: string, user: AuthUser) {
    await this.prisma.$transaction(
      async (tx) => {
        const doc = await tx.stockDocument.findUniqueOrThrow({
          where: { id },
          include: { items: { include: { product: true, serials: true } } },
        });
        this.assertCan(user, doc.type);
        this.branches.assertAccess(user, doc.branchId);
        const claimed = await tx.stockDocument.updateMany({
          where: { id, status: { in: ['DRAFT', 'POSTED'] } },
          data: {
            status: 'CANCELLED',
            note: [doc.note, `Cancelled: ${reason}`].filter(Boolean).join('\n'),
          },
        });
        if (claimed.count === 0)
          throw new ConflictException('Already cancelled');
        if (doc.status === 'DRAFT') return;

        const ref: MoveRef = {
          refType: 'STOCK_DOC',
          refId: id,
          userId: user.id,
          branchId: doc.branchId,
        };
        if (doc.type === 'TRANSFER') {
          // Send everything back; the receiving branch must still have it.
          for (const item of doc.items) {
            await this.ledger.transfer(
              tx,
              item.productId,
              {
                quantity: item.quantity,
                serials: item.draftSerials,
                toBranchId: doc.branchId,
              },
              { ...ref, branchId: doc.toBranchId! },
            );
          }
        }
        const lotProductsDone = new Set<string>();
        for (const item of doc.type === 'TRANSFER' ? [] : doc.items) {
          if (!countsStock(item.product)) continue;
          if (item.product.trackExpiry && isInbound(doc.type, item.quantity)) {
            // Reverse every lot this document created for the product, once.
            if (lotProductsDone.has(item.productId)) continue;
            lotProductsDone.add(item.productId);
            await this.reverseLots(
              tx,
              item.productId,
              doc.type === 'RECEIVE',
              ref,
            );
            continue;
          }
          const wasIn = isInbound(doc.type, item.quantity);
          if (wasIn) {
            await this.reverseReceipt(tx, doc.type === 'RECEIVE', item, ref);
          } else {
            await this.reverseIssue(tx, id, item, ref);
          }
        }
        await this.audit.log(
          {
            userId: user.id,
            action: 'STOCK_DOC_CANCEL',
            entity: 'StockDocument',
            entityId: id,
            after: { reason },
          },
          tx,
        );
      },
      { timeout: 30_000 },
    );
    return this.get(id);
  }

  private async reverseReceipt(
    tx: Prisma.TransactionClient,
    isReceipt: boolean,
    item: Prisma.StockDocumentItemGetPayload<{
      include: { product: true; serials: true };
    }>,
    ref: MoveRef,
  ) {
    const type = isReceipt ? 'ISSUE_OUT' : 'ADJUST_OUT';
    if (item.product.trackSerial) {
      await this.ledger.remove(
        tx,
        item.productId,
        {
          quantity: item.serials.length,
          type,
          serials: item.serials.map((s) => s.serial),
          serialStatus: 'ISSUED',
        },
        ref,
      );
    } else {
      await this.ledger.remove(
        tx,
        item.productId,
        { quantity: item.quantity, type, serialStatus: 'ISSUED' },
        ref,
      );
    }
    if (isReceipt) {
      // Take this receipt back out of the moving-average cost.
      const p = await tx.product.findUniqueOrThrow({
        where: { id: item.productId },
      });
      if (p.stockQty > 0) {
        const value = p.avgCostLak
          .mul(p.stockQty + item.quantity)
          .sub(item.unitCostLak.mul(item.quantity));
        const avg = Decimal.max(value.div(p.stockQty), 0).toDecimalPlaces(
          0,
          Decimal.ROUND_HALF_UP,
        );
        await tx.product.update({
          where: { id: p.id },
          data: { avgCostLak: avg },
        });
      }
    }
  }

  private async reverseLots(
    tx: Prisma.TransactionClient,
    productId: string,
    isReceipt: boolean,
    ref: MoveRef,
  ) {
    const moves = await tx.stockMovement.findMany({
      where: {
        refType: 'STOCK_DOC',
        refId: ref.refId,
        productId,
        quantity: { gt: 0 },
      },
    });
    for (const m of moves) {
      await this.ledger.removeFromLot(
        tx,
        productId,
        m.lotId!,
        m.quantity,
        isReceipt ? 'ISSUE_OUT' : 'ADJUST_OUT',
        ref,
      );
    }
  }

  private async reverseIssue(
    tx: Prisma.TransactionClient,
    docId: string,
    item: Prisma.StockDocumentItemGetPayload<{
      include: { product: true; serials: true };
    }>,
    ref: MoveRef,
  ) {
    if (item.product.trackSerial) {
      const moved = await tx.stockMovement.findMany({
        where: {
          refType: 'STOCK_DOC',
          refId: docId,
          productId: item.productId,
          serialId: { not: null },
        },
        include: { serial: true },
      });
      const stillIssued = moved.filter((m) => m.serial?.status === 'ISSUED');
      if (stillIssued.length !== moved.length) {
        throw new ConflictException('Some issued serials were used again');
      }
      await this.ledger.restoreSerials(
        tx,
        item.productId,
        stillIssued.map((m) => m.serialId!),
        'ADJUST_IN',
        ref,
      );
    } else {
      await this.ledger.restoreQuantity(
        tx,
        item.productId,
        Math.abs(item.quantity),
        item.product.avgCostLak,
        'ADJUST_IN',
        ref,
      );
    }
  }

  private async resolveRate(input: StockDocInput) {
    if (input.currency === 'LAK') return new Decimal(1);
    if (input.lakPerUnit) return new Decimal(input.lakPerUnit);
    return (await this.rates.current())[input.currency].lakPerUnit;
  }

  /** Checks products and the serial/lot data each line needs, before anything is saved. */
  private async validateLines(input: StockDocInput) {
    const ids = [...new Set(input.items.map((i) => i.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids } },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    if (input.supplierId) {
      await this.prisma.supplier.findUniqueOrThrow({
        where: { id: input.supplierId },
      });
    }
    const seen = new Set<string>();
    input.items.forEach((item, i) => {
      const p = byId.get(item.productId);
      const at = `items[${i}]`;
      if (!p) throw new BadRequestException(`${at}: unknown product`);
      if (!countsStock(p))
        throw new BadRequestException(`${at}: ${p.sku} does not keep stock`);
      const qty = Math.abs(item.quantity);
      if (p.trackSerial) {
        if (item.serials?.length !== qty) {
          throw new BadRequestException(
            `${at}: ${p.sku} needs ${qty} serial numbers`,
          );
        }
        for (const s of item.serials) {
          if (seen.has(s))
            throw new BadRequestException(`${at}: serial ${s} listed twice`);
          seen.add(s);
        }
      } else if (item.serials?.length) {
        throw new BadRequestException(`${at}: ${p.sku} has no serial numbers`);
      }
      const isIn =
        input.type === 'RECEIVE' ||
        (input.type === 'ADJUST' && item.quantity > 0);
      if (p.trackExpiry && isIn && !item.expiryDate) {
        throw new BadRequestException(`${at}: ${p.sku} needs an expiry date`);
      }
    });
  }

  private lineData(input: StockDocInput, lakPerUnit: Prisma.Decimal) {
    return input.items.map((i) => ({
      productId: i.productId,
      quantity: i.quantity,
      unitCost: i.unitCost,
      unitCostLak: costToLak(i.unitCost, lakPerUnit),
      condition: i.condition,
      lotNo: i.lotNo,
      expiryDate: i.expiryDate,
      draftSerials: i.serials ?? [],
    }));
  }

  private total(input: StockDocInput, lakPerUnit: Prisma.Decimal) {
    if (input.type !== 'RECEIVE') return new Decimal(0);
    return input.items.reduce(
      (sum, i) => sum.add(costToLak(i.unitCost, lakPerUnit).mul(i.quantity)),
      new Decimal(0),
    );
  }
}
