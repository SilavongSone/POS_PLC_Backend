import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { RequestContext } from '../common/request-context.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  createOwner,
  ensureFirstBranch,
  seedReferenceData,
} from './reference-data.js';
import type { ProvisionTenantInput } from './tenancy.schemas.js';

const DAY = 86_400_000;

/**
 * Creates a company ready to sell: tenant + subscription, starter data (groups, VAT,
 * payment types, categories …), first branch and till, and the owner (Admin group).
 * All in one transaction: a failure leaves nothing behind.
 */
@Injectable()
export class ProvisioningService {
  constructor(private readonly prisma: PrismaService) {}

  async provision(
    input: ProvisionTenantInput,
    options: { publicOnly?: boolean } = {},
  ) {
    const plan = await this.prisma.plan.findUnique({
      where: { code: input.planCode },
    });
    if (!plan?.isActive || (options.publicOnly && !plan.isPublic)) {
      throw new BadRequestException('Unknown plan');
    }
    const now = Date.now();
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const tenant = await RequestContext.asPlatform(() =>
            tx.tenant.create({
              data: {
                code: input.code,
                name: input.name,
                legalName: input.legalName,
                taxId: input.taxId,
                phone: input.phone,
                email: input.email,
                defaultLanguage: input.defaultLanguage,
                subscription: {
                  create: {
                    planId: plan.id,
                    status: input.status,
                    trialEndsAt:
                      input.status === 'TRIAL'
                        ? new Date(now + plan.trialDays * DAY)
                        : null,
                    currentPeriodEnd: input.currentPeriodEnd ?? null,
                  },
                },
              },
              include: { subscription: { include: { plan: true } } },
            }),
          );
          const owner = await RequestContext.withTenant(tenant.id, async () => {
            await seedReferenceData(tx, { storeName: input.name });
            await ensureFirstBranch(tx, input.branch);
            await tx.setting.updateMany({
              where: { key: 'store.companyName' },
              data: { value: input.legalName ?? input.name },
            });
            return createOwner(tx, input.owner);
          });
          return {
            tenant,
            owner: { id: owner.id, username: owner.username },
          };
        },
        { timeout: 30_000 },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException({
          message: 'This company code is already taken',
          code: 'TENANT_CODE_TAKEN',
        });
      }
      throw error;
    }
  }
}
