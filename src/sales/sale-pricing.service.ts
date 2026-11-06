import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { atBranch, ProductsService } from '../catalog/products.service.js';
import { CustomersService } from '../customers/customers.service.js';
import { Prisma, type PriceTier } from '../generated/prisma/client.js';
import { CurrenciesService } from '../settings/currencies.service.js';
import { rateOf } from '../settings/exchange-rates.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { TaxRatesService } from '../settings/tax-rates.service.js';
import { countsStock } from '../stock/stock-ledger.service.js';
import {
  computeVat,
  lak,
  promotionDiscount,
  toLakAmount,
} from './sale-math.js';
import type { PaymentInput, QuoteSaleInput } from './sales.schemas.js';
import { freeUnits, giftsEarned } from './promotion-math.js';
import { EntitlementsService } from '../tenancy/entitlements.service.js';

type Db = Prisma.TransactionClient;
const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

export type PricedLine = {
  productId: string;
  productName: string;
  sku: string;
  /** Bundles: components and the serials scanned for each. */
  components: {
    productId: string;
    quantity: number;
    serials: string[];
    warrantyMonths: number;
  }[];
  quantity: number;
  /** Pack sold (null = base unit); stock moves quantity × unitFactor. */
  productUnitId: string | null;
  unitName: string | null;
  unitFactor: number;
  serials: string[];
  listPriceLak: Decimal;
  unitPriceLak: Decimal;
  overridden: boolean;
  promotionId: string | null;
  /** Name of the promotion used (for the cart and receipt). */
  promotionName: string | null;
  promotionDiscountLak: Decimal;
  /** Given free (or reduced) by a GIFT promotion. */
  isGift: boolean;
  manualDiscountLak: Decimal;
  discountLak: Decimal;
  lineTotalLak: Decimal;
  warrantyMonths: number;
  vatExempt: boolean;
  countsStock: boolean;
};

/** What pricing needs from a cart (sales, quotes and quotations share it). */
export type PriceInput = Pick<
  QuoteSaleInput,
  'customerId' | 'priceTier' | 'items' | 'discountLak'
> & {
  /** Branch selling (the till's): its own prices apply where set. */
  branchId?: string;
};

export type PriceOptions = {
  /** false: price without scanned serials (quotations). */
  requireSerials?: boolean;
  /** false: keep the given prices and discounts as they are (converting a quotation). */
  applyPromotions?: boolean;
};

export type PricedCart = {
  customer: { id: string; name: string; creditLimitLak: Decimal } | null;
  priceTier: PriceTier;
  lines: PricedLine[];
  subtotalLak: Decimal;
  discountLak: Decimal;
  taxRateId: string | null;
  vatPercent: Decimal;
  pricesIncludeVat: boolean;
  vatLak: Decimal;
  totalLak: Decimal;
  /** Permissions the cart needs from the user or a manager approval. */
  needsApproval: ('price.override' | 'sale.discount')[];
  /** GIFT promotions the cart earned: the till offers the gifts not taken yet. */
  giftOffers: {
    promotionId: string;
    name: string;
    productIds: string[];
    products: { id: string; name: string; sku: string }[];
    earned: number;
    given: number;
  }[];
  /** GIFT promotions used, by line index (sales store them for returns). */
  giftRules: {
    promotionId: string;
    name: string;
    buyQty: number;
    getQty: number;
    qualifying: { line: number; unitsPerItem: number }[];
    gifts: { line: number; units: number; valueLak: string }[];
  }[];
};

export type PlannedPayment = {
  paymentTypeId: string;
  name: string;
  kind: string;
  currency: string;
  amount: Decimal;
  lakPerUnit: Decimal;
  amountLak: Decimal;
  reference: string | null;
};

export type PaymentPlan = {
  payments: PlannedPayment[];
  tenderedLak: Decimal;
  creditLak: Decimal;
  paidLak: Decimal;
  changeLak: Decimal;
  paymentStatus: 'PAID' | 'PARTIAL' | 'UNPAID';
};

/**
 * Prices a cart exactly as a sale would (tier, demo-unit, promotion, manual price and
 * discounts, VAT) and checks payments. Reads only, so the till can preview totals.
 */
@Injectable()
export class SalePricingService {
  constructor(
    private readonly products: ProductsService,
    private readonly customers: CustomersService,
    private readonly settings: SettingsService,
    private readonly taxRates: TaxRatesService,
    private readonly entitlements: EntitlementsService,
    private readonly currencies: CurrenciesService,
  ) {}

