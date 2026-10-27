import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Env } from '../config/env.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { withTenantIsolation } from './tenant-extension.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: ConfigService<Env, true>) {
    super({
      adapter: new PrismaPg({
        connectionString: config.get('DATABASE_URL', { infer: true }),
        max: config.get('DATABASE_POOL_MAX', { infer: true }),
        // A runaway query is cancelled instead of holding a connection and CPU.
        statement_timeout: config.get('DATABASE_STATEMENT_TIMEOUT_MS', {
          infer: true,
        }),
        connectionTimeoutMillis: 10_000,
        idleTimeoutMillis: 30_000,
      }),
    });
    // Every query through this service is tenant-scoped (see tenant-extension.ts). The
    // extended client keeps PrismaClient's API, so callers are unchanged.
    return withTenantIsolation(this);
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
