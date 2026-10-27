import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PlatformAuthService, PlatformGuard } from './platform-auth.js';
import {
  PlatformAuthController,
  PlatformController,
  PublicController,
} from './platform.controller.js';
import { PlatformService } from './platform.service.js';

@Module({
  imports: [AuthModule],
  controllers: [PlatformAuthController, PlatformController, PublicController],
  providers: [PlatformAuthService, PlatformGuard, PlatformService],
})
export class PlatformModule {}
