import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  openApiSchema,
  ZodValidationPipe,
} from '../common/zod-validation.pipe.js';
import { Throttle } from '@nestjs/throttler';
import { ApprovalService } from './approval.service.js';
import { AuthService } from './auth.service.js';
import {
  approveSchema,
  changePasswordSchema,
  loginSchema,
  pinLoginSchema,
  refreshSchema,
  setPinSchema,
  type ApproveInput,
  type ChangePasswordInput,
  type LoginInput,
  type PinLoginInput,
  type RefreshInput,
  type SetPinInput,
} from './auth.schemas.js';
import type { AuthTokens, AuthUser } from './auth.types.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { Public } from './decorators/public.decorator.js';

/**
 * Credential endpoints get a tight per-IP limit (THROTTLE_AUTH_LIMIT per minute) on top of
 * the per-account lockout, so guessing passwords or PINs across accounts is slow too.
 */
const AuthThrottle = () =>
  Throttle({
    default: {
      ttl: 60_000,
      limit: () => Number(process.env.THROTTLE_AUTH_LIMIT ?? 10),
    },
  });

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly approvals: ApprovalService,
  ) {}

  @Public()
  @AuthThrottle()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign in with username and password' })
  @ApiBody({ schema: openApiSchema(loginSchema) })
  login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
  ): Promise<AuthTokens> {
    return this.auth.login(body.tenantCode, body.username, body.password);
  }

  @Public()
  @AuthThrottle()
  @Post('pin-login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Quick sign-in at a till with username and PIN' })
  @ApiBody({ schema: openApiSchema(pinLoginSchema) })
  pinLogin(
    @Body(new ZodValidationPipe(pinLoginSchema)) body: PinLoginInput,
  ): Promise<AuthTokens> {
    return this.auth.pinLogin(body.tenantCode, body.username, body.pin);
  }

  @Public()
  @AuthThrottle()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Exchange a refresh token for new tokens (rotation)',
  })
  @ApiBody({ schema: openApiSchema(refreshSchema) })
  refresh(
    @Body(new ZodValidationPipe(refreshSchema)) body: RefreshInput,
  ): Promise<AuthTokens> {
    return this.auth.refresh(body.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke a refresh token' })
  @ApiBody({ schema: openApiSchema(refreshSchema) })
  async logout(
    @Body(new ZodValidationPipe(refreshSchema)) body: RefreshInput,
  ): Promise<void> {
    await this.auth.logout(body.refreshToken);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The signed-in user with group and permissions' })
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }

  @Post('change-password')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change own password (signs out all sessions)' })
  @ApiBody({ schema: openApiSchema(changePasswordSchema) })
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(changePasswordSchema))
    body: ChangePasswordInput,
  ): Promise<void> {
    await this.auth.changePassword(
      user.id,
      body.currentPassword,
      body.newPassword,
    );
  }

  @Put('pin')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Set own 4–6 digit PIN (requires current password)',
  })
  @ApiBody({ schema: openApiSchema(setPinSchema) })
  async setPin(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(setPinSchema)) body: SetPinInput,
  ): Promise<void> {
    await this.auth.setPin(user.id, body.currentPassword, body.pin);
  }

  @AuthThrottle()
  @Post('approve')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Manager approval at the till: returns a 2-minute token for one permission, bound to the signed-in user',
  })
  @ApiBody({ schema: openApiSchema(approveSchema) })
  approve(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(approveSchema)) body: ApproveInput,
  ) {
    return this.approvals.approve(user, body);
  }
}
