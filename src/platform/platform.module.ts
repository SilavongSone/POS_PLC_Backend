import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { BillingModule } from '../billing/billing.module.js';
import { StoresModule } from '../stores/stores.module.js';
import { PlatformAuthService, PlatformGuard } from './platform-auth.js';
import {
  PlatformAuthController,
  PlatformController,
  PublicController,
} from './platform.controller.js';
import { PlatformBanksController } from './platform-banks.controller.js';
import { PlatformSettingsService } from './platform-settings.service.js';
import { PlatformService } from './platform.service.js';

@Module({
  imports: [AuthModule, BillingModule, StoresModule],
  controllers: [
    PlatformAuthController,
    PlatformController,
    PlatformBanksController,
    PublicController,
  ],
  providers: [
    PlatformAuthService,
    PlatformGuard,
    PlatformService,
    PlatformSettingsService,
  ],
})
export class PlatformModule {}
