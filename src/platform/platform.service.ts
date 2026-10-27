import { Injectable } from '@nestjs/common';
import { AuditService } from '../common/audit.service.js';
import { pageArgs, toPage } from '../common/pagination.js';
import { RequestContext } from '../common/request-context.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { EntitlementsService } from '../tenancy/entitlements.service.js';
import type {
  CreatePlanInput,
  ListTenantsQuery,
  UpdatePlanInput,
  UpdateSubscriptionInput,
  UpdateTenantInput,
} from './platform.schemas.js';

const json = (v: unknown) =>
  v === null ? Prisma.DbNull : (v as Prisma.InputJsonValue | undefined);

/** Plans, companies and their subscriptions, across all tenants. */
@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
    private readonly audit: AuditService,
  ) {}

  listPlans() {
    return this.prisma.plan.findMany({
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      include: { _count: { select: { subscriptions: true } } },
    });
  }

  createPlan(input: CreatePlanInput) {
    return this.prisma.plan.create({
      data: {
        ...input,
        nameI18n: json(input.nameI18n),
        descriptionI18n: json(input.descriptionI18n),
      },
    });
  }

  async updatePlan(id: string, input: UpdatePlanInput) {
    const plan = await this.prisma.plan.update({
      where: { id },
      data: {
        ...input,
        nameI18n: json(input.nameI18n),
        descriptionI18n: json(input.descriptionI18n),
      },
    });
    // Every company on this plan sees the change within the cache time; clear now.
    const subs = await this.prisma.subscription.findMany({
      where: { planId: id },
      select: { tenantId: true },
    });
    subs.forEach((s) => this.entitlements.invalidate(s.tenantId));
    return plan;
  }

  async listTenants(q: ListTenantsQuery) {
    const where: Prisma.TenantWhereInput = {
      ...((q.status || q.planId) && {
        subscription: { status: q.status, planId: q.planId },
      }),
      ...(q.q && {
        OR: [
          { code: { contains: q.q, mode: 'insensitive' } },
          { name: { contains: q.q, mode: 'insensitive' } },
          { email: { contains: q.q, mode: 'insensitive' } },
        ],
      }),
    };
    const [items, total] = await Promise.all([
      this.prisma.tenant.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          subscription: {
            include: { plan: { select: { id: true, code: true, name: true } } },
          },
        },
        ...pageArgs(q),
      }),
      this.prisma.tenant.count({ where }),
    ]);
    return toPage(items, total, q);
  }

  /** A company with its subscription, effective entitlements and usage. */
  async getTenant(id: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id },
      include: { subscription: { include: { plan: true } } },
    });
    const [entitlements, usage] = await RequestContext.withTenant(id, () =>
      Promise.all([this.entitlements.get(id), this.entitlements.usage()]),
    );
    return { ...tenant, entitlements, usage };
  }

  async updateTenant(id: string, input: UpdateTenantInput, adminId: string) {
    const before = await this.prisma.tenant.findUniqueOrThrow({
      where: { id },
    });
    const tenant = await this.prisma.tenant.update({
      where: { id },
      data: input,
    });
    this.entitlements.invalidate(id);
    await this.audit.log({
      tenantId: id,
      userId: null,
      action: 'PLATFORM_TENANT_UPDATE',
      entity: 'Tenant',
      entityId: id,
      before,
      after: { ...input, platformAdminId: adminId },
    });
    return tenant;
  }

  async updateSubscription(
    tenantId: string,
    input: UpdateSubscriptionInput,
    adminId: string,
  ) {
    const before = await this.prisma.subscription.findUniqueOrThrow({
      where: { tenantId },
    });
    if (input.planId)
      await this.prisma.plan.findUniqueOrThrow({ where: { id: input.planId } });
    const sub = await this.prisma.subscription.update({
      where: { tenantId },
      data: { ...input, overrides: json(input.overrides) },
      include: { plan: true },
    });
    this.entitlements.invalidate(tenantId);
    await this.audit.log({
      tenantId,
      userId: null,
      action: 'PLATFORM_SUBSCRIPTION_UPDATE',
      entity: 'Subscription',
      entityId: sub.id,
      before,
      after: { ...input, platformAdminId: adminId },
    });
    return sub;
  }

  /** Companies by plan and status, and monthly recurring revenue (paying, active). */
  async stats() {
    const [byStatus, byPlan, tenants] = await Promise.all([
      this.prisma.subscription.groupBy({ by: ['status'], _count: true }),
      this.prisma.subscription.groupBy({ by: ['planId'], _count: true }),
      this.prisma.tenant.count(),
    ]);
    const plans = await this.prisma.plan.findMany();
    const active = await this.prisma.subscription.groupBy({
      by: ['planId'],
      where: { status: 'ACTIVE' },
      _count: true,
    });
    const price = new Map(plans.map((p) => [p.id, p.priceMonthlyLak]));
    const mrrLak = active.reduce(
      (sum, g) =>
        sum.add((price.get(g.planId) ?? new Prisma.Decimal(0)).mul(g._count)),
      new Prisma.Decimal(0),
    );
    return {
      tenants,
      byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
      byPlan: byPlan.map((g) => ({
        plan: plans.find((p) => p.id === g.planId)?.code,
        count: g._count,
      })),
      mrrLak,
    };
  }
}
