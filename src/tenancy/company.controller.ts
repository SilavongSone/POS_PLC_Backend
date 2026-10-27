import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator.js';
import { AuditService } from '../common/audit.service.js';
import { RequestContext } from '../common/request-context.js';
import { ApiZodBody, zod } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { EntitlementsService } from './entitlements.service.js';

const updateCompanySchema = z
  .object({
    name: z.string().trim().min(1).max(150),
    legalName: z.string().trim().max(200).nullable(),
    taxId: z.string().trim().max(30).nullable(),
    phone: z.string().trim().max(50).nullable(),
    email: z.email().nullable(),
    /** Language for users who have not chosen one. */
    defaultLanguage: z.enum(['lo', 'th', 'en']),
  })
  .partial();
type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;

const companySelect = {
  id: true,
  code: true,
  name: true,
  legalName: true,
  taxId: true,
  phone: true,
  email: true,
  defaultLanguage: true,
} as const;

/** The signed-in user's company profile (code and status are managed by the platform). */
@ApiTags('company')
@ApiBearerAuth()
@Controller('company')
export class CompanyController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  get() {
    const id = RequestContext.tenantId();
    return RequestContext.asPlatform(() =>
      this.prisma.tenant.findUniqueOrThrow({
        where: { id },
        select: companySelect,
      }),
    );
  }

  @Patch()
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'Company name, tax details and default language' })
  @ApiZodBody(updateCompanySchema)
  async update(
    @Body(zod(updateCompanySchema)) body: UpdateCompanyInput,
    @CurrentUser() user: AuthUser,
  ) {
    const id = RequestContext.tenantId();
    const before = await this.get();
    const company = await RequestContext.asPlatform(() =>
      this.prisma.tenant.update({
        where: { id },
        data: body,
        select: companySelect,
      }),
    );
    this.entitlements.invalidate(id);
    await this.audit.log({
      userId: user.id,
      action: 'COMPANY_UPDATE',
      entity: 'Tenant',
      entityId: id,
      before,
      after: company,
    });
    return company;
  }
}
