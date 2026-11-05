import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../common/audit.service.js';
import { RequestContext } from '../common/request-context.js';
import { TtlCache } from '../common/ttl-cache.js';
import { Prisma, type Currency } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { EntitlementsService } from '../tenancy/entitlements.service.js';
import { ExchangeRatesService } from './exchange-rates.service.js';
import type {
  CreateCurrencyInput,
  UpdateCurrencyInput,
} from './settings.schemas.js';

/** The company's currencies. LAK is the base: always present and active. */
@Injectable()
export class CurrenciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
    private readonly rates: ExchangeRatesService,
  ) {}

  private readonly cache = new TtlCache<Currency[]>(10_000);

  /** Every currency, base first then by sort order. Cached briefly. */
  list(): Promise<Currency[]> {
    return this.cache.get('all', () =>
      this.prisma.currency.findMany({
        orderBy: [{ isBase: 'desc' }, { sortOrder: 'asc' }, { code: 'asc' }],
      }),
    );
  }

  async active(): Promise<Currency[]> {
    return (await this.list()).filter((c) => c.isActive || c.isBase);
  }

  /**
   * The currency of a new payment, expense, cash count …: it must exist and be active,
   * and `amount` (when given) must fit its decimals.
   */
  async assertUsable(
    code: string,
    amount?: number | string,
    at = 'currency',
  ): Promise<Currency> {
    const currency = (await this.list()).find((c) => c.code === code);
    if (!currency || !(currency.isActive || currency.isBase)) {
      throw new BadRequestException({
        message: `${at}: ${code} is not an active currency`,
        code: 'CURRENCY_UNAVAILABLE',
        field: at,
        value: code,
      });
    }
    if (
      amount !== undefined &&
      new Prisma.Decimal(amount).decimalPlaces() > currency.decimals
    ) {
      throw new BadRequestException({
        message: `${at}: ${code} amounts have at most ${currency.decimals} decimals`,
        code: 'CURRENCY_DECIMALS',
        field: at,
        value: code,
        decimals: currency.decimals,
      });
    }
    return currency;
  }

  async create(input: CreateCurrencyInput, actorId: string) {
    await this.entitlements.assertFeature('multiCurrency');
    const { lakPerUnit, ...data } = input;
    if (await this.prisma.currency.findFirst({ where: { code: data.code } })) {
      throw new ConflictException({
        message: `${data.code} already exists`,
        code: 'CURRENCY_EXISTS',
        field: 'code',
        value: data.code,
      });
    }
    const last = await this.prisma.currency.aggregate({
      _max: { sortOrder: true },
    });
    const currency = await this.prisma.$transaction(async (tx) => {
      const row = await tx.currency.create({
        data: { ...data, sortOrder: (last._max.sortOrder ?? 0) + 1 },
      });
      if (lakPerUnit !== undefined) {
        await tx.exchangeRate.create({
          data: { currency: row.code, lakPerUnit, createdById: actorId },
        });
      }
      return row;
    });
    this.cache.clear();
    this.rates.clearCache();
    await this.audit.log({
      userId: actorId,
      action: 'CURRENCY_CREATE',
      entity: 'Currency',
      entityId: currency.id,
      after: { ...currency, lakPerUnit },
    });
    return currency;
  }

  private async find(code: string) {
    const currency = await this.prisma.currency.findFirst({ where: { code } });
    if (!currency)
      throw new NotFoundException({
        message: `Currency ${code} not found`,
        code: 'NOT_FOUND',
      });
    return currency;
  }

  async update(code: string, input: UpdateCurrencyInput, actorId: string) {
    const before = await this.find(code);
    if (before.isBase && input.isActive === false)
      throw new BadRequestException({
        message: 'The base currency cannot be disabled',
        code: 'CURRENCY_BASE_LOCKED',
        field: 'isActive',
      });
    // LAK columns are Decimal(18, 0): whole kip only.
    if (before.isBase && input.decimals !== undefined && input.decimals !== 0)
      throw new BadRequestException({
        message: 'LAK amounts are whole kip',
        code: 'CURRENCY_BASE_LOCKED',
        field: 'decimals',
      });
    const currency = await this.prisma.currency.update({
      where: { id: before.id },
      data: input,
    });
    this.cache.clear();
    await this.audit.log({
      userId: actorId,
      action: 'CURRENCY_UPDATE',
      entity: 'Currency',
      entityId: currency.id,
      before,
      after: currency,
    });
    return currency;
  }

  /** Moves a currency one place up or down (the base currency stays first). */
  async move(code: string, direction: 'up' | 'down', actorId: string) {
    const target = await this.find(code);
    const list = await this.prisma.currency.findMany({
      where: { isBase: false },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
    const i = list.findIndex((c) => c.id === target.id);
    const j = direction === 'up' ? i - 1 : i + 1;
    if (i >= 0 && j >= 0 && j < list.length) {
      [list[i], list[j]] = [list[j], list[i]];
      await this.prisma.$transaction(
        list.map((c, index) =>
          this.prisma.currency.update({
            where: { id: c.id },
            data: { sortOrder: index + 1 },
          }),
        ),
      );
      this.cache.clear();
      await this.audit.log({
        userId: actorId,
        action: 'CURRENCY_MOVE',
        entity: 'Currency',
        entityId: target.id,
        after: { code, direction },
      });
    }
    return this.list();
  }

  /** Deletes a currency that was never used; its exchange rates go with it. */
  async remove(code: string, actorId: string) {
    const currency = await this.find(code);
    if (currency.isBase)
      throw new BadRequestException({
        message: 'The base currency cannot be deleted',
        code: 'CURRENCY_BASE_LOCKED',
      });
    if (await this.isUsed(code)) {
      throw new ConflictException({
        message: `${code} is used by bills or documents; disable it instead`,
        code: 'CURRENCY_IN_USE',
        value: code,
      });
    }
    await this.prisma.$transaction([
      this.prisma.exchangeRate.deleteMany({ where: { currency: code } }),
      this.prisma.currency.delete({ where: { id: currency.id } }),
    ]);
    this.cache.clear();
    this.rates.clearCache();
    await this.audit.log({
      userId: actorId,
      action: 'CURRENCY_DELETE',
      entity: 'Currency',
      entityId: currency.id,
      before: currency,
    });
  }

  private async isUsed(code: string): Promise<boolean> {
    const db = this.prisma;
    const counts = await Promise.all([
      db.product.count({
        where: { OR: [{ priceCurrency: code }, { costCurrency: code }] },
      }),
      db.stockDocument.count({ where: { currency: code } }),
      db.sale.count({ where: { payments: { some: { currency: code } } } }),
      db.debtPayment.count({ where: { currency: code } }),
      db.cashMovement.count({ where: { currency: code } }),
      db.expense.count({ where: { currency: code } }),
    ]);
    if (counts.some((n) => n > 0)) return true;
    // Shift cash counts are JSON objects keyed by currency code; zero entries don't count.
    const [{ n }] = await db.$queryRaw<{ n: bigint }[]>(Prisma.sql`
      SELECT count(*)::bigint AS n FROM "Shift"
      WHERE "tenantId" = ${RequestContext.tenantId()}
        AND (coalesce(("openingCash" ->> ${code})::numeric, 0) <> 0
          OR coalesce(("closingCash" ->> ${code})::numeric, 0) <> 0
          OR coalesce(("expectedCash" ->> ${code})::numeric, 0) <> 0)`);
    return n > 0n;
  }
}
