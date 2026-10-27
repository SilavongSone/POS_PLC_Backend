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
import { AuthService } from '../auth/auth.service.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { ApiZodBody, zod } from '../common/zod-validation.pipe.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProvisioningService } from '../tenancy/provisioning.service.js';
import {
  provisionTenantSchema,
  signupSchema,
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
type PlatformRequest = Request & { platformAdmin: PlatformAdminUser };

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
  createTenant(@Body(zod(provisionTenantSchema)) body: ProvisionTenantInput) {
    return this.provisioning.provision(body);
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

  @Get('stats')
  @ApiOperation({
    summary: 'Companies by plan and status; monthly recurring revenue',
  })
  stats() {
    return this.platform.stats();
  }
}

/** Website-facing: price list and self-service sign-up. */
@ApiTags('public')
@Public()
@Controller('public')
export class PublicController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provisioning: ProvisioningService,
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Get('plans')
  @ApiOperation({ summary: 'Plans offered on the website' })
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

  @Post('signup')
  @Throttle({
    default: {
      ttl: 3_600_000,
      limit: () => Number(process.env.THROTTLE_SIGNUP_LIMIT ?? 3),
    },
  })
  @ApiOperation({
    summary: 'Start a trial: creates the company and signs the owner in',
  })
  @ApiZodBody(signupSchema)
  async signup(@Body(zod(signupSchema)) body: SignupInput) {
    if (!this.config.get('SIGNUP_ENABLED', { infer: true })) {
      throw new ForbiddenException({
        message: 'Sign-up is closed',
        code: 'SIGNUP_DISABLED',
      });
    }
    const { tenant } = await this.provisioning.provision(
      { ...body, status: 'TRIAL' },
      { publicOnly: true },
    );
    const tokens = await this.auth.login(
      tenant.code,
      body.owner.username,
      body.owner.password,
    );
    return {
      tenant: { id: tenant.id, code: tenant.code, name: tenant.name },
      ...tokens,
    };
  }
}
