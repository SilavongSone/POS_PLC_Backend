import { GRACE_DAYS, resolveEntitlements } from './entitlements.service.js';

const DAY = 86_400_000;
const plan = {
  id: 'p',
  code: 'STARTER',
  name: 'Starter',
  limits: { maxBranches: 1, maxUsers: 5 },
  features: ['creditSales', 'expenses', 'notAFeature'],
};
const tenant = { id: 't', isActive: true };
const sub = (over: object = {}) => ({
  status: 'ACTIVE' as const,
  trialEndsAt: null,
  currentPeriodEnd: null,
  overrides: null,
  plan,
  ...over,
});

describe('resolveEntitlements', () => {
  it('takes features and limits from the plan; unknown keys are ignored, missing limits are unlimited', () => {
    const e = resolveEntitlements(tenant, sub());
    expect(e.features).toEqual(['creditSales', 'expenses']);
    expect(e.limits).toEqual({
      maxBranches: 1,
      maxRegisters: null,
      maxUsers: 5,
      maxProducts: null,
      maxSalesPerMonth: null,
    });
    expect(e.blocked).toBe(false);
    expect(e.readOnly).toBe(false);
  });

  it('applies per-company overrides', () => {
    const e = resolveEntitlements(
      tenant,
      sub({
        overrides: {
          limits: { maxBranches: 5, maxUsers: null },
          featuresAdd: ['repairs'],
          featuresRemove: ['expenses'],
        },
      }),
    );
    expect(e.features).toEqual(['creditSales', 'repairs']);
    expect(e.limits.maxBranches).toBe(5);
    expect(e.limits.maxUsers).toBeNull();
  });

  it('keeps full use during the grace period, then becomes read-only', () => {
    const now = new Date('2026-10-27T00:00:00Z');
    const ended = (days: number) =>
      resolveEntitlements(
        tenant,
        sub({ currentPeriodEnd: new Date(now.getTime() - days * DAY) }),
        now,
      );
    expect(ended(GRACE_DAYS - 1).readOnly).toBe(false);
    expect(ended(GRACE_DAYS + 1).readOnly).toBe(true);
    const trial = resolveEntitlements(
      tenant,
      sub({
        status: 'TRIAL',
        trialEndsAt: new Date(now.getTime() - (GRACE_DAYS + 1) * DAY),
      }),
      now,
    );
    expect(trial.readOnly).toBe(true);
  });

  it('blocks suspended, cancelled and deactivated companies, and those without a subscription', () => {
    expect(
      resolveEntitlements(tenant, sub({ status: 'SUSPENDED' })).blocked,
    ).toBe(true);
    expect(
      resolveEntitlements(tenant, sub({ status: 'CANCELLED' })).blocked,
    ).toBe(true);
    expect(
      resolveEntitlements({ ...tenant, isActive: false }, sub()).blocked,
    ).toBe(true);
    expect(resolveEntitlements(tenant, null).blocked).toBe(true);
  });
});
