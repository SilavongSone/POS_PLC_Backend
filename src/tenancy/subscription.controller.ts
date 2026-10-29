import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiZodResponse } from '../common/openapi.js';
import { RequestContext } from '../common/request-context.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { EntitlementsService } from './entitlements.service.js';
import { subscriptionSchema } from './subscription.responses.js';

@ApiTags('subscription')
@ApiBearerAuth()
@Controller('subscription')
export class SubscriptionController {
  constructor(
    private readonly entitlements: EntitlementsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @ApiZodResponse(subscriptionSchema)
  @ApiOperation({
    summary:
      "The company's plan, status, features, limits and current usage (for every user)",
  })
  async get() {
    const tenantId = RequestContext.tenantId();
    const [e, usage, tenant] = await Promise.all([
      this.entitlements.get(tenantId),
      this.entitlements.usage(),
      RequestContext.asPlatform(() =>
        this.prisma.tenant.findUniqueOrThrow({
          where: { id: tenantId },
          select: { code: true, name: true, defaultLanguage: true },
        }),
      ),
    ]);
    return { company: tenant, ...e, usage };
  }
}
