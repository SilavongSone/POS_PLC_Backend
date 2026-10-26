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

type Tx = Prisma.TransactionClient;
const Decimal = Prisma.Decimal;

export type MoveRef = {
  /** "STOCK_DOC" | "SALE" | "SALE_RETURN" | "SERVICE_TICKET" */
  refType: string;
  refId: string;
  userId: string;
};

/** True when quantity is counted for this product (not a service, bundle or "unspecified quantity" item). */
export function countsStock(p: Pick<Product, 'type' | 'trackStock'>): boolean {
  return p.type === 'STANDARD' && p.trackStock;
}

/**
 * The only code that changes stock. Every change updates Product.stockQty and writes a
 * StockMovement row in the caller's transaction, so the ledger always sums to the stock.
 */
@Injectable()
export class StockLedgerService {
  /** Locks the product row for the rest of the transaction and returns it. */
  async lockProduct(tx: Tx, productId: string): Promise<Product> {
    const [row] = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Product" WHERE "id" = ${productId} FOR UPDATE`;
    if (!row) throw new BadRequestException(`Unknown product ${productId}`);
    return tx.product.findUniqueOrThrow({ where: { id: productId } });
  }

  /** Applies a signed quantity change; refuses to go below zero. Returns the new balance. */
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
    const updated = await tx.product.updateMany({
      where: {
        id: product.id,
        stockQty: { gte: quantity < 0 ? -quantity : 0 },
      },
      data: { stockQty: { increment: quantity } },
    });
    if (updated.count === 0) {
      throw new ConflictException(`Not enough stock for ${product.sku}`);
    }
    const { stockQty } = await tx.product.findUniqueOrThrow({
      where: { id: product.id },
      select: { stockQty: true },
    });
    await tx.stockMovement.create({
      data: {
        productId: product.id,
        type,
        quantity,
        balanceAfter: stockQty,
        unitCostLak: extra.unitCostLak ?? product.avgCostLak,
        serialId: extra.serialId,
        lotId: extra.lotId,
        ...ref,
      },
    });
    return stockQty;
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
        where: { serial: { in: serials }, productId, status: 'IN_STOCK' },
      });
      if (rows.length !== serials.length) {
        const ok = new Set(rows.map((r) => r.serial));
        throw new ConflictException(
          `Not in stock for ${product.sku}: ${serials.filter((s) => !ok.has(s)).join(', ')}`,
        );
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
        where: { productId, qty: { gt: 0 } },
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
        throw new ConflictException(`Not enough stock for ${product.sku}`);
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
        data: { status, saleItemId: null, soldAt: null, warrantyEndsAt: null },
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
        where: { productId },
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
}