  /** Prices a cart; see PriceOptions for quotations. */
  async price(
    db: Db,
    input: PriceInput,
    options: PriceOptions = {},
  ): Promise<PricedCart> {
    const requireSerials = options.requireSerials ?? true;
    // Promotions only apply when the company's plan has them.
    if (!(await this.entitlements.hasFeature('promotions'))) {
      options = { ...options, applyPromotions: false };
    }
    const customer = input.customerId
      ? await db.customer.findUniqueOrThrow({ where: { id: input.customerId } })
      : null;
    if (customer && !customer.isActive)
      throw new BadRequestException('Customer is inactive');
    const priceTier = input.priceTier ?? customer?.priceTier ?? 'RETAIL';

    const ids = [...new Set(input.items.map((i) => i.productId))];
    const [products, ctx, promotions, categories, saleRate, pricesIncludeVat] =
      await Promise.all([
        db.product.findMany({
          where: { id: { in: ids } },
          include: {
            taxRate: true,
            bundleItems: { include: { component: true } },
            units: true,
          },
        }),
        this.products.pricingContext(db),
        db.promotion.findMany({
          where: {
            isActive: true,
            startsAt: { lte: new Date() },
            OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
          },
          include: {
            items: true,
            gifts: {
              include: {
                product: { select: { id: true, name: true, sku: true } },
              },
            },
          },
        }),
        db.category.findMany({ select: { id: true, parentId: true } }),
        this.taxRates.forBranch(input.branchId, db),
        this.settings.get('tax.pricesIncludeVat', db),
      ]);
    const branchPrices = await this.products.branchPriceMap(
      ids,
      input.branchId,
      db,
    );
    const byId = new Map(products.map((p) => [p.id, p]));
    const parentOf = new Map(categories.map((c) => [c.id, c.parentId]));
    const ancestors = (categoryId: string | null) => {
      const out: string[] = [];
      for (let c = categoryId; c; c = parentOf.get(c) ?? null) out.push(c);
      return out;
    };

    const lines: PricedLine[] = [];
    const meta: {
      eligible: boolean;
      cats: string[];
      product: (typeof products)[number];
      at: string;
    }[] = [];
    // Targets: none = every product except bundles; a category never reaches a bundle.
    const targets = (
      promo: (typeof promotions)[number],
      p: (typeof products)[number],
      cats: string[],
    ) =>
      promo.items.length === 0
        ? p.type !== 'BUNDLE'
        : promo.items.some(
            (t) =>
              t.productId === p.id ||
              (p.type !== 'BUNDLE' &&
                t.categoryId !== null &&
                cats.includes(t.categoryId)),
          );
    const needs = new Set<PricedCart['needsApproval'][number]>();
    for (const [index, item] of input.items.entries()) {
      const at = `items[${index}]`;
      const p = byId.get(item.productId);
      if (!p) throw new BadRequestException(`${at}: unknown product`);
      if (!p.isActive)
        throw new BadRequestException(`${at}: ${p.sku} is not for sale`);
      if (item.description && p.type !== 'SERVICE') {
        throw new BadRequestException(
          `${at}: only services take a description`,
        );
      }
      const pack = item.productUnitId
        ? p.units.find((u) => u.id === item.productUnitId)
        : undefined;
      if (item.productUnitId && !pack?.isActive)
        throw new BadRequestException(`${at}: unknown pack for ${p.sku}`);
      const components = await this.bundleComponents(
        db,
        p,
        item,
        at,
        requireSerials,
      );
      const serials = item.serials ?? [];
      if (
        requireSerials &&
        p.trackSerial &&
        countsStock(p) &&
        serials.length !== item.quantity
      ) {
        throw new BadRequestException(
          `${at}: scan ${item.quantity} serial number(s) for ${p.sku}`,
        );
      }
      if (!p.trackSerial && serials.length) {
        throw new BadRequestException(`${at}: ${p.sku} has no serial numbers`);
      }

      // Demo units carry their own price; a line must not mix prices.
      let unitOwnPrice: Decimal | null = null;
      if (serials.length) {
        const units = await db.serialNumber.findMany({
          where: { serial: { in: serials }, productId: p.id },
          select: { serial: true, status: true, priceLak: true },
        });
        const missing = serials.filter(
          (s) => !units.some((u) => u.serial === s && u.status === 'IN_STOCK'),
        );
        if (missing.length) {
          throw new ConflictException(
            `${at}: not in stock: ${missing.join(', ')}`,
          );
        }
        const prices = new Set(
          units.map((u) => u.priceLak?.toString() ?? 'list'),
        );
        if (prices.size > 1) {
          throw new BadRequestException(
            `${at}: sell units with their own price on a separate line`,
          );
        }
        unitOwnPrice = units[0].priceLak;
      }

      // A pack has its own price (branch prices are for the base unit).
      const { retailPriceLak, wholesalePriceLak } = this.products.lakPrices(
        pack
          ? { ...pack, priceCurrency: p.priceCurrency }
          : atBranch(p, branchPrices.get(p.id)),
        ctx,
      );
      const factor = pack?.factor ?? 1;
      const wholesale =
        wholesalePriceLak !== null &&
        (priceTier === 'WHOLESALE' ||
          (p.wholesaleMinQty !== null &&
            item.quantity * factor >= p.wholesaleMinQty));
      const listPriceLak =
        unitOwnPrice ?? (wholesale ? wholesalePriceLak : retailPriceLak);
      const overridden =
        item.unitPriceLak !== undefined &&
        !listPriceLak.equals(item.unitPriceLak);
      const unitPriceLak = overridden
        ? new Decimal(item.unitPriceLak!)
        : listPriceLak;
      if (overridden) needs.add('price.override');

      // Best promotion, only on regular list prices. Bundles have their own set price:
      // only a promotion that names the bundle itself applies to them.
      const eligible =
        options.applyPromotions !== false && !overridden && !unitOwnPrice;
      const cats = ancestors(p.categoryId);
      let promotionId: string | null = null;
      let promotionName: string | null = null;
      let promotionDiscountLak = new Decimal(0);
      if (eligible) {
        for (const promo of promotions) {
          if (promo.type === 'GIFT' || !targets(promo, p, cats)) continue;
          let d: Decimal;
          if (promo.type === 'BUY_X_GET_Y') {
            const free = freeUnits(
              item.quantity,
              promo.minQty,
              promo.getQty ?? 0,
            );
            d = promotionDiscount(unitPriceLak, {
              discountType: 'PERCENT',
              value: promo.value,
            }).mul(free);
          } else {
            if (item.quantity < promo.minQty) continue;
            d = promotionDiscount(unitPriceLak, promo).mul(item.quantity);
          }
          if (d.gt(promotionDiscountLak)) {
            promotionDiscountLak = d;
            promotionId = promo.id;
            promotionName = promo.name;
          }
        }
      }

      const manualDiscountLak = new Decimal(item.discountLak ?? 0);
      if (manualDiscountLak.gt(0)) needs.add('sale.discount');
      meta.push({ eligible, cats, product: p, at });
      lines.push({
        productId: p.id,
        productName: item.description ?? p.name,
        sku: p.sku,
        components,
        quantity: item.quantity,
        productUnitId: pack?.id ?? null,
        unitName: pack?.unit ?? null,
        unitFactor: factor,
        serials,
        listPriceLak,
        unitPriceLak,
        overridden,
        promotionId,
        promotionName,
        promotionDiscountLak,
        isGift: false,
        manualDiscountLak,
        // Set once gifts are known (below).
        discountLak: new Decimal(0),
        lineTotalLak: new Decimal(0),
        warrantyMonths: p.warrantyMonths,
        vatExempt: p.taxRate !== null && p.taxRate.percent.isZero(),
        countsStock: countsStock(p),
      });
    }

    // GIFT promotions: the bought items earn gifts; gift products already in the cart get
    // them (better than their own promotion only), the rest is offered to the till.
    const giftOffers: PricedCart['giftOffers'] = [];
    const giftRules: PricedCart['giftRules'] = [];
    if (options.applyPromotions !== false) {
      for (const promo of promotions) {
        if (promo.type !== 'GIFT' || !promo.gifts.length || !promo.getQty)
          continue;
        const giftIds = new Set(promo.gifts.map((g) => g.productId));
        const qualifying = lines.flatMap((l, i) =>
          meta[i].eligible &&
          !giftIds.has(l.productId) &&
          targets(promo, meta[i].product, meta[i].cats)
            ? [{ line: i, unitsPerItem: l.unitFactor }]
            : [],
        );
        const bought = qualifying.reduce(
          (n, q) => n + lines[q.line].quantity * q.unitsPerItem,
          0,
        );
        const earned = giftsEarned(bought, promo.minQty, promo.getQty);
        if (!earned) continue;
        let left = earned;
        const gifts: PricedCart['giftRules'][number]['gifts'] = [];
        for (const [i, l] of lines.entries()) {
          if (!left || !giftIds.has(l.productId) || !meta[i].eligible) continue;
          if (l.unitFactor !== 1) continue; // gifts are single units, not packs
          const units = Math.min(left, l.quantity);
          const perUnit = promotionDiscount(l.unitPriceLak, {
            discountType: 'PERCENT',
            value: promo.value,
          });
          const d = perUnit.mul(units);
          if (!d.gt(l.promotionDiscountLak)) continue;
          l.promotionId = promo.id;
          l.promotionName = promo.name;
          l.promotionDiscountLak = d;
          l.isGift = true;
          left -= units;
          gifts.push({ line: i, units, valueLak: perUnit.toString() });
        }
        giftOffers.push({
          promotionId: promo.id,
          name: promo.name,
          productIds: [...giftIds],
          products: promo.gifts.map((g) => g.product),
          earned,
          given: earned - left,
        });
        if (gifts.length)
          giftRules.push({
            promotionId: promo.id,
            name: promo.name,
            buyQty: promo.minQty,
            getQty: promo.getQty,
            qualifying,
            gifts,
          });
      }
    }

    for (const [i, l] of lines.entries()) {
      const gross = l.unitPriceLak.mul(l.quantity);
      l.discountLak = l.promotionDiscountLak.add(l.manualDiscountLak);
      if (l.discountLak.gt(gross)) {
        throw new BadRequestException(
          `${meta[i].at}: discount is larger than the line amount`,
        );
      }
      l.lineTotalLak = gross.sub(l.discountLak);
    }

    const subtotalLak = lines.reduce(
      (s, l) => s.add(l.lineTotalLak),
      new Decimal(0),
    );
    const discountLak = new Decimal(input.discountLak ?? 0);
    if (discountLak.gt(subtotalLak)) {
      throw new BadRequestException(
        'Bill discount is larger than the subtotal',
      );
    }
    if (discountLak.gt(0)) needs.add('sale.discount');

    // One VAT rate per sale; lines with a 0% product rate are exempt.
    // The bill discount is shared across lines in proportion to their amounts.
    const vatPercent = saleRate?.percent ?? new Decimal(0);
    const vatableBefore = lines
      .filter((l) => !l.vatExempt)
      .reduce((s, l) => s.add(l.lineTotalLak), new Decimal(0));
    const vatable = subtotalLak.isZero()
      ? new Decimal(0)
      : vatableBefore.sub(lak(discountLak.mul(vatableBefore).div(subtotalLak)));
    const { vatLak, addedLak } = computeVat(
      vatable,
      vatPercent,
      pricesIncludeVat,
    );

    return {
      customer: customer && {
        id: customer.id,
        name: customer.name,
        creditLimitLak: customer.creditLimitLak,
      },
      priceTier,
      lines,
      subtotalLak,
      discountLak,
      taxRateId: saleRate?.id ?? null,
      vatPercent,
      pricesIncludeVat,
      vatLak,
      totalLak: subtotalLak.sub(discountLak).add(addedLak),
      needsApproval: [...needs],
      giftOffers,
      giftRules,
    };
  }

