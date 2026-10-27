import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { RequestContext } from '../common/request-context.js';
import { localDateParts, startOfLocalDay } from '../common/time.js';
import type { SubscriptionStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  FEATURES,
  LIMIT_KEYS,
  type Feature,
  type LimitKey,
  type PlanLimits,
} from './plan-features.js';

/** After the trial or paid period ends the company keeps full use this long. */
export const GRACE_DAYS = 7;
const CACHE_MS = 30_000;
const DAY = 86_400_000;

/** Per-company changes to its plan, set by a platform admin. */
export type SubscriptionOverrides = {
  limits?: Partial<PlanLimits>;
  featuresAdd?: Feature[];
  featuresRemove?: Feature[];
};

export type Entitlements = {
  tenantId: string;
  plan: { id: string; code: string; name: string } | null;
  status: SubscriptionStatus | null;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  /** End of the grace period after the trial/paid period; null = no end date. */
  graceEndsAt: Date | null;
  features: Feature[];
  limits: PlanLimits;
  /** Suspended, cancelled, deactivated or without a subscription: no access at all. */
  blocked: boolean;
  /** Past the grace period: reading only. */
  readOnly: boolean;
};

const UNLIMITED: PlanLimits = Object.fromEntries(
  LIMIT_KEYS.map((k) => [k, null]),
) as PlanLimits;

/** Plan + overrides → what a company may use. Pure, for unit tests. */
export function resolveEntitlements(
  tenant: { id: string; isActive: boolean },
  sub: {
    status: SubscriptionStatus;
    trialEndsAt: Date | null;
    currentPeriodEnd: Date | null;
    overrides: unknown;
    plan: {
      id: string;
      code: string;
      name: string;
      limits: unknown;
      features: string[];
    };
  } | null,
  now = new Date(),
): Entitlements {
  if (!sub) {
    return {
      tenantId: tenant.id,
      plan: null,
      status: null,
      trialEndsAt: null,
      currentPeriodEnd: null,
      graceEndsAt: null,
      features: [],
      limits: UNLIMITED,
      blocked: true,
      readOnly: true,
    };
  }
  const o = (sub.overrides ?? {}) as SubscriptionOverrides;
  const known = (f: string): f is Feature =>
    (FEATURES as readonly string[]).includes(f);
  const features = new Set<Feature>(sub.plan.features.filter(known));
  for (const f of o.featuresAdd ?? []) if (known(f)) features.add(f);
  for (const f of o.featuresRemove ?? []) features.delete(f);

  const planLimits = (sub.plan.limits ?? {}) as Partial<PlanLimits>;
  const limits = Object.fromEntries(
    LIMIT_KEYS.map((k) => [
      k,
      o.limits && k in o.limits
        ? (o.limits[k] ?? null)
        : (planLimits[k] ?? null),
    ]),
  ) as PlanLimits;

  const periodEnd =
    sub.status === 'TRIAL' ? sub.trialEndsAt : sub.currentPeriodEnd;
  const graceEndsAt = periodEnd
    ? new Date(periodEnd.getTime() + GRACE_DAYS * DAY)
    : null;
  return {
    tenantId: tenant.id,
    plan: { id: sub.plan.id, code: sub.plan.code, name: sub.plan.name },
    status: sub.status,
    trialEndsAt: sub.trialEndsAt,
    currentPeriodEnd: sub.currentPeriodEnd,
    graceEndsAt,
    features: FEATURES.filter((f) => features.has(f)),
    limits,
    blocked:
      !tenant.isActive ||
      sub.status === 'SUSPENDED' ||
      sub.status === 'CANCELLED',
    readOnly: Boolean(graceEndsAt && now > graceEndsAt),
  };
}

/**
 * What the current company's plan allows: feature flags, limits and whether the
 * subscription is usable. Cached 30 s per company; platform changes invalidate it.
 */
@Injectable()
export class EntitlementsService {
  private readonly cache = new Map<
    string,
    { value: Promise<Entitlements>; expires: number }
  >();

  constructor(private readonly prisma: PrismaService) {}

  get(tenantId = RequestContext.tenantId()): Promise<Entitlements> {
    const hit = this.cache.get(tenantId);
    if (hit && hit.expires > Date.now()) return hit.value;
    const value = this.load(tenantId);
    this.cache.set(tenantId, { value, expires: Date.now() + CACHE_MS });
    value.catch(() => this.cache.delete(tenantId));
    return value;
  }

  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
  }

  private async load(tenantId: string): Promise<Entitlements> {
    const tenant = await RequestContext.asPlatform(() =>
      this.prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        include: { subscription: { include: { plan: true } } },
      }),
    );
    return resolveEntitlements(tenant, tenant.subscription);
  }

  /** Throws 403 TENANT_SUSPENDED when the company may not use the system. */
  assertNotBlocked(e: Entitlements): void {
    if (e.blocked) {
      throw new ForbiddenException({
        message: 'This company account is suspended',
        code: 'TENANT_SUSPENDED',
      });
    }
  }

  /** Throws 402 SUBSCRIPTION_INACTIVE for writes after the grace period. */
  assertWritable(e: Entitlements): void {
    if (e.readOnly) {
      throw new HttpException(
        {
          message: 'The subscription has expired; renew to make changes',
          code: 'SUBSCRIPTION_INACTIVE',
          graceEndedAt: e.graceEndsAt,
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
  }

  async hasFeature(feature: Feature): Promise<boolean> {
    return (await this.get()).features.includes(feature);
  }

  async assertFeature(feature: Feature): Promise<void> {
    if (!(await this.hasFeature(feature))) {
      throw new ForbiddenException({
        message: `Your plan does not include ${feature}`,
        code: 'FEATURE_NOT_IN_PLAN',
        feature,
      });
    }
  }

  /** Throws 403 PLAN_LIMIT_REACHED if adding `adding` more would pass the plan limit. */
  async assertLimit(key: LimitKey, adding = 1): Promise<void> {
    const limit = (await this.get()).limits[key];
    if (limit === null) return;
    const used = await this.used(key);
    if (used + adding > limit) {
      throw new ForbiddenException({
        message: `Plan limit reached: ${key} (${limit})`,
        code: 'PLAN_LIMIT_REACHED',
        limit: key,
        max: limit,
        used,
      });
    }
  }

  /** Current use of each limited resource. */
  async usage(): Promise<Record<LimitKey, number>> {
    const values = await Promise.all(LIMIT_KEYS.map((k) => this.used(k)));
    return Object.fromEntries(
      LIMIT_KEYS.map((k, i) => [k, values[i]]),
    ) as Record<LimitKey, number>;
  }

  private used(key: LimitKey): Promise<number> {
    switch (key) {
      case 'maxBranches':
        return this.prisma.branch.count({ where: { isActive: true } });
      case 'maxRegisters':
        return this.prisma.register.count({ where: { isActive: true } });
      case 'maxUsers':
        return this.prisma.user.count({ where: { isActive: true } });
      case 'maxProducts':
        return this.prisma.product.count({ where: { isActive: true } });
      case 'maxSalesPerMonth': {
        const { year, month } = localDateParts(new Date());
        return this.prisma.sale.count({
          where: { createdAt: { gte: startOfLocalDay(`${year}-${month}-01`) } },
        });
      }
    }
  }
}
