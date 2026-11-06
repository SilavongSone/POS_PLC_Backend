import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RequestContext } from '../common/request-context.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  EntitlementsService,
  GRACE_DAYS,
  GRACE_DAYS_KEY,
} from '../tenancy/entitlements.service.js';

const SIGNUP_KEY = 'signup.enabled';

/**
 * Platform-wide switches the Super Admin changes at run time. A switch that was never set
 * falls back to its environment default, so a fresh install behaves as configured.
 */
@Injectable()
export class PlatformSettingsService {
  private readonly logger = new Logger(PlatformSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly entitlements: EntitlementsService,
  ) {}

  /** Whether shops may sign up themselves at /public/signup. */
  async signupEnabled(): Promise<boolean> {
    const row = await RequestContext.asPlatform(() =>
      this.prisma.platformSetting.findUnique({ where: { key: SIGNUP_KEY } }),
    );
    return typeof row?.value === 'boolean'
      ? row.value
      : this.config.get('SIGNUP_ENABLED', { infer: true });
  }

  async get() {
    const [row, grace] = await RequestContext.asPlatform(() =>
      Promise.all([
        this.prisma.platformSetting.findUnique({ where: { key: SIGNUP_KEY } }),
        this.prisma.platformSetting.findUnique({
          where: { key: GRACE_DAYS_KEY },
        }),
      ]),
    );
    const fromSetting = typeof row?.value === 'boolean';
    return {
      /** Days a company keeps full use after its trial/paid period ends; then read-only. */
      graceDays: typeof grace?.value === 'number' ? grace.value : GRACE_DAYS,
      signupEnabled: fromSetting
        ? (row.value as boolean)
        : this.config.get('SIGNUP_ENABLED', { infer: true }),
      /** "setting" = chosen in the console; "env" = still the SIGNUP_ENABLED default. */
      signupEnabledSource: fromSetting
        ? ('setting' as const)
        : ('env' as const),
      signupUpdatedAt: row?.updatedAt ?? null,
    };
  }

  /** Applies at once: cached entitlements of every company are dropped. */
  async setGraceDays(days: number, adminId: string) {
    await RequestContext.asPlatform(() =>
      this.prisma.platformSetting.upsert({
        where: { key: GRACE_DAYS_KEY },
        create: { key: GRACE_DAYS_KEY, value: days, updatedById: adminId },
        update: { value: days, updatedById: adminId },
      }),
    );
    this.entitlements.invalidateAll();
    this.logger.log(
      `Grace period set to ${days} days by platform admin ${adminId}`,
    );
  }

  async setSignupEnabled(enabled: boolean, adminId: string) {
    await RequestContext.asPlatform(() =>
      this.prisma.platformSetting.upsert({
        where: { key: SIGNUP_KEY },
        create: { key: SIGNUP_KEY, value: enabled, updatedById: adminId },
        update: { value: enabled, updatedById: adminId },
      }),
    );
    this.logger.log(
      `Self-service sign-up ${enabled ? 'opened' : 'closed'} by platform admin ${adminId}`,
    );
    return this.get();
  }
}
