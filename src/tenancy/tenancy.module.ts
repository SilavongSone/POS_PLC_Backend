import { Global, Module } from '@nestjs/common';
import { EntitlementsGuard } from './entitlements.guard.js';
import { EntitlementsService } from './entitlements.service.js';
import { ProvisioningService } from './provisioning.service.js';
import { SignupService } from './signup.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { CompanyController } from './company.controller.js';
import { SubscriptionController } from './subscription.controller.js';

@Global()
@Module({
  controllers: [SubscriptionController, CompanyController],
  imports: [AuthModule],
  providers: [
    EntitlementsService,
    EntitlementsGuard,
    ProvisioningService,
    SignupService,
  ],
  exports: [
    EntitlementsService,
    EntitlementsGuard,
    ProvisioningService,
    SignupService,
  ],
})
export class TenancyModule {}