  /** Bundle components with the serials scanned for each serialized one. */
  private async bundleComponents(
    db: Db,
    p: Prisma.ProductGetPayload<{
      include: { bundleItems: { include: { component: true } } };
    }>,
    item: PriceInput['items'][number],
    at: string,
    requireSerials: boolean,
  ): Promise<PricedLine['components']> {
    if (p.type !== 'BUNDLE') {
      if (item.componentSerials)
        throw new BadRequestException(`${at}: ${p.sku} is not a bundle`);
      return [];
    }
    if (!p.bundleItems.length)
      throw new BadRequestException(`${at}: bundle ${p.sku} has no components`);
    if (item.serials?.length) {
      throw new BadRequestException(
        `${at}: send component serials in componentSerials`,
      );
    }
    const given = item.componentSerials ?? {};
    const components = p.bundleItems.map(({ component, quantity }) => {
      const serials = given[component.id] ?? [];
      const needed = quantity * item.quantity;
      if (component.trackSerial && countsStock(component)) {
        if (requireSerials && serials.length !== needed) {
          throw new BadRequestException(
            `${at}: scan ${needed} serial(s) for ${component.sku}`,
          );
        }
      } else if (serials.length) {
        throw new BadRequestException(
          `${at}: ${component.sku} has no serial numbers`,
        );
      }
      return {
        productId: component.id,
        quantity: needed,
        serials,
        warrantyMonths: component.warrantyMonths,
      };
    });
    const unknown = Object.keys(given).filter(
      (id) => !components.some((c) => c.productId === id),
    );
    if (unknown.length)
      throw new BadRequestException(
        `${at}: not a component: ${unknown.join(', ')}`,
      );
    const all = components.flatMap((c) => c.serials);
    if (all.length) {
      const inStock = await db.serialNumber.count({
        where: { serial: { in: all }, status: 'IN_STOCK' },
      });
      if (inStock !== new Set(all).size)
        throw new ConflictException(
          `${at}: some component serials are not in stock`,
        );
    }
    return components;
  }

