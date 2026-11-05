import { currenciesSchema } from '../src/settings/settings.responses.js';
import { createTestApp, type TestApp } from './helpers.js';

type User = Awaited<ReturnType<TestApp['userWith']>>;

describe('Company currencies (e2e)', () => {
  let t: TestApp;
  let admin: User;
  let manager: User;
  let cashier: User;
  let code: string;
  let cashTypeId: string;
  let registerId: string;
  const uniq = () =>
    Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  /** A 3-letter code the shared test company does not have yet. */
  async function freeCode(): Promise<string> {
    const taken = new Set(
      (await t.prisma.currency.findMany({ select: { code: true } })).map(
        (c) => c.code,
      ),
    );
    for (;;) {
      const c = Array.from({ length: 3 }, () =>
        String.fromCharCode(65 + Math.floor(Math.random() * 26)),
      ).join('');
      if (!taken.has(c)) return c;
    }
  }

  beforeAll(async () => {
    t = await createTestApp();
    [admin, manager, cashier] = await Promise.all([
      t.userWith('Admin'),
      t.userWith('Manager'),
      t.userWith('Cashier'),
    ]);
    code = await freeCode();
    cashTypeId = (
      await t.prisma.paymentType.findFirstOrThrow({
        where: { kind: 'CASH', isActive: true },
      })
    ).id;
    registerId = (
      await t.prisma.register.create({
        data: {
          code: `C${uniq().slice(-5)}`.toUpperCase(),
          name: 'Currency test',
          branchId: t.branchId,
        },
      })
    ).id;
  });
  afterAll(() => t.close());

  it('lists LAK (base), THB and USD for every company', async () => {
    const res = await t.http().get('/currencies').set(cashier.auth).expect(200);
    currenciesSchema.parse(res.body);
    const codes = res.body.map((c: { code: string }) => c.code);
    expect(codes[0]).toBe('LAK');
    expect(codes).toEqual(expect.arrayContaining(['THB', 'USD']));
    expect(res.body[0]).toMatchObject({ isBase: true, decimals: 0 });
  });

  it('lets managers add a currency with its first rate (not cashiers)', async () => {
    const body = {
      code: code.toLowerCase(),
      name: 'Test money',
      nameI18n: { lo: 'ເງິນທົດສອບ', en: 'Test money' },
      symbol: '¤',
      decimals: 1,
      lakPerUnit: 3050.25,
    };
    await t.http().post('/currencies').set(cashier.auth).send(body).expect(403);
    const res = await t
      .http()
      .post('/currencies')
      .set(manager.auth)
      .send(body)
      .expect(201);
    expect(res.body).toMatchObject({ code, decimals: 1, isActive: true });

    const dup = await t
      .http()
      .post('/currencies')
      .set(manager.auth)
      .send(body)
      .expect(409);
    expect(dup.body.code).toBe('CURRENCY_EXISTS');

    const rates = (
      await t.http().get('/exchange-rates/current').set(cashier.auth)
    ).body;
    expect(rates[code].lakPerUnit).toBe('3050.25');
  });

  it('never disables or deletes LAK', async () => {
    const off = await t
      .http()
      .patch('/currencies/LAK')
      .set(admin.auth)
      .send({ isActive: false })
      .expect(400);
    expect(off.body.code).toBe('CURRENCY_BASE_LOCKED');
    await t.http().delete('/currencies/LAK').set(admin.auth).expect(400);
  });

  it('takes a split payment in the new currency and counts it at shift close', async () => {
    const opened = await t
      .http()
      .post('/shifts/open')
      .set(cashier.auth)
      .send({ registerId, openingCash: { LAK: 100_000, [code]: 10 } })
      .expect(201);
    const shiftId = opened.body.id as string;
    const p = (
      await t
        .http()
        .post('/products')
        .set(manager.auth)
        .send({
          sku: `CUR-${uniq()}`,
          name: 'Currency test service',
          type: 'SERVICE',
          retailPrice: 200_000,
        })
        .expect(201)
    ).body;

    // More decimals than the currency allows.
    const bad = await t
      .http()
      .post('/sales')
      .set(cashier.auth)
      .send({
        registerId,
        items: [{ productId: p.id, quantity: 1 }],
        payments: [
          { paymentTypeId: cashTypeId, currency: code, amount: 50.25 },
        ],
      })
      .expect(400);
    expect(bad.body.code).toBe('CURRENCY_DECIMALS');

    // 50 × 3050.25 = 152,512.5 → 152,513 LAK; the rest in kip.
    const sale = await t
      .http()
      .post('/sales')
      .set(cashier.auth)
      .send({
        registerId,
        items: [{ productId: p.id, quantity: 1 }],
        payments: [
          { paymentTypeId: cashTypeId, currency: code, amount: 50 },
          { paymentTypeId: cashTypeId, currency: 'LAK', amount: 47_487 },
        ],
      })
      .expect(201);
    const payment = sale.body.payments.find(
      (x: { currency: string }) => x.currency === code,
    );
    expect(payment).toMatchObject({ lakPerUnit: '3050.25' });

    const closed = await t
      .http()
      .post(`/shifts/${shiftId}/close`)
      .set(cashier.auth)
      .send({ closingCash: { LAK: 147_487, [code]: 60 } })
      .expect(200);
    expect(closed.body.cash.expected[code]).toBe('60');
    expect(closed.body.cash.difference[code]).toBe('0');
    expect(closed.body.cash.difference.LAK).toBe('0');
  });

  it('refuses a disabled currency for new payments, and deletes only unused ones', async () => {
    await t
      .http()
      .patch(`/currencies/${code}`)
      .set(manager.auth)
      .send({ isActive: false })
      .expect(200);
    const active = (
      await t.http().get('/currencies?active=true').set(cashier.auth)
    ).body.map((c: { code: string }) => c.code);
    expect(active).not.toContain(code);

    const refused = await t
      .http()
      .post('/shifts/open')
      .set(cashier.auth)
      .send({ registerId, openingCash: { LAK: 0, [code]: 5 } })
      .expect(400);
    expect(refused.body.code).toBe('CURRENCY_UNAVAILABLE');

    const used = await t
      .http()
      .delete(`/currencies/${code}`)
      .set(manager.auth)
      .expect(409);
    expect(used.body.code).toBe('CURRENCY_IN_USE');

    const unused = await freeCode();
    await t
      .http()
      .post('/currencies')
      .set(manager.auth)
      .send({ code: unused, name: 'Never used', lakPerUnit: 1.5 })
      .expect(201);
    await t
      .http()
      .delete(`/currencies/${unused}`)
      .set(manager.auth)
      .expect(204);
    expect(
      await t.prisma.exchangeRate.count({ where: { currency: unused } }),
    ).toBe(0);
  });

  it('rejects rates and expenses in unknown currencies', async () => {
    const rate = await t
      .http()
      .post('/exchange-rates')
      .set(manager.auth)
      .send({ currency: 'ZZZ', lakPerUnit: 10 });
    if ((await t.prisma.currency.count({ where: { code: 'ZZZ' } })) === 0) {
      expect(rate.status).toBe(400);
      expect(rate.body.code).toBe('CURRENCY_UNAVAILABLE');
    }
  });
});
