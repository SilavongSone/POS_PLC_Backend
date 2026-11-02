import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RequestContext } from '../common/request-context.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';

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
    const row = await RequestContext.asPlatform(() =>
      this.prisma.platformSetting.findUnique({ where: { key: SIGNUP_KEY } }),
    );
    const fromSetting = typeof row?.value === 'boolean';
    return {
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
