import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import {
  Prisma,
  type ItemCondition,
  type Product,
  type StockMoveType,
} from '../generated/prisma/client.js';
import { RequestContext } from '../common/request-context.js';

type Tx = Prisma.TransactionClient;
const Decimal = Prisma.Decimal;

export type MoveRef = {
  /** "STOCK_DOC" | "SALE" | "SALE_RETURN" | "SERVICE_TICKET" */
  refType: string;
  refId: string;
  userId: string;
  /** Branch whose stock changes. */
  branchId: string;
};

/** True when quantity is counted for this product (not a service, bundle or "unspecified quantity" item). */
export function countsStock(p: Pick<Product, 'type' | 'trackStock'>): boolean {
  return p.type === 'STANDARD' && p.trackStock;
}

/**
 * The only code that changes stock. Every change updates the branch's BranchStock row,
 * Product.stockQty (the total over branches) and writes a StockMovement row in the
 * caller's transaction, so the ledger always sums to the stock, per branch and in total.
 */
@Injectable()
export class StockLedgerService {
  /** Locks the product row for the rest of the transaction and returns it. */
  async lockProduct(tx: Tx, productId: string): Promise<Product> {
    const [row] = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Product"
      WHERE "id" = ${productId} AND "tenantId" = ${RequestContext.tenantId()}
      FOR UPDATE`;
    if (!row) throw new BadRequestException(`Unknown product ${productId}`);
    return tx.product.findUniqueOrThrow({ where: { id: productId } });
  }

  /**
   * Applies a signed quantity change at `ref.branchId`; refuses to take the branch below
   * zero. The caller holds the product lock. Returns the branch's new balance.
   */
  private async apply(
    tx: Tx,
    product: Product,
    quantity: number,
    type: StockMoveType,
    ref: MoveRef,
    extra: {
      unitCostLak?: Prisma.Decimal;
      serialId?: string;
      lotId?: string;
    } = {},
  ): Promise<number> {
    const key = { branchId: ref.branchId, productId: product.id };
    let balance: number;
    if (quantity < 0) {
      const updated = await tx.branchStock.updateMany({
        where: { ...key, qty: { gte: -quantity } },
        data: { qty: { increment: quantity } },
      });
      if (updated.count === 0) {
        throw new ConflictException({
          message: `Not enough stock for ${product.sku} at this branch`,
          code: 'INSUFFICIENT_STOCK',
        });
      }
      balance = (
        await tx.branchStock.findFirstOrThrow({
          where: key,
          select: { qty: true },
        })
      ).qty;
    } else {
      balance = (
        await tx.branchStock.upsert({
          where: { branchId_productId: key },
          create: { ...key, qty: quantity },
          update: { qty: { increment: quantity } },
          select: { qty: true },
        })
      ).qty;
    }
    await tx.product.update({
      where: { id: product.id },
      data: { stockQty: { increment: quantity } },
    });
    await tx.stockMovement.create({
      data: {
        productId: product.id,
        type,
        quantity,
        balanceAfter: balance,
        unitCostLak: extra.unitCostLak ?? product.avgCostLak,
        serialId: extra.serialId,
        lotId: extra.lotId,
        ...ref,
      },
    });
    return balance;
  }

  /**
   * Receives quantity. Serialized products need one new serial per unit; expiry-tracked
   * products need a lot. When `updateAverageCost`, the moving-average cost is recomputed.
   * Returns the serial ids created.
   */
  async receive(
    tx: Tx,
    productId: string,
    input: {
      quantity: number;
      unitCostLak: Prisma.Decimal;
      type: StockMoveType;
      serials?: string[];
      condition?: ItemCondition;
      lot?: { lotNo?: string | null; expiryDate: Date };
      receivedItemId?: string;
      updateAverageCost: boolean;
    },
    ref: MoveRef,
  ): Promise<string[]> {
    const product = await this.lockProduct(tx, productId);
    if (!countsStock(product)) {
      throw new BadRequestException(`${product.sku} does not keep stock`);
    }
    if (input.quantity <= 0)
      throw new BadRequestException('Quantity must be positive');

    if (input.updateAverageCost) {
      const oldQty = Math.max(product.stockQty, 0);
      const avg =
        oldQty === 0
          ? input.unitCostLak
          : product.avgCostLak
              .mul(oldQty)
              .add(input.unitCostLak.mul(input.quantity))
              .div(oldQty + input.quantity)
              .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
      await tx.product.update({
        where: { id: productId },
        data: { avgCostLak: avg },
      });
    }

    const serialIds: string[] = [];
    if (product.trackSerial) {
      const serials = input.serials ?? [];
      if (
        serials.length !== input.quantity ||
        new Set(serials).size !== serials.length
      ) {
        throw new BadRequestException(
          `${product.sku}: send ${input.quantity} distinct serial numbers`,
        );
      }
      const existing = await tx.serialNumber.findMany({
        where: { serial: { in: serials } },
        select: { serial: true },
      });
      if (existing.length) {
        throw new ConflictException(
          `Serial already exists: ${existing.map((s) => s.serial).join(', ')}`,
        );
      }
      for (const serial of serials) {
        const row = await tx.serialNumber.create({
          data: {
            serial,
            productId,
            branchId: ref.branchId,
            condition: input.condition ?? 'NEW',
            costLak: input.unitCostLak,
            receivedItemId: input.receivedItemId,
          },
        });
        serialIds.push(row.id);
        await this.apply(tx, product, 1, input.type, ref, {
          unitCostLak: input.unitCostLak,
          serialId: row.id,
        });
      }
      return serialIds;
    }

    let lotId: string | undefined;
    if (product.trackExpiry) {
      if (!input.lot)
        throw new BadRequestException(`${product.sku}: expiry date required`);
      lotId = (
        await tx.stockLot.create({
          data: {
            productId,
            branchId: ref.branchId,
            lotNo: input.lot.lotNo,
            expiryDate: input.lot.expiryDate,
            qty: input.quantity,
          },
        })
      ).id;
    }
    await this.apply(tx, product, input.quantity, input.type, ref, {
      unitCostLak: input.unitCostLak,
      lotId,
    });
    return serialIds;
  }

  /**
   * Takes quantity out. Serialized products must name the serials (which must be in stock);
   * expiry-tracked products are taken first-expiry-first-out. Returns the serial ids taken.
   */
  async remove(
    tx: Tx,
    productId: string,
    input: {
      quantity: number;
      type: StockMoveType;
      serials?: string[];
      /** Status the removed serials get (SOLD, ISSUED, DEFECTIVE …). */
      serialStatus: 'SOLD' | 'ISSUED' | 'DEFECTIVE' | 'IN_SERVICE';
      serialData?: Prisma.SerialNumberUncheckedUpdateManyInput;
    },
    ref: MoveRef,
  ): Promise<{ serialIds: string[]; costLak: Prisma.Decimal }> {
    const product = await this.lockProduct(tx, productId);
    if (!countsStock(product))
      return { serialIds: [], costLak: product.avgCostLak };
    if (input.quantity <= 0)
      throw new BadRequestException('Quantity must be positive');

    if (product.trackSerial) {
      const serials = input.serials ?? [];
      if (
        serials.length !== input.quantity ||
        new Set(serials).size !== serials.length
      ) {
        throw new BadRequestException(
          `${product.sku}: scan ${input.quantity} distinct serial numbers`,
        );
      }
      const rows = await tx.serialNumber.findMany({
        where: {
          serial: { in: serials },
          productId,
          status: 'IN_STOCK',
          branchId: ref.branchId,
        },
      });
      if (rows.length !== serials.length) {
        const ok = new Set(rows.map((r) => r.serial));
        throw new ConflictException({
          message: `Not in stock at this branch for ${product.sku}: ${serials.filter((s) => !ok.has(s)).join(', ')}`,
          code: 'INSUFFICIENT_STOCK',
        });
      }
      let cost = new Decimal(0);
      for (const row of rows) {
        await tx.serialNumber.update({
          where: { id: row.id },
          data: { ...input.serialData, status: input.serialStatus },
        });
        const unitCost = row.costLak ?? product.avgCostLak;
        cost = cost.add(unitCost);
        await this.apply(tx, product, -1, input.type, ref, {
          unitCostLak: unitCost,
          serialId: row.id,
        });
      }
      return {
        serialIds: rows.map((r) => r.id),
        costLak: cost
          .div(rows.length)
          .toDecimalPlaces(0, Decimal.ROUND_HALF_UP),
      };
    }

    if (product.trackExpiry) {
      let left = input.quantity;
      const lots = await tx.stockLot.findMany({
        where: { productId, branchId: ref.branchId, qty: { gt: 0 } },
        orderBy: [{ expiryDate: 'asc' }, { receivedAt: 'asc' }],
      });
      for (const lot of lots) {
        if (left === 0) break;
        const take = Math.min(left, lot.qty);
        await tx.stockLot.update({
          where: { id: lot.id },
          data: { qty: { decrement: take } },
        });
        await this.apply(tx, product, -take, input.type, ref, {
          lotId: lot.id,
        });
        left -= take;
      }
      if (left > 0)
        throw new ConflictException({
          message: `Not enough stock for ${product.sku}`,
          code: 'INSUFFICIENT_STOCK',
        });
      return { serialIds: [], costLak: product.avgCostLak };
    }

    await this.apply(tx, product, -input.quantity, input.type, ref);
    return { serialIds: [], costLak: product.avgCostLak };
  }

  /** Takes quantity out of one specific lot (cancelling the receipt that created it). */
  async removeFromLot(
    tx: Tx,
    productId: string,
    lotId: string,
    quantity: number,
    type: StockMoveType,
    ref: MoveRef,
  ) {
    const product = await this.lockProduct(tx, productId);
    const { count } = await tx.stockLot.updateMany({
      where: { id: lotId, qty: { gte: quantity } },
      data: { qty: { decrement: quantity } },
    });
    if (count === 0) {
      throw new ConflictException(
        `Lot of ${product.sku} was already partly used`,
      );
    }
    await this.apply(tx, product, -quantity, type, ref, { lotId });
  }

  /**
   * Takes back sold units (void or return). Bundles put back their components; serials
   * go back as IN_STOCK, or DEFECTIVE (recorded, not stock); non-serial items are only
   * restocked when the status is IN_STOCK.
   */
  async restoreSoldUnits(
    tx: Tx,
    input: {
      productId: string;
      quantity: number;
      serialIds: string[];
      unitCostLak: Prisma.Decimal;
      type: StockMoveType;
      status?: 'IN_STOCK' | 'DEFECTIVE';
    },
    ref: MoveRef,
  ) {
    const status = input.status ?? 'IN_STOCK';
    const product = await tx.product.findUniqueOrThrow({
      where: { id: input.productId },
      include: { bundleItems: { include: { component: true } } },
    });
    if (product.type !== 'BUNDLE') {
      if (input.serialIds.length) {
        await this.restoreSerials(
          tx,
          product.id,
          input.serialIds,
          input.type,
          ref,
          status,
        );
      } else if (status === 'IN_STOCK') {
        await this.restoreQuantity(
          tx,
          product.id,
          input.quantity,
          input.unitCostLak,
          input.type,
          ref,
        );
      }
      return;
    }
    const serials = await tx.serialNumber.findMany({
      where: { id: { in: input.serialIds } },
      select: { id: true, productId: true },
    });
    for (const { component, quantity } of product.bundleItems) {
      if (!countsStock(component)) continue;
      if (component.trackSerial) {
        const ids = serials
          .filter((s) => s.productId === component.id)
          .map((s) => s.id);
        if (ids.length)
          await this.restoreSerials(
            tx,
            component.id,
            ids,
            input.type,
            ref,
            status,
          );
      } else if (status === 'IN_STOCK') {
        await this.restoreQuantity(
          tx,
          component.id,
          input.quantity * quantity,
          component.avgCostLak,
          input.type,
          ref,
        );
      }
    }
  }

  /** Puts previously removed serials back in stock (void, return, cancelled issue). */
  async restoreSerials(
    tx: Tx,
    productId: string,
    serialIds: string[],
    type: StockMoveType,
    ref: MoveRef,
    status: 'IN_STOCK' | 'DEFECTIVE' = 'IN_STOCK',
  ) {
    const product = await this.lockProduct(tx, productId);
    for (const id of serialIds) {
      const serial = await tx.serialNumber.update({
        where: { id },
        data: {
          status,
          branchId: ref.branchId,
          saleItemId: null,
          soldAt: null,
          warrantyEndsAt: null,
        },
      });
      // Defective returns are recorded but do not count as sellable stock.
      if (status === 'IN_STOCK') {
        await this.apply(tx, product, 1, type, ref, {
          unitCostLak: serial.costLak ?? product.avgCostLak,
          serialId: id,
        });
      }
    }
  }

  /** Puts quantity back for non-serial products (void, return); lots go back to the newest lot. */
  async restoreQuantity(
    tx: Tx,
    productId: string,
    quantity: number,
    unitCostLak: Prisma.Decimal,
    type: StockMoveType,
    ref: MoveRef,
  ) {
    const product = await this.lockProduct(tx, productId);
    if (!countsStock(product) || quantity <= 0) return;
    let lotId: string | undefined;
    if (product.trackExpiry) {
      const lot = await tx.stockLot.findFirst({
        where: { productId, branchId: ref.branchId },
        orderBy: { expiryDate: 'desc' },
      });
      if (lot) {
        await tx.stockLot.update({
          where: { id: lot.id },
          data: { qty: { increment: quantity } },
        });
        lotId = lot.id;
      }
    }
    await this.apply(tx, product, quantity, type, ref, { unitCostLak, lotId });
  }

  /**
   * Moves units between two branches of the same company: TRANSFER_OUT at the source and
   * TRANSFER_IN at the destination, so the company total does not change. Serials keep
   * their status and move branch; lots move first-expiry-first-out and keep lot no/expiry.
   */
  async transfer(
    tx: Tx,
    productId: string,
    input: { quantity: number; serials?: string[]; toBranchId: string },
    ref: MoveRef,
  ): Promise<void> {
    const product = await this.lockProduct(tx, productId);
    if (!countsStock(product)) {
      throw new BadRequestException(`${product.sku} does not keep stock`);
    }
    if (input.quantity <= 0)
      throw new BadRequestException('Quantity must be positive');
    if (input.toBranchId === ref.branchId)
      throw new BadRequestException(
        'Source and destination branch are the same',
      );
    const inRef = { ...ref, branchId: input.toBranchId };

    if (product.trackSerial) {
      const serials = input.serials ?? [];
      if (
        serials.length !== input.quantity ||
        new Set(serials).size !== serials.length
      ) {
        throw new BadRequestException(
          `${product.sku}: send ${input.quantity} distinct serial numbers`,
        );
      }
      const rows = await tx.serialNumber.findMany({
        where: {
          serial: { in: serials },
          productId,
          status: 'IN_STOCK',
          branchId: ref.branchId,
        },
      });
      if (rows.length !== serials.length) {
        const ok = new Set(rows.map((r) => r.serial));
        throw new ConflictException({
          message: `Not in stock at the source branch for ${product.sku}: ${serials.filter((s) => !ok.has(s)).join(', ')}`,
          code: 'INSUFFICIENT_STOCK',
        });
      }
      for (const row of rows) {
        const unitCostLak = row.costLak ?? product.avgCostLak;
        await this.apply(tx, product, -1, 'TRANSFER_OUT', ref, {
          unitCostLak,
          serialId: row.id,
        });
        await tx.serialNumber.update({
          where: { id: row.id },
          data: { branchId: input.toBranchId },
        });
        await this.apply(tx, product, 1, 'TRANSFER_IN', inRef, {
          unitCostLak,
          serialId: row.id,
        });
      }
      return;
    }

    if (product.trackExpiry) {
      let left = input.quantity;
      const lots = await tx.stockLot.findMany({
        where: { productId, branchId: ref.branchId, qty: { gt: 0 } },
        orderBy: [{ expiryDate: 'asc' }, { receivedAt: 'asc' }],
      });
      for (const lot of lots) {
        if (left === 0) break;
        const take = Math.min(left, lot.qty);
        await tx.stockLot.update({
          where: { id: lot.id },
          data: { qty: { decrement: take } },
        });
        await this.apply(tx, product, -take, 'TRANSFER_OUT', ref, {
          lotId: lot.id,
        });
        const same = await tx.stockLot.findFirst({
          where: {
            productId,
            branchId: input.toBranchId,
            lotNo: lot.lotNo,
            expiryDate: lot.expiryDate,
          },
        });
        const target = same
          ? await tx.stockLot.update({
              where: { id: same.id },
              data: { qty: { increment: take } },
            })
          : await tx.stockLot.create({
              data: {
                productId,
                branchId: input.toBranchId,
                lotNo: lot.lotNo,
                expiryDate: lot.expiryDate,
                qty: take,
              },
            });
        await this.apply(tx, product, take, 'TRANSFER_IN', inRef, {
          lotId: target.id,
        });
        left -= take;
      }
      if (left > 0)
        throw new ConflictException({
          message: `Not enough stock for ${product.sku} at this branch`,
          code: 'INSUFFICIENT_STOCK',
        });
      return;
    }

    await this.apply(tx, product, -input.quantity, 'TRANSFER_OUT', ref);
    await this.apply(tx, product, input.quantity, 'TRANSFER_IN', inRef);
  }
}