  /** Checks tendered payments against the total: change only from cash, credit within limit. */
  async planPayments(
    db: Db,
    cart: PricedCart,
    input: PaymentInput[],
  ): Promise<PaymentPlan> {
    if (input.some((p) => p.currency !== 'LAK'))
      await this.entitlements.assertFeature('multiCurrency');
    const [types, rates] = await Promise.all([
      db.paymentType.findMany({
        where: { id: { in: input.map((p) => p.paymentTypeId) } },
      }),
      this.products.pricingContext(db).then((c) => c.rates),
    ]);
    const typeById = new Map(types.map((t) => [t.id, t]));
    for (const [i, p] of input.entries())
      await this.currencies.assertUsable(
        p.currency,
        p.amount,
        `payments[${i}].currency`,
      );

    const payments: PlannedPayment[] = input.map((p, i) => {
      const type = typeById.get(p.paymentTypeId);
      const at = `payments[${i}]`;
      if (!type?.isActive)
        throw new BadRequestException(`${at}: payment type is not available`);
      if (type.requiresReference && !p.reference) {
        throw new BadRequestException(
          `${at}: ${type.name} needs a reference number`,
        );
      }
      if (type.kind === 'CREDIT' && p.currency !== 'LAK') {
        throw new BadRequestException(`${at}: credit is recorded in LAK`);
      }
      if (p.currency === 'LAK' && !Number.isInteger(p.amount)) {
        throw new BadRequestException(`${at}: LAK amounts are whole kip`);
      }
      const lakPerUnit = rateOf(rates, p.currency, `${at}.currency`).lakPerUnit;
      return {
        paymentTypeId: type.id,
        name: type.name,
        kind: type.kind,
        currency: p.currency,
        amount: new Decimal(p.amount),
        lakPerUnit,
        amountLak: toLakAmount(p.amount, lakPerUnit),
        reference: p.reference ?? null,
      };
    });

    const sum = (filter: (p: PlannedPayment) => boolean) =>
      payments
        .filter(filter)
        .reduce((s, p) => s.add(p.amountLak), new Decimal(0));
    const creditLak = sum((p) => p.kind === 'CREDIT');
    if (!creditLak.isZero())
      await this.entitlements.assertFeature('creditSales');
    const cashLak = sum((p) => p.kind === 'CASH');
    const tenderedLak = sum(() => true);

    if (tenderedLak.lt(cart.totalLak)) {
      throw new BadRequestException(
        `Payment is short by ${cart.totalLak.sub(tenderedLak).toString()} LAK`,
      );
    }
    const changeLak = tenderedLak.sub(cart.totalLak);
    if (changeLak.gt(0) && creditLak.gt(0)) {
      throw new BadRequestException(
        'Credit cannot be more than the amount still owed',
      );
    }
    if (changeLak.gt(cashLak)) {
      throw new BadRequestException('Only cash payments can give change');
    }

    if (creditLak.gt(0)) {
      if (!cart.customer)
        throw new BadRequestException('Choose a customer for a credit sale');
      const owed = await this.customers.outstandingLak(cart.customer.id, db);
      if (owed.add(creditLak).gt(cart.customer.creditLimitLak)) {
        throw new ConflictException({
          message: `Credit limit exceeded (limit ${cart.customer.creditLimitLak.toString()}, owed ${owed.toString()})`,
          code: 'CREDIT_LIMIT',
        });
      }
    }

    const paidLak = cart.totalLak.sub(creditLak);
    return {
      payments,
      tenderedLak,
      creditLak,
      paidLak,
      changeLak,
      paymentStatus: creditLak.isZero()
        ? 'PAID'
        : paidLak.isZero()
          ? 'UNPAID'
          : 'PARTIAL',
    };
  }
}
