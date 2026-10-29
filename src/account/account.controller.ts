import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service.js';
import type { AuthTokens, AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Public } from '../auth/decorators/public.decorator.js';
import {
  ApiEmptyResponse,
  ApiErrors,
  ApiZodResponse,
  errors,
  SIGNED_IN,
  THROTTLED,
  VALIDATION,
} from '../common/openapi.js';
import { ApiZodBody, zod } from '../common/zod-validation.pipe.js';
import {
  authTokensSchema,
  emailVerifiedSchema,
} from '../auth/auth.responses.js';
import { tenantCodeSchema } from '../tenancy/tenancy.schemas.js';
import { AccountService } from './account.service.js';
import { GoogleIdentityService } from './google-identity.service.js';

const token = z.object({ token: z.string().min(20).max(200) });
const forgot = z.object({
  tenantCode: tenantCodeSchema.optional(),
  email: z.email().trim().toLowerCase(),
});
const reset = token.extend({
  newPassword: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(200),
});
const google = z.object({
  idToken: z.string().min(20).max(5000),
  tenantCode: tenantCodeSchema.optional(),
});

/** Sign in with Google: bad token, no/ambiguous account, disabled, suspended company. */
const GOOGLE_LOGIN_ERRORS = errors(VALIDATION, THROTTLED, {
  401: [
    'GOOGLE_TOKEN_INVALID',
    'GOOGLE_ACCOUNT_UNKNOWN',
    'INVALID_CREDENTIALS',
  ],
  403: ['GOOGLE_DISABLED', 'TENANT_SUSPENDED'],
  409: ['TENANT_REQUIRED', 'GOOGLE_ACCOUNT_AMBIGUOUS'],
});

/** Sending mail costs money and can be abused: a few per minute per IP. */
const MailThrottle = () =>
  Throttle({
    default: {
      ttl: 60_000,
      limit: () => Number(process.env.THROTTLE_AUTH_LIMIT ?? 10),
    },
  });

@ApiTags('auth')
@Controller('auth')
export class AccountController {
  constructor(
    private readonly account: AccountService,
    private readonly auth: AuthService,
    private readonly google: GoogleIdentityService,
  ) {}

  @Public()
  @Post('verify-email')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm an e-mail address with the link token' })
  @ApiZodBody(token)
  @ApiZodResponse(emailVerifiedSchema)
  @ApiErrors(errors(VALIDATION, THROTTLED, { 400: ['TOKEN_INVALID'] }))
  verifyEmail(@Body(zod(token)) body: z.infer<typeof token>) {
    return this.account.verifyEmail(body.token);
  }

  @Post('resend-verification')
  @HttpCode(204)
  @MailThrottle()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Send the confirmation link for your e-mail again' })
  @ApiEmptyResponse({ description: 'Link sent' })
  @ApiErrors(errors(SIGNED_IN, { 400: ['EMAIL_NOT_PENDING'] }))
  async resend(@CurrentUser() user: AuthUser): Promise<void> {
    if (!user.email || user.emailVerified) {
      throw new BadRequestException({
        message: 'There is no unconfirmed e-mail on your account',
        code: 'EMAIL_NOT_PENDING',
      });
    }
    await this.account.sendVerification({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
    });
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(202)
  @MailThrottle()
  @ApiOperation({
    summary:
      'E-mail a reset link (only to confirmed addresses; same answer either way)',
  })
  @ApiZodBody(forgot)
  @ApiEmptyResponse({
    description: 'Accepted (same answer whether or not the address exists)',
  })
  @ApiErrors(errors(VALIDATION, THROTTLED))
  async forgot(@Body(zod(forgot)) body: z.infer<typeof forgot>): Promise<void> {
    await this.account.forgotPassword(body.tenantCode, body.email);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(204)
  @ApiOperation({ summary: 'Set a new password with the e-mailed token' })
  @ApiZodBody(reset)
  @ApiEmptyResponse({
    description: 'Password changed; every session is signed out',
  })
  @ApiErrors(errors(VALIDATION, THROTTLED, { 400: ['TOKEN_INVALID'] }))
  async reset(@Body(zod(reset)) body: z.infer<typeof reset>): Promise<void> {
    await this.account.resetPassword(body.token, body.newPassword);
  }

  @Public()
  @Post('google')
  @HttpCode(200)
  @MailThrottle()
  @ApiOperation({ summary: 'Sign in with a Google ID token' })
  @ApiZodBody(google)
  @ApiZodResponse(authTokensSchema)
  @ApiErrors(GOOGLE_LOGIN_ERRORS)
  async googleLogin(
    @Body(zod(google)) body: z.infer<typeof google>,
  ): Promise<AuthTokens> {
    const identity = await this.google.verify(body.idToken);
    return this.auth.googleLogin(identity, body.tenantCode);
  }

  @Post('google/link')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Link your account to a Google account' })
  @ApiZodBody(google.pick({ idToken: true }))
  async link(
    @Body(zod(google.pick({ idToken: true }))) body: { idToken: string },
    @CurrentUser() user: AuthUser,
  ): Promise<AuthUser> {
    const identity = await this.google.verify(body.idToken);
    return this.auth.linkGoogle(user.id, identity);
  }
}
