import { Injectable } from '@nestjs/common';
import { AuditService } from '../common/audit.service.js';
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

  /** All settings, with defaults for keys that were never saved or hold invalid data. */
  async getAll(tx?: Prisma.TransactionClient): Promise<Settings> {
    const rows = await (tx ?? this.prisma).setting.findMany();
    const settings = { ...SETTING_DEFAULTS } as Record<string, unknown>;
    for (const row of rows) {
      const schema = settingsShape[row.key as SettingKey];
      const parsed = schema?.safeParse(row.value);
      if (parsed?.success) settings[row.key] = parsed.data;
    }
    return settings as Settings;
  }

  async get<K extends SettingKey>(
    key: K,
    tx?: Prisma.TransactionClient,
  ): Promise<Settings[K]> {
    const row = await (tx ?? this.prisma).setting.findUnique({
      where: { key },
    });
    const parsed = row && settingsShape[key].safeParse(row.value);
    return parsed?.success
      ? (parsed.data as Settings[K])
      : SETTING_DEFAULTS[key];
  }

  async update(changes: Partial<Settings>, actorId: string): Promise<Settings> {
    const before = await this.getAll();
    await this.prisma.$transaction(
      Object.entries(changes).map(([key, value]) =>
        this.prisma.setting.upsert({
          where: { key },
          update: { value: value as Prisma.InputJsonValue },
          create: { key, value: value as Prisma.InputJsonValue },
        }),
      ),
    );
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
