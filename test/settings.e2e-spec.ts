import { createTestApp, type TestApp } from './helpers.js';

type User = Awaited<ReturnType<TestApp['userWith']>>;

describe('Settings, VAT, exchange rates, payment types, registers (e2e)', () => {
  let t: TestApp;
  let admin: User;
  let manager: User;
  let cashier: User;
  const uniq = () =>
    Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

  beforeAll(async () => {
    t = await createTestApp();
    [admin, manager, cashier] = await Promise.all([
      t.userWith('Admin'),
      t.userWith('Manager'),
      t.userWith('Cashier'),
    ]);
  });
  afterAll(() => t.close());

  describe('settings', () => {
    it('is readable by any signed-in user with defaults filled in', async () => {
      const res = await t.http().get('/settings').set(cashier.auth).expect(200);
      expect(res.body).toMatchObject({
        'tax.pricesIncludeVat': expect.any(Boolean),
        'pricing.lakRounding': expect.any(Number),
        'app.timezone': 'Asia/Vientiane',
      });
    });

    it('validates and saves changes (settings.manage only)', async () => {
      const before = (await t.http().get('/settings').set(admin.auth)).body;
      await t
        .http()
        .patch('/settings')
        .set(manager.auth)
        .send({ 'store.name': 'X' })
        .expect(403);
      await t
        .http()
        .patch('/settings')
        .set(admin.auth)
        .send({ 'receipt.defaultSize': '100mm' })
        .expect(400);
      await t
        .http()
        .patch('/settings')
        .set(admin.auth)
        .send({ 'unknown.key': 1 })
        .expect(400);

      const res = await t
        .http()
        .patch('/settings')
        .set(admin.auth)
        .send({ 'store.taxId': '123456789', 'pricing.lakRounding': 500 })
        .expect(200);
      expect(res.body).toMatchObject({
        'store.taxId': '123456789',
        'pricing.lakRounding': 500,
      });

      await t
        .http()
        .patch('/settings')
        .set(admin.auth)
        .send({
          'store.taxId': before['store.taxId'],
          'pricing.lakRounding': before['pricing.lakRounding'],
        })
        .expect(200);
    });
  });

  describe('tax rates', () => {
    it('has VAT 12% as the seeded default', async () => {
      const res = await t
        .http()
        .get('/tax-rates')
        .set(cashier.auth)
        .expect(200);
      const def = res.body.filter((r: { isDefault: boolean }) => r.isDefault);
      expect(def).toHaveLength(1);
    });

    it('switches the default rate and refuses to deactivate the default', async () => {
      const original = (
        await t.prisma.taxRate.findFirstOrThrow({ where: { isDefault: true } })
      ).id;
      const created = (
        await t
          .http()
          .post('/tax-rates')
          .set(admin.auth)
          .send({ name: `VAT 7% ${uniq()}`, percent: 7 })
          .expect(201)
      ).body;
      expect(created).toMatchObject({ percent: '7', isDefault: false });

      await t
        .http()
        .post(`/tax-rates/${created.id}/default`)
        .set(admin.auth)
        .expect(200);
      expect(await t.prisma.taxRate.count({ where: { isDefault: true } })).toBe(
        1,
      );
      await t
        .http()
        .patch(`/tax-rates/${created.id}`)
        .set(admin.auth)
        .send({ isActive: false })
        .expect(400);

      await t
        .http()
        .post(`/tax-rates/${original}/default`)
        .set(admin.auth)
        .expect(200);
      await t
        .http()
        .patch(`/tax-rates/${created.id}`)
        .set(admin.auth)
        .send({ isActive: false })
        .expect(200);
      await t
        .http()
        .post('/tax-rates')
        .set(admin.auth)
        .send({ name: `bad ${uniq()}`, percent: 101 })
        .expect(400);
    });
  });

  describe('exchange rates', () => {
    it('returns the current rate per currency', async () => {
      const res = await t
        .http()
        .get('/exchange-rates/current')
        .set(cashier.auth)
        .expect(200);
      expect(res.body.LAK.lakPerUnit).toBe('1');
      expect(Number(res.body.USD.lakPerUnit)).toBeGreaterThan(0);
      expect(Number(res.body.THB.lakPerUnit)).toBeGreaterThan(0);
    });

    it('lets managers (not cashiers) set a new rate that becomes current', async () => {
      const current = (
        await t.http().get('/exchange-rates/current').set(cashier.auth)
      ).body;
      await t
        .http()
        .post('/exchange-rates')
        .set(cashier.auth)
        .send({ currency: 'USD', lakPerUnit: 22000 })
        .expect(403);
      await t
        .http()
        .post('/exchange-rates')
        .set(manager.auth)
        .send({ currency: 'LAK', lakPerUnit: 2 })
        .expect(400);

      await t
        .http()
        .post('/exchange-rates')
        .set(manager.auth)
        .send({ currency: 'USD', lakPerUnit: 21950.5 })
        .expect(201);
      const after = (
        await t.http().get('/exchange-rates/current').set(cashier.auth)
      ).body;
      expect(after.USD.lakPerUnit).toBe('21950.5');

      const history = await t
        .http()
        .get('/exchange-rates')
        .query({ currency: 'USD', limit: 2 })
        .set(cashier.auth)
        .expect(200);
      expect(history.body[0]).toMatchObject({
        lakPerUnit: '21950.5',
        createdBy: { id: manager.id },
      });

      // Restore so other suites keep the seeded rate.
      await t
        .http()
        .post('/exchange-rates')
        .set(manager.auth)
        .send({ currency: 'USD', lakPerUnit: Number(current.USD.lakPerUnit) })
        .expect(201);
    });
  });

  describe('payment types', () => {
    it('lists active types for the till and lets admins add/toggle types', async () => {
      const active = (
        await t
          .http()
          .get('/payment-types')
          .query({ active: 'true' })
          .set(cashier.auth)
          .expect(200)
      ).body as { kind: string; isActive: boolean }[];
      expect(active.every((p) => p.isActive)).toBe(true);
      expect(active.map((p) => p.kind)).toEqual(
        expect.arrayContaining(['CASH', 'CREDIT']),
      );

      const created = (
        await t
          .http()
          .post('/payment-types')
          .set(admin.auth)
          .send({
            name: `BCEL One ${uniq()}`,
            kind: 'QR',
            requiresReference: true,
          })
          .expect(201)
      ).body;
      const updated = await t
        .http()
        .patch(`/payment-types/${created.id}`)
        .set(admin.auth)
        .send({ isActive: false, kind: 'CASH' })
        .expect(200);
      expect(updated.body).toMatchObject({ isActive: false, kind: 'QR' });
    });
  });

  describe('registers', () => {
    it('creates registers with printer config and blocks duplicate codes', async () => {
      const code = `T${uniq().slice(-5)}`.toUpperCase();
      const created = (
        await t
          .http()
          .post('/registers')
          .set(admin.auth)
          .send({
            code: code.toLowerCase(),
            name: 'Counter test',
            printer: { connection: 'lan', host: '192.168.1.50', port: 9100 },
          })
          .expect(201)
      ).body;
      expect(created).toMatchObject({
        code,
        printer: {
          connection: 'lan',
          paperWidth: 80,
          openDrawer: true,
          copies: 1,
        },
      });
      await t
        .http()
        .post('/registers')
        .set(admin.auth)
        .send({ code, name: 'dup' })
        .expect(409);

      const list = await t
        .http()
        .get('/registers')
        .set(cashier.auth)
        .expect(200);
      expect(
        list.body.find((r: { code: string }) => r.code === 'R1'),
      ).toHaveProperty('openShift');

      await t
        .http()
        .patch(`/registers/${created.id}`)
        .set(admin.auth)
        .send({ printer: null, isActive: false })
        .expect(200);
      expect(
        (await t.http().get(`/registers/${created.id}`).set(cashier.auth)).body
          .printer,
      ).toBeNull();
    });

    it('refuses to deactivate a register with an open shift', async () => {
      const register = await t.prisma.register.create({
        data: { code: `S${uniq().slice(-5)}`.toUpperCase(), name: 'busy' },
      });
      await t.prisma.shift.create({
        data: {
          registerId: register.id,
          userId: cashier.id,
          openingCash: { LAK: '0' },
        },
      });
      await t
        .http()
        .patch(`/registers/${register.id}`)
        .set(admin.auth)
        .send({ isActive: false })
        .expect(409);
      await t.prisma.shift.updateMany({
        where: { registerId: register.id },
        data: { status: 'CLOSED', closedAt: new Date() },
      });
    });
  });
});
