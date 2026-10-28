import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../common/audit.service.js';
import { TtlCache } from '../common/ttl-cache.js';
import { Prisma, type Currency } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateExchangeRateInput,
  ListExchangeRatesQuery,
} from './settings.schemas.js';

export type CurrentRates = Record<
  Currency,
  { lakPerUnit: Prisma.Decimal; effectiveFrom: Date | null }
>;

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

  private async load(): Promise<CurrentRates> {
    const db = this.prisma;
    const [thb, usd] = await Promise.all(
      (['THB', 'USD'] as const).map((currency) =>
        db.exchangeRate.findFirst({
          where: { currency, effectiveFrom: { lte: new Date() } },
          orderBy: { effectiveFrom: 'desc' },
        }),
      ),
    );
    if (!thb || !usd) {
      throw new NotFoundException('Exchange rates for THB and USD must be set');
    }
    return {
      LAK: { lakPerUnit: new Prisma.Decimal(1), effectiveFrom: null },
      THB: { lakPerUnit: thb.lakPerUnit, effectiveFrom: thb.effectiveFrom },
      USD: { lakPerUnit: usd.lakPerUnit, effectiveFrom: usd.effectiveFrom },
    };
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
