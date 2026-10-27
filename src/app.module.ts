import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import type { Env } from './config/env.js';
import { HealthController } from './health.controller.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { BranchesModule } from './branches/branches.module.js';
import { TenancyModule } from './tenancy/tenancy.module.js';
import { MailModule } from './mail/mail.module.js';
import { AccountModule } from './account/account.module.js';
import { PlatformModule } from './platform/platform.module.js';
import { BillingModule } from './billing/billing.module.js';
import { CommonModule } from './common/common.module.js';
import { CustomersModule } from './customers/customers.module.js';
import { DebtsModule } from './debts/debts.module.js';
import { ExpensesModule } from './expenses/expenses.module.js';
import { validateEnv } from './config/env.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { PromotionsModule } from './promotions/promotions.module.js';
import { QuotationsModule } from './quotations/quotations.module.js';
import { RepairsModule } from './repairs/repairs.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { ReturnsModule } from './returns/returns.module.js';
import { SalesModule } from './sales/sales.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { ShiftsModule } from './shifts/shifts.module.js';
import { StockModule } from './stock/stock.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        // Never write bearer tokens to the logs.
        redact: ['req.headers.authorization'],
        transport:
          process.env.NODE_ENV === 'production'
            ? undefined
            : { target: 'pino-pretty', options: { singleLine: true } },
      },
    }),
    // Per client IP; auth routes use the stricter "auth" limit (see @Throttle there).
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        throttlers: [
          {
            name: 'default',
            ttl: 60_000,
            limit: config.get('THROTTLE_LIMIT', { infer: true }),
          },
        ],
      }),
    }),
    PrismaModule,
    CommonModule,
    MailModule,
    AccountModule,
    TenancyModule,
    BillingModule,
    PlatformModule,
    BranchesModule,
    AuthModule,
    UsersModule,
    SettingsModule,
    CatalogModule,
    StockModule,
    CustomersModule,
    ShiftsModule,
    SalesModule,
    DebtsModule,
    ReportsModule,
    ReturnsModule,
    PromotionsModule,
    ExpensesModule,
    QuotationsModule,
    RepairsModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
