import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { ProductsService } from '../catalog/products.service.js';
import { CustomersService } from '../customers/customers.service.js';
import {
  Prisma,
  type Currency,
  type PriceTier,
} from '../generated/prisma/client.js';
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
  serials: string[];
  listPriceLak: Decimal;
  unitPriceLak: Decimal;
  overridden: boolean;
  promotionId: string | null;
  promotionDiscountLak: Decimal;
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
>;

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
};

export type PlannedPayment = {
  paymentTypeId: string;
  name: string;
  kind: string;
  currency: Currency;
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
    const [
      products,
      ctx,
      promotions,
      categories,
      defaultRate,
      pricesIncludeVat,
    ] = await Promise.all([
      db.product.findMany({
        where: { id: { in: ids } },
        include: {
          taxRate: true,
          bundleItems: { include: { component: true } },
        },
      }),
      this.products.pricingContext(db),
      db.promotion.findMany({
        where: {
          isActive: true,
          startsAt: { lte: new Date() },
          OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
        },
        include: { items: true },
      }),
      db.category.findMany({ select: { id: true, parentId: true } }),
      this.taxRates.getDefault(db),
      this.settings.get('tax.pricesIncludeVat', db),
    ]);
    const byId = new Map(products.map((p) => [p.id, p]));
    const parentOf = new Map(categories.map((c) => [c.id, c.parentId]));
    const ancestors = (categoryId: string | null) => {
      const out: string[] = [];
      for (let c = categoryId; c; c = parentOf.get(c) ?? null) out.push(c);
      return out;
    };

    const lines: PricedLine[] = [];
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

      const { retailPriceLak, wholesalePriceLak } = this.products.lakPrices(
        p,
        ctx,
      );
      const wholesale =
        wholesalePriceLak !== null &&
        (priceTier === 'WHOLESALE' ||
          (p.wholesaleMinQty !== null && item.quantity >= p.wholesaleMinQty));
      const listPriceLak =
        unitOwnPrice ?? (wholesale ? wholesalePriceLak : retailPriceLak);
      const overridden =
        item.unitPriceLak !== undefined &&
        !listPriceLak.equals(item.unitPriceLak);
      const unitPriceLak = overridden
        ? new Decimal(item.unitPriceLak!)
        : listPriceLak;
      if (overridden) needs.add('price.override');

      // Best promotion, only on regular list prices.
      let promotionId: string | null = null;
      let promoPerUnit = new Decimal(0);
      if (options.applyPromotions !== false && !overridden && !unitOwnPrice) {
        const cats = ancestors(p.categoryId);
        for (const promo of promotions) {
          if (item.quantity < promo.minQty) continue;
          const applies =
            promo.items.length === 0 ||
            promo.items.some(
              (t) =>
                t.productId === p.id ||
                (t.categoryId !== null && cats.includes(t.categoryId)),
            );
          if (!applies) continue;
          const d = promotionDiscount(unitPriceLak, promo);
          if (d.gt(promoPerUnit)) {
            promoPerUnit = d;
            promotionId = promo.id;
          }
        }
      }

      const gross = unitPriceLak.mul(item.quantity);
      const promotionDiscountLak = promoPerUnit.mul(item.quantity);
      const manualDiscountLak = new Decimal(item.discountLak ?? 0);
      if (manualDiscountLak.gt(0)) needs.add('sale.discount');
      const discountLak = promotionDiscountLak.add(manualDiscountLak);
      if (discountLak.gt(gross)) {
        throw new BadRequestException(
          `${at}: discount is larger than the line amount`,
        );
      }

      lines.push({
        productId: p.id,
        productName: item.description ?? p.name,
        sku: p.sku,
        components,
        quantity: item.quantity,
        serials,
        listPriceLak,
        unitPriceLak,
        overridden,
        promotionId,
        promotionDiscountLak,
        manualDiscountLak,
        discountLak,
        lineTotalLak: gross.sub(discountLak),
        warrantyMonths: p.warrantyMonths,
        vatExempt: p.taxRate !== null && p.taxRate.percent.isZero(),
        countsStock: countsStock(p),
      });
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
    const vatPercent = defaultRate?.percent ?? new Decimal(0);
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
      taxRateId: defaultRate?.id ?? null,
      vatPercent,
      pricesIncludeVat,
      vatLak,
      totalLak: subtotalLak.sub(discountLak).add(addedLak),
      needsApproval: [...needs],
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
      const lakPerUnit = rates[p.currency].lakPerUnit;
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
