import { createTestApp, type TestApp } from './helpers.js';

type Company = {
  id: string;
  code: string;
  auth: { Authorization: string };
};

/**
 * Multi-company SaaS: platform admin, company isolation, branches and transfers,
 * plan features and limits, subscription status, self-service sign-up.
 */
describe('SaaS (e2e)', () => {
  let t: TestApp;
  let platform: { Authorization: string };
  const uniq = () =>
    Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const OWNER_PASSWORD = 'owner-password-1';

  async function login(code: string, username = 'owner') {
    const res = await t
      .http()
      .post('/auth/login')
      .send({ tenantCode: code, username, password: OWNER_PASSWORD });
    return res;
  }

  async function company(planCode = 'BUSINESS', status = 'ACTIVE') {
    const code = `co-${uniq()}`;
    const res = await t
      .http()
      .post('/platform/tenants')
      .set(platform)
      .send({
        code,
        name: `Company ${code}`,
        planCode,
        status,
        owner: {
          username: 'owner',
          fullName: 'Owner',
          password: OWNER_PASSWORD,
        },
      })
      .expect(201);
    const tokens = (await login(code)).body as { accessToken: string };
    return {
      id: res.body.tenant.id as string,
      code,
      auth: { Authorization: `Bearer ${tokens.accessToken}` },
    } satisfies Company;
  }

  const api = (c: Company) => ({
    get: (url: string) => t.http().get(url).set(c.auth),
    post: (url: string, body: object = {}) =>
      t.http().post(url).set(c.auth).send(body),
    patch: (url: string, body: object) =>
      t.http().patch(url).set(c.auth).send(body),
  });

  async function product(c: Company, overrides: object = {}) {
    return (
      await api(c)
        .post('/products', {
          sku: `SAAS-${uniq()}`,
          name: 'SaaS item',
          retailPrice: 100_000,
          ...overrides,
        })
        .expect(201)
    ).body as { id: string; sku: string };
  }

  beforeAll(async () => {
    t = await createTestApp();
    const res = await t
      .http()
      .post('/platform/auth/login')
      .send({ email: 'platform@test.local', password: 'platform-password-1' })
      .expect(200);
    platform = { Authorization: `Bearer ${res.body.accessToken as string}` };
  });
  afterAll(() => t.close());

  describe('platform admin', () => {
    it('keeps platform and company tokens apart', async () => {
      await t
        .http()
        .post('/platform/auth/login')
        .send({ email: 'platform@test.local', password: 'wrong-password' })
        .expect(401);
      const admin = await t.userWith('Admin');
      await t.http().get('/platform/plans').set(admin.auth).expect(401);
      await t.http().get('/products').set(platform).expect(401);
    });

    it('edits plans and lists companies with stats', async () => {
      const plans = (
        await t.http().get('/platform/plans').set(platform).expect(200)
      ).body as { id: string; code: string }[];
      expect(plans.map((p) => p.code)).toEqual(
        expect.arrayContaining(['FREE', 'STARTER', 'BUSINESS', 'ENTERPRISE']),
      );
      const code = `P${uniq()}`.toUpperCase().slice(0, 20);
      const plan = (
        await t
          .http()
          .post('/platform/plans')
          .set(platform)
          .send({
            code,
            name: 'Custom',
            priceMonthlyLak: 99_000,
            limits: {
              maxBranches: 2,
              maxRegisters: 2,
              maxUsers: 3,
              maxProducts: 50,
              maxSalesPerMonth: null,
            },
            features: ['repairs', 'repairs'],
            isPublic: false,
          })
          .expect(201)
      ).body;
      expect(plan.features).toEqual(['repairs']);
      await t
        .http()
        .patch(`/platform/plans/${plan.id}`)
        .set(platform)
        .send({ features: ['repairs', 'quotations'] })
        .expect(200);
      // Hidden plans are not on the website.
      const pub = (await t.http().get('/public/plans').expect(200)).body as {
        code: string;
      }[];
      expect(pub.some((p) => p.code === code)).toBe(false);

      const c = await company();
      const list = await t
        .http()
        .get(`/platform/tenants?q=${c.code}`)
        .set(platform)
        .expect(200);
      expect(list.body.items).toHaveLength(1);
      const detail = (
        await t
          .http()
          .get(`/platform/tenants/${c.id}`)
          .set(platform)
          .expect(200)
      ).body;
      expect(detail.entitlements.plan.code).toBe('BUSINESS');
      expect(detail.usage).toMatchObject({ maxBranches: 1, maxUsers: 1 });
      const stats = (
        await t.http().get('/platform/stats').set(platform).expect(200)
      ).body;
      expect(stats.tenants).toBeGreaterThan(1);
    });

    it('rejects a taken company code', async () => {
      const c = await company();
      const res = await t
        .http()
        .post('/platform/tenants')
        .set(platform)
        .send({
          code: c.code,
          name: 'Again',
          planCode: 'FREE',
          owner: { username: 'owner', fullName: 'O', password: OWNER_PASSWORD },
        })
        .expect(409);
      expect(res.body.code).toBe('TENANT_CODE_TAKEN');
    });
  });

  describe('company isolation', () => {
    let a: Company;
    let b: Company;
    beforeAll(async () => {
      [a, b] = await Promise.all([company(), company()]);
    });

    it('gives each company its own data, codes and numbering', async () => {
      const sku = `SAME-${uniq()}`.toUpperCase();
      const pa = await product(a, { sku });
      const pb = await product(b, { sku });
      expect(pa.id).not.toBe(pb.id);

      await api(b).get(`/products/${pa.id}`).expect(404);
      await api(b).patch(`/products/${pa.id}`, { name: 'hijack' }).expect(404);
      const listB = (await api(b).get(`/products?q=${sku}`).expect(200)).body;
      expect(listB.items.map((p: { id: string }) => p.id)).toEqual([pb.id]);

      // Same seeded reference data, but separate rows.
      const groupsA = (await api(a).get('/user-groups').expect(200)).body;
      const groupsB = (await api(b).get('/user-groups').expect(200)).body;
      expect(groupsA[0].id).not.toBe(groupsB[0].id);
      await api(b).get('/customers').expect(200);
    });

    it('does not let one company reference another company’s rows', async () => {
      const customerA = (
        await api(a)
          .post('/customers', {
            name: 'A customer',
            phone: `020${Date.now() % 1e8}`,
          })
          .expect(201)
      ).body;
      await api(b).get(`/customers/${customerA.id}`).expect(404);
      await api(b)
        .post('/service-tickets', {
          customerId: customerA.id,
          deviceName: 'X',
          problem: 'Y',
        })
        .expect(404);
    });

    it('logs in to the right company only', async () => {
      expect((await login(a.code)).status).toBe(200);
      const wrong = await t.http().post('/auth/login').send({
        tenantCode: 'no-such-co',
        username: 'owner',
        password: OWNER_PASSWORD,
      });
      expect(wrong.status).toBe(401);
    });
  });

  describe('branches', () => {
    let c: Company;
    let main: string;
    let second: string;
    beforeAll(async () => {
      c = await company();
      main = (await api(c).get('/branches').expect(200)).body[0].id;
      second = (
        await api(c)
          .post('/branches', { code: 'B2', name: 'Branch 2' })
          .expect(201)
      ).body.id;
    });

    it('needs a branch when the company has several', async () => {
      const p = await product(c);
      const res = await api(c)
        .post('/stock-documents', {
          type: 'RECEIVE',
          items: [{ productId: p.id, quantity: 1, unitCost: 1000 }],
        })
        .expect(400);
      expect(res.body.code).toBe('BRANCH_REQUIRED');
    });

    it('keeps stock per branch, transfers between them and sells only what the till’s branch has', async () => {
      const p = await product(c);
      const receipt = (
        await api(c)
          .post('/stock-documents', {
            type: 'RECEIVE',
            branchId: main,
            items: [{ productId: p.id, quantity: 10, unitCost: 50_000 }],
          })
          .expect(201)
      ).body;
      await api(c).post(`/stock-documents/${receipt.id}/post`).expect(200);

      const transfer = (
        await api(c)
          .post('/stock-documents', {
            type: 'TRANSFER',
            branchId: main,
            toBranchId: second,
            items: [{ productId: p.id, quantity: 3 }],
          })
          .expect(201)
      ).body;
      expect(transfer.docNo).toMatch(/^TR-/);
      await api(c).post(`/stock-documents/${transfer.id}/post`).expect(200);

      const detail = (await api(c).get(`/products/${p.id}`).expect(200)).body;
      expect(detail.stockQty).toBe(10);
      expect(
        Object.fromEntries(
          detail.branchStock.map((b: { id: string; qty: number }) => [
            b.id,
            b.qty,
          ]),
        ),
      ).toEqual({ [main]: 7, [second]: 3 });

      const value = (
        await api(c)
          .get(`/reports/stock-value?branchId=${second}&q=${p.sku}`)
          .expect(200)
      ).body;
      expect(value.items[0].stockQty).toBe(3);

      const register = (
        await api(c)
          .post('/registers', { code: 'R2', name: 'B2 till', branchId: second })
          .expect(201)
      ).body;
      await api(c)
        .post('/shifts/open', { registerId: register.id, openingCash: {} })
        .expect(201);
      const cash = (await api(c).get('/payment-types').expect(200)).body.find(
        (x: { kind: string }) => x.kind === 'CASH',
      ).id;
      const sell = (quantity: number) =>
        api(c).post('/sales', {
          registerId: register.id,
          items: [{ productId: p.id, quantity }],
          payments: [{ paymentTypeId: cash, amount: quantity * 100_000 }],
        });
      expect((await sell(4)).status).toBe(409);
      const sale = (await sell(2).expect(201)).body;
      expect(sale.branchId).toBe(second);

      // Cancelling the transfer needs the goods back at the receiving branch: only 1 left.
      await api(c)
        .post(`/stock-documents/${transfer.id}/cancel`, { reason: 'test' })
        .expect(409);

      const sales = (await api(c).get(`/sales?branchId=${main}`).expect(200))
        .body;
      expect(sales.items.some((s: { id: string }) => s.id === sale.id)).toBe(
        false,
      );
    });

    it('limits users to their branches', async () => {
      const groups = (await api(c).get('/user-groups').expect(200)).body as {
        id: string;
        name: string;
      }[];
      const cashierGroup = groups.find((g) => g.name === 'Cashier')!.id;
      const username = `b2-${uniq()}`;
      const user = (
        await api(c)
          .post('/users', {
            username,
            fullName: 'Branch 2 cashier',
            password: OWNER_PASSWORD,
            groupId: cashierGroup,
            branchIds: [second],
          })
          .expect(201)
      ).body;
      expect(user.branchIds).toEqual([second]);
      const token = (await login(c.code, username)).body.accessToken as string;
      const cashier = { Authorization: `Bearer ${token}` };
      const mainRegister = (
        await api(c).get('/registers').expect(200)
      ).body.find((r: { branchId: string }) => r.branchId === main);
      const res = await t
        .http()
        .post('/shifts/open')
        .set(cashier)
        .send({ registerId: mainRegister.id, openingCash: {} })
        .expect(403);
      expect(res.body.code).toBe('BRANCH_FORBIDDEN');
    });
  });

  describe('plans and subscriptions', () => {
    it('enforces plan features and limits, and per-company overrides', async () => {
      const c = await company('FREE');
      const promo = {
        name: 'Promo',
        discountType: 'PERCENT',
        value: 10,
        startsAt: new Date().toISOString(),
      };
      const denied = await api(c).post('/promotions', promo).expect(403);
      expect(denied.body).toMatchObject({
        code: 'FEATURE_NOT_IN_PLAN',
        feature: 'promotions',
      });
      const limit = await api(c)
        .post('/branches', { code: 'B2', name: 'Two' })
        .expect(403);
      expect(limit.body).toMatchObject({
        code: 'PLAN_LIMIT_REACHED',
        limit: 'maxBranches',
        max: 1,
        used: 1,
      });

      await t
        .http()
        .patch(`/platform/tenants/${c.id}/subscription`)
        .set(platform)
        .send({
          overrides: {
            featuresAdd: ['promotions'],
            limits: { maxBranches: 2 },
          },
        })
        .expect(200);
      await api(c).post('/promotions', promo).expect(201);
      await api(c).post('/branches', { code: 'B2', name: 'Two' }).expect(201);

      const sub = (await api(c).get('/subscription').expect(200)).body;
      expect(sub.plan.code).toBe('FREE');
      expect(sub.features).toContain('promotions');
      expect(sub.usage.maxBranches).toBe(2);
    });

    it('suspends a company and makes an expired one read-only', async () => {
      const c = await company();
      const sub = (status: object) =>
        t
          .http()
          .patch(`/platform/tenants/${c.id}/subscription`)
          .set(platform)
          .send(status)
          .expect(200);

      await sub({ status: 'SUSPENDED' });
      expect((await api(c).get('/products').expect(403)).body.code).toBe(
        'TENANT_SUSPENDED',
      );
      expect((await login(c.code)).status).toBe(403);

      await sub({
        status: 'ACTIVE',
        currentPeriodEnd: new Date(Date.now() - 30 * 86_400_000).toISOString(),
      });
      await api(c).get('/products').expect(200);
      const res = await api(c)
        .post('/brands', { name: `Brand ${uniq()}` })
        .expect(402);
      expect(res.body.code).toBe('SUBSCRIPTION_INACTIVE');

      await sub({ currentPeriodEnd: null });
      await api(c)
        .post('/brands', { name: `Brand ${uniq()}` })
        .expect(201);
    });
  });

  describe('self-service sign-up', () => {
    it('starts a trial and signs the owner in', async () => {
      const code = `su-${uniq()}`;
      const body = {
        code,
        name: 'Signup shop',
        email: 'owner@example.com',
        planCode: 'STARTER',
        owner: { username: 'boss', fullName: 'Boss', password: OWNER_PASSWORD },
      };
      const res = await t.http().post('/public/signup').send(body).expect(201);
      expect(res.body.tenant.code).toBe(code);
      const auth = {
        Authorization: `Bearer ${res.body.accessToken as string}`,
      };
      const sub = (await t.http().get('/subscription').set(auth).expect(200))
        .body;
      expect(sub.status).toBe('TRIAL');
      expect(new Date(sub.trialEndsAt).getTime()).toBeGreaterThan(Date.now());
      expect(sub.company.name).toBe('Signup shop');

      await t.http().post('/public/signup').send(body).expect(409);
      await t
        .http()
        .post('/public/signup')
        .send({ ...body, code: `x-${uniq()}`, planCode: 'NOPE' })
        .expect(400);
    });
  });
});
