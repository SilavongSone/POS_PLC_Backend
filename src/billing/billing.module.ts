import { Module } from '@nestjs/common';
import {
  BillingController,
  BillingWebhookController,
} from './billing.controller.js';
import { BillingService } from './billing.service.js';

@Module({
  controllers: [BillingController, BillingWebhookController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
