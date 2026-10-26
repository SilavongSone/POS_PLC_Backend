import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { CommonModule } from './common/common.module.js';
import { CustomersModule } from './customers/customers.module.js';
import { DebtsModule } from './debts/debts.module.js';
import { validateEnv } from './config/env.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ReportsModule } from './reports/reports.module.js';
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
    PrismaModule,
    CommonModule,
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
