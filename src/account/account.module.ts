import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AccountController } from './account.controller.js';
import { AccountService } from './account.service.js';
import { GoogleIdentityService } from './google-identity.service.js';

@Global()
@Module({
  imports: [AuthModule],
  controllers: [AccountController],
  providers: [AccountService, GoogleIdentityService],
  exports: [AccountService, GoogleIdentityService],
})
export class AccountModule {}
