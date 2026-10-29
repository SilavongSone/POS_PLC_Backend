import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator.js';
import {
  ApiErrors,
  ApiZodResponse,
  errors,
  THROTTLED,
  VALIDATION,
} from '../common/openapi.js';
import { ApiZodBody, zod } from '../common/zod-validation.pipe.js';
import {
  publicPlansSchema,
  signupCompletedSchema,
  signupPendingSchema,
} from './platform.responses.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProvisioningService } from '../tenancy/provisioning.service.js';
import { SignupService } from '../tenancy/signup.service.js';
import { BillingService } from '../billing/billing.service.js';
import { pageQuerySchema } from '../common/pagination.js';
import { AccountService } from '../account/account.service.js';
import { GoogleIdentityService } from '../account/google-identity.service.js';
import { RequestContext } from '../common/request-context.js';
import { z } from 'zod';
import {
  googleSignupSchema,
  provisionTenantSchema,
  resendSignupSchema,
  signupSchema,
  verifySignupSchema,
  type GoogleSignupInput,
  type ProvisionTenantInput,
  type SignupInput,
} from '../tenancy/tenancy.schemas.js';
import {
  PlatformAuthService,
  PlatformGuard,
  type PlatformAdminUser,
} from './platform-auth.js';
import {
  createPlanSchema,
  listTenantsSchema,
  platformLoginSchema,
  updatePlanSchema,
  updateSubscriptionSchema,
  updateTenantSchema,
  type CreatePlanInput,
  type ListTenantsQuery,
  type PlatformLoginInput,
  type UpdatePlanInput,
  type UpdateSubscriptionInput,
  type UpdateTenantInput,
} from './platform.schemas.js';
import { PlatformService } from './platform.service.js';

const id = new ParseUUIDPipe();
const platformInvoicesSchema = pageQuerySchema.extend({
  status: z.enum(['PENDING', 'PAID', 'CANCELLED']).optional(),
  tenantId: z.uuid().optional(),
});
const markPaidSchema = z.object({
  method: z
    .enum(['BANK_TRANSFER', 'CASH', 'ONLINE', 'OTHER'])
    .default('BANK_TRANSFER'),
  reference: z.string().trim().max(100).optional(),
});
type PlatformRequest = Request & { platformAdmin: PlatformAdminUser };

const SignupThrottle = () =>
  Throttle({
    default: {
      ttl: 3_600_000,
      limit: () => Number(process.env.THROTTLE_SIGNUP_LIMIT ?? 3),
    },
  });

const LoginThrottle = () =>
  Throttle({
    default: {
      ttl: 60_000,
      limit: () => Number(process.env.THROTTLE_AUTH_LIMIT ?? 10),
    },
  });

@ApiTags('platform')
@Public()
@Controller('platform/auth')
export class PlatformAuthController {
  constructor(private readonly auth: PlatformAuthService) {}

  @Post('login')
  @HttpCode(200)
  @LoginThrottle()
  @ApiOperation({
    summary: 'Platform admin sign-in (separate from company users)',
  })
  @ApiZodBody(platformLoginSchema)
  login(@Body(zod(platformLoginSchema)) body: PlatformLoginInput) {
    return this.auth.login(body.email, body.password);
  }
}

/** Run by the SaaS operator: plans, companies, subscriptions. */
@ApiTags('platform')
@ApiBearerAuth()
@Public()
@UseGuards(PlatformGuard)
@Controller('platform')
export class PlatformController {
  constructor(
    private readonly platform: PlatformService,
    private readonly provisioning: ProvisioningService,
    private readonly account: AccountService,
    private readonly billing: BillingService,
  ) {}

  @Get('plans')
  listPlans() {
    return this.platform.listPlans();
  }

  @Post('plans')
  @ApiZodBody(createPlanSchema)
  createPlan(@Body(zod(createPlanSchema)) body: CreatePlanInput) {
    return this.platform.createPlan(body);
  }

  @Patch('plans/:id')
  @ApiOperation({ summary: 'Change price, limits, features or visibility' })
  @ApiZodBody(updatePlanSchema)
  updatePlan(
    @Param('id', id) planId: string,
    @Body(zod(updatePlanSchema)) body: UpdatePlanInput,
  ) {
    return this.platform.updatePlan(planId, body);
  }

  @Get('tenants')
  @ApiOperation({ summary: 'Companies (?q, status, planId, page)' })
  listTenants(@Query(zod(listTenantsSchema)) q: ListTenantsQuery) {
    return this.platform.listTenants(q);
  }

  @Post('tenants')
  @ApiOperation({
    summary:
      'Create a company with its owner, first branch, till and starter data',
  })
  @ApiZodBody(provisionTenantSchema)
  async createTenant(
    @Body(zod(provisionTenantSchema)) body: ProvisionTenantInput,
  ) {
    const result = await this.provisioning.provision(body);
    const email = body.owner.email;
    if (email) {
      await RequestContext.withTenant(result.tenant.id, () =>
        this.account.sendVerification({
          id: result.owner.id,
          email,
          fullName: body.owner.fullName,
        }),
      );
    }
    return result;
  }

  @Get('tenants/:id')
  getTenant(@Param('id', id) tenantId: string) {
    return this.platform.getTenant(tenantId);
  }

  @Patch('tenants/:id')
  @ApiOperation({
    summary: 'Company details; isActive=false suspends all its users',
  })
  @ApiZodBody(updateTenantSchema)
  updateTenant(
    @Param('id', id) tenantId: string,
    @Body(zod(updateTenantSchema)) body: UpdateTenantInput,
    @Req() req: PlatformRequest,
  ) {
    return this.platform.updateTenant(tenantId, body, req.platformAdmin.id);
  }

