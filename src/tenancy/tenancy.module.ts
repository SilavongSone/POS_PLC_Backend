import { Global, Module } from '@nestjs/common';
import { EntitlementsGuard } from './entitlements.guard.js';
import { EntitlementsService } from './entitlements.service.js';
import { ProvisioningService } from './provisioning.service.js';
import { CompanyController } from './company.controller.js';
import { SubscriptionController } from './subscription.controller.js';

@Global()
@Module({
  controllers: [SubscriptionController, CompanyController],
  providers: [EntitlementsService, EntitlementsGuard, ProvisioningService],
  exports: [EntitlementsService, EntitlementsGuard, ProvisioningService],
})
export class TenancyModule {}
