import { Injectable } from '@nestjs/common';
import { AuditService } from '../common/audit.service.js';
import { RequestContext } from '../common/request-context.js';
import { TtlCache } from '../common/ttl-cache.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  SETTING_DEFAULTS,
  settingsShape,
  type SettingKey,
  type Settings,
} from './settings.schemas.js';

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Hot path (every sale and receipt): served from a short cache, cleared on change. */
  private readonly cache = new TtlCache<Settings>(10_000);

  /** All settings, with defaults for keys that were never saved or hold invalid data. */
  async getAll(_tx?: Prisma.TransactionClient): Promise<Settings> {
    const settings = await this.cache.get('all', async () => {
      const rows = await this.prisma.setting.findMany();
      const all = { ...SETTING_DEFAULTS } as Record<string, unknown>;
      for (const row of rows) {
        const parsed = settingsShape[row.key as SettingKey]?.safeParse(
          row.value,
        );
        if (parsed?.success) all[row.key] = parsed.data;
      }
      return all as Settings;
    });
    return { ...settings };
  }

  async get<K extends SettingKey>(
    key: K,
    tx?: Prisma.TransactionClient,
  ): Promise<Settings[K]> {
    return (await this.getAll(tx))[key];
  }

  async update(changes: Partial<Settings>, actorId: string): Promise<Settings> {
    const before = await this.getAll();
    await this.prisma.$transaction(
      Object.entries(changes).map(([key, value]) =>
        this.prisma.setting.upsert({
          where: { tenantId_key: { tenantId: RequestContext.tenantId(), key } },
          update: { value: value as Prisma.InputJsonValue },
          create: { key, value: value as Prisma.InputJsonValue },
        }),
      ),
    );
    this.cache.clear();
    const changedBefore = Object.fromEntries(
      Object.keys(changes).map((k) => [k, before[k as SettingKey]]),
    );
    await this.audit.log({
      userId: actorId,
      action: 'SETTINGS_UPDATE',
      entity: 'Setting',
      before: changedBefore,
      after: changes,
    });
    return this.getAll();
  }
}