  @Patch('tenants/:id/subscription')
  @ApiOperation({
    summary: 'Change plan, status, trial/period end or per-company overrides',
  })
  @ApiZodBody(updateSubscriptionSchema)
  updateSubscription(
    @Param('id', id) tenantId: string,
    @Body(zod(updateSubscriptionSchema)) body: UpdateSubscriptionInput,
    @Req() req: PlatformRequest,
  ) {
    return this.platform.updateSubscription(
      tenantId,
      body,
      req.platformAdmin.id,
    );
  }

  @Get('invoices')
  @ApiOperation({
    summary: 'Plan invoices of all companies (?status, tenantId, page)',
  })
  listInvoices(
    @Query(zod(platformInvoicesSchema))
    q: z.infer<typeof platformInvoicesSchema>,
  ) {
    return this.billing.listAll(q);
  }

  @Post('invoices/:id/mark-paid')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Record a payment seen in the bank; extends the subscription',
  })
  @ApiZodBody(markPaidSchema)
  markPaid(
    @Param('id', id) invoiceId: string,
    @Body(zod(markPaidSchema)) body: z.infer<typeof markPaidSchema>,
    @Req() req: PlatformRequest,
  ) {
    return this.billing.markPaid(invoiceId, body, {
      platformAdminId: req.platformAdmin.id,
    });
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Companies by plan and status; monthly recurring revenue',
  })
  stats() {
    return this.platform.stats();
  }
}

/** Every sign-up step: validation, sign-up switched off, rate limit. */
const SIGNUP_ERRORS = errors(VALIDATION, THROTTLED, {
  403: ['SIGNUP_DISABLED'],
});

/** Website-facing: price list and self-service sign-up. */
@ApiTags('public')
@Public()
@Controller('public')
export class PublicController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly signups: SignupService,
    private readonly google: GoogleIdentityService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Get('plans')
  @ApiOperation({ summary: 'Plans offered on the website' })
  @ApiZodResponse(publicPlansSchema)
  @ApiErrors(THROTTLED)
  plans() {
    return this.prisma.plan.findMany({
      where: { isPublic: true, isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        nameI18n: true,
        descriptionI18n: true,
        priceMonthlyLak: true,
        priceYearlyLak: true,
        limits: true,
        features: true,
        trialDays: true,
      },
    });
  }

  private assertOpen() {
    if (!this.config.get('SIGNUP_ENABLED', { infer: true })) {
      throw new ForbiddenException({
        message: 'Sign-up is closed',
        code: 'SIGNUP_DISABLED',
      });
    }
  }

  @Post('signup')
  @SignupThrottle()
  @ApiOperation({
    summary:
      'Start a trial: e-mails a 6-digit code; the company is created by /public/signup/verify',
  })
  @ApiZodBody(signupSchema)
  @ApiZodResponse(signupPendingSchema)
  @ApiErrors(
    errors(SIGNUP_ERRORS, {
      400: ['BAD_REQUEST'],
      409: ['TENANT_CODE_TAKEN'],
      429: ['TOO_MANY_REQUESTS'],
    }),
  )
  signup(@Body(zod(signupSchema)) body: SignupInput) {
    this.assertOpen();
    return this.signups.request(body);
  }

  @Post('signup/verify')
  @HttpCode(200)
  @SignupThrottle()
  @ApiOperation({
    summary:
      'Check the e-mailed code: creates the company and signs the owner in',
  })
  @ApiZodBody(verifySignupSchema)
  @ApiZodResponse(signupCompletedSchema)
  @ApiErrors(
    errors(SIGNUP_ERRORS, {
      400: ['SIGNUP_CODE_INVALID', 'BAD_REQUEST'],
      409: ['TENANT_CODE_TAKEN'],
    }),
  )
  verifySignup(
    @Body(zod(verifySignupSchema)) body: z.infer<typeof verifySignupSchema>,
  ) {
    this.assertOpen();
    return this.signups.verify(body.requestId, body.code);
  }

  @Post('signup/resend')
  @HttpCode(200)
  @SignupThrottle()
  @ApiOperation({ summary: 'Send a new code (at most 3 times)' })
  @ApiZodBody(resendSignupSchema)
  @ApiZodResponse(signupPendingSchema)
  @ApiErrors(errors(SIGNUP_ERRORS, { 400: ['SIGNUP_CODE_INVALID'] }))
  resendSignup(
    @Body(zod(resendSignupSchema)) body: z.infer<typeof resendSignupSchema>,
  ) {
    this.assertOpen();
    return this.signups.resend(body.requestId);
  }

  @Post('signup/google')
  @SignupThrottle()
  @ApiOperation({
    summary:
      'Start a trial with a Google account (e-mail already confirmed by Google)',
  })
  @ApiZodBody(googleSignupSchema)
  @ApiZodResponse(signupCompletedSchema)
  @ApiErrors(
    errors(SIGNUP_ERRORS, {
      400: ['GOOGLE_EMAIL_UNVERIFIED', 'BAD_REQUEST'],
      401: ['GOOGLE_TOKEN_INVALID'],
      403: ['GOOGLE_DISABLED'],
      409: ['TENANT_CODE_TAKEN'],
    }),
  )
  async signupWithGoogle(
    @Body(zod(googleSignupSchema)) body: GoogleSignupInput,
  ) {
    this.assertOpen();
    const identity = await this.google.verify(body.idToken);
    return this.signups.withGoogle(body, identity);
  }
}
