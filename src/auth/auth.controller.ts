import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  openApiSchema,
  ZodValidationPipe,
} from '../common/zod-validation.pipe.js';
import { AuthService } from './auth.service.js';
import {
  changePasswordSchema,
  loginSchema,
  pinLoginSchema,
  refreshSchema,
  setPinSchema,
  type ChangePasswordInput,
  type LoginInput,
  type PinLoginInput,
  type RefreshInput,
  type SetPinInput,
} from './auth.schemas.js';
import type { AuthTokens, AuthUser } from './auth.types.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { Public } from './decorators/public.decorator.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign in with username and password' })
  @ApiBody({ schema: openApiSchema(loginSchema) })
  login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
  ): Promise<AuthTokens> {
    return this.auth.login(body.username, body.password);
  }

  @Public()
  @Post('pin-login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Quick sign-in at a till with username and PIN' })
  @ApiBody({ schema: openApiSchema(pinLoginSchema) })
  pinLogin(
    @Body(new ZodValidationPipe(pinLoginSchema)) body: PinLoginInput,
  ): Promise<AuthTokens> {
    return this.auth.pinLogin(body.username, body.pin);
  }

  @Public()
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
}
