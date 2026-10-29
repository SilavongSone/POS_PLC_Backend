import { randomInt } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { RequestContext } from '../common/request-context.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  type OwnerInput,
  createOwner,
  ensureFirstBranch,
  seedReferenceData,
} from './reference-data.js';
import {
  type ProvisionTenantInput,
  tenantCodeSchema,
} from './tenancy.schemas.js';

const DAY = 86_400_000;

/**
 * Creates a company ready to sell: tenant + subscription, starter data (groups, VAT,
 * payment types, categories …), first branch and till, and the owner (Admin group).
 * All in one transaction: a failure leaves nothing behind.
 */
@Injectable()
export class ProvisioningService {
  constructor(private readonly prisma: PrismaService) {}

  /** The plan for a new company; throws if it cannot be chosen. */
  async planFor(planCode: string, options: { publicOnly?: boolean } = {}) {
    const plan = await this.prisma.plan.findUnique({
      where: { code: planCode },
    });
    if (!plan?.isActive || (options.publicOnly && !plan.isPublic)) {
      throw new BadRequestException('Unknown plan');
    }
    return plan;
  }

  /** Plan for a sign-up that did not pick one: the first public plan with a trial. */
  async defaultSignupPlanCode(): Promise<string> {
    const plans = await this.prisma.plan.findMany({
      where: { isActive: true, isPublic: true },
      orderBy: { sortOrder: 'asc' },
      select: { code: true, trialDays: true },
    });
    const plan = plans.find((p) => p.trialDays > 0) ?? plans[0];
    if (!plan) throw new BadRequestException('Unknown plan');
    return plan.code;
  }

  /**
   * A free company code from the shop name (Latin letters and digits), else from the
   * e-mail's local part: "PLC Shop" → "plc-shop", or "plc-shop-2" when that is taken.
   */
  async freeCode(shopName: string, email: string): Promise<string> {
    const slug = (s: string) =>
      s
        .normalize('NFKD')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 24)
        .replace(/-+$/, '');
    const bases = [slug(shopName), slug(email.split('@')[0] ?? ''), 'shop'];
    const base =
      bases.find((b) => tenantCodeSchema.safeParse(b).success) ?? 'shop';
    for (let n = 1; n <= 50; n++) {
      const code = n === 1 ? base : `${base}-${n}`;
      if (!tenantCodeSchema.safeParse(code).success) continue;
      if (!(await this.prisma.tenant.findUnique({ where: { code } })))
        return code;
    }
    return `${base}-${randomInt(1000, 10000)}`;
  }

  /** Throws 409 TENANT_CODE_TAKEN when the company code is in use. */
  async assertCodeFree(code: string) {
    if (await this.prisma.tenant.findUnique({ where: { code } })) {
      throw new ConflictException({
        message: 'This company code is already taken',
        code: 'TENANT_CODE_TAKEN',
      });
    }
  }

  async provision(
    input: Omit<ProvisionTenantInput, 'owner'> & { owner: OwnerInput },
    options: { publicOnly?: boolean } = {},
  ) {
    const plan = await this.planFor(input.planCode, options);
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
