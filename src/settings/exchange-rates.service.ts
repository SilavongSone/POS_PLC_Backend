import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditService } from '../common/audit.service.js';
import { BASE_CURRENCY } from '../common/currency.js';
import { TtlCache } from '../common/ttl-cache.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateExchangeRateInput,
  ListExchangeRatesQuery,
} from './settings.schemas.js';

export type CurrentRate = {
  lakPerUnit: Prisma.Decimal;
  effectiveFrom: Date | null;
};
/** Latest rate per currency code that has one; LAK is always present (1). */
export type CurrentRates = Record<string, CurrentRate>;

/** The current rate of `currency`, or a 400 when none is set yet. */
export function rateOf(
  rates: CurrentRates,
  currency: string,
  at = 'currency',
): CurrentRate {
  const rate = rates[currency];
  if (!rate) {
    throw new BadRequestException({
      message: `${at}: no exchange rate is set for ${currency}`,
      code: 'CURRENCY_NO_RATE',
      field: at,
      value: currency,
    });
  }
  return rate;
}

@Injectable()
export class ExchangeRatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private readonly cache = new TtlCache<CurrentRates>(10_000);

  /** Latest rate per currency (LAK is always 1). Cached briefly; cleared when a rate is set. */
  current(_tx?: Prisma.TransactionClient): Promise<CurrentRates> {
    return this.cache.get('current', () => this.load());
  }

  /** Called when rates change outside `create` (a new currency with its first rate). */
  clearCache(): void {
    this.cache.clear();
  }

  private async load(): Promise<CurrentRates> {
    // Disabled currencies keep their rate: products priced in them still need it.
    const latest = await this.prisma.exchangeRate.findMany({
      where: { effectiveFrom: { lte: new Date() } },
      orderBy: [{ currency: 'asc' }, { effectiveFrom: 'desc' }],
      distinct: ['currency'],
    });
    const rates: CurrentRates = {
      [BASE_CURRENCY]: {
        lakPerUnit: new Prisma.Decimal(1),
        effectiveFrom: null,
      },
    };
    for (const r of latest) {
      if (r.currency !== BASE_CURRENCY)
        rates[r.currency] = {
          lakPerUnit: r.lakPerUnit,
          effectiveFrom: r.effectiveFrom,
        };
    }
    return rates;
  }

  history(query: ListExchangeRatesQuery) {
    return this.prisma.exchangeRate.findMany({
      where: { currency: query.currency },
      orderBy: { effectiveFrom: 'desc' },
      take: query.limit,
      include: { createdBy: { select: { id: true, fullName: true } } },
    });
  }

  async create(input: CreateExchangeRateInput, actorId: string) {
    const currency =
      input.currency === BASE_CURRENCY
        ? null
        : await this.prisma.currency.findFirst({
            where: { code: input.currency },
          });
    if (!currency) {
      throw new BadRequestException({
        message: `${input.currency} is not one of the company's foreign currencies`,
        code: 'CURRENCY_UNAVAILABLE',
        field: 'currency',
        value: input.currency,
      });
    }
    const rate = await this.prisma.exchangeRate.create({
      data: {
        currency: input.currency,
        lakPerUnit: input.lakPerUnit,
        createdById: actorId,
      },
    });
    this.cache.clear();
    await this.audit.log({
      userId: actorId,
      action: 'EXCHANGE_RATE_SET',
      entity: 'ExchangeRate',
      entityId: rate.id,
      after: rate,
    });
    return rate;
  }
}
