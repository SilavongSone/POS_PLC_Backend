import { Module } from '@nestjs/common';
import {
  BillingController,
  BillingWebhookController,
} from './billing.controller.js';
import { BankAccountsService } from './bank-accounts.service.js';
import { BillingService } from './billing.service.js';

@Module({
  controllers: [BillingController, BillingWebhookController],
  providers: [BillingService, BankAccountsService],
  exports: [BillingService, BankAccountsService],
})
export class BillingModule {}
