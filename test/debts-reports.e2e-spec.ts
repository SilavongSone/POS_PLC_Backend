import { Prisma } from '../src/generated/prisma/client.js';
import { createTestApp, type TestApp } from './helpers.js';

type User = Awaited<ReturnType<TestApp['userWith']>>;
const D = (v: Prisma.Decimal | number | string) => new Prisma.Decimal(v);

describe('Debt payments and reports (e2e)', () => {
  let t: TestApp;
  let manager: User;
  let cashier: User;
  let registerId: string;
  let pay: Record<string, string>;
  const uniq = () =>
    Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  async function product(
    retailPrice: number,
    cost: number,
    qty = 50,
    categoryId?: string,
  ) {
    const p = (
      await t
        .http()
        .post('/products')
        .set(manager.auth)
        .send({
          sku: `DR-${uniq()}`,
          name: 'Report test',
          retailPrice,
          categoryId,
        })
        .expect(201)
    ).body;
    const doc = (
      await t
        .http()
        .post('/stock-documents')
        .set(manager.auth)
        .send({
          type: 'RECEIVE',
          items: [{ productId: p.id, quantity: qty, unitCost: cost }],
        })
        .expect(201)
    ).body;
    await t
      .http()
      .post(`/stock-documents/${doc.id}/post`)
      .set(manager.auth)
      .expect(200);
    return p as { id: string };
  }

  const sell = (body: object) =>
    t
      .http()
      .post('/sales')
      .set(cashier.auth)
      .send({ registerId, ...body })
      .expect(201);

  beforeAll(async () => {
    t = await createTestApp();
    [manager, cashier] = await Promise.all([
      t.userWith('Manager'),
      t.userWith('Cashier'),
    ]);
    registerId = (
      await t.prisma.register.create({
        data: { code: `D${uniq().slice(-5)}`.toUpperCase(), name: 'Debt test' },
      })
    ).id;
    await t
      .http()
      .post('/shifts/open')
      .set(cashier.auth)
      .send({ registerId, openingCash: {} })
      .expect(201);
    const types = await t.prisma.paymentType.findMany({
      where: { isActive: true },
    });
    pay = Object.fromEntries(types.map((x) => [x.kind, x.id]));
  });
  afterAll(() => t.close());

  describe('debt payments', () => {
    let customerId: string;
    let first: { id: string };
    let second: { id: string };

    beforeAll(async () => {
      customerId = (
        await t
          .http()
          .post('/customers')
          .set(cashier.auth)
          .send({ name: `Debtor ${uniq()}`, creditLimitLak: 5_000_000 })
      ).body.id;
      const p = await product(1_000_000, 600_000);
      first = (
        await sell({
          customerId,
          items: [{ productId: p.id, quantity: 1 }],
          payments: [{ paymentTypeId: pay.CREDIT, amount: 1_000_000 }],
        })
      ).body;
      second = (
        await sell({
          customerId,
          items: [{ productId: p.id, quantity: 2 }],
          payments: [
            { paymentTypeId: pay.CASH, amount: 500_000 },
            { paymentTypeId: pay.CREDIT, amount: 1_500_000 },
          ],
        })
      ).body;
    });

    it('lists open debts oldest first', async () => {
      const debts = (
        await t
          .http()
          .get(`/customers/${customerId}/debts`)
          .set(cashier.auth)
          .expect(200)
      ).body;
      expect(
        debts.map((d: { id: string; dueLak: string }) => [d.id, d.dueLak]),
      ).toEqual([
        [first.id, '1000000'],
        [second.id, '1500000'],
      ]);
    });

    it('pays the oldest debts first and refuses overpayment', async () => {
      await t
        .http()
        .post('/debt-payments')
        .set(cashier.auth)
        .send({ customerId, paymentTypeId: pay.CASH, amount: 2_600_000 })
        .expect(400);

      const rows = (
        await t
          .http()
          .post('/debt-payments')
          .set(cashier.auth)
          .send({ customerId, paymentTypeId: pay.CASH, amount: 1_200_000 })
          .expect(201)
      ).body;
      expect(
        rows.map(
          (r: { amountLak: string; sale: { paymentStatus: string } }) => [
            r.amountLak,
            r.sale.paymentStatus,
          ],
        ),
      ).toEqual([
        ['1000000', 'PAID'],
        ['200000', 'PARTIAL'],
      ]);
      expect(rows[0].receiptNo).toMatch(/^DP-\d{6}-\d{4}-1$/);
      expect(
        (await t.http().get(`/customers/${customerId}`).set(cashier.auth)).body
          .outstandingLak,
      ).toBe('1300000');
    });

    it('needs a shift for cash, not for transfers, and can target one sale', async () => {
      await t
        .http()
        .post('/debt-payments')
        .set(manager.auth)
        .send({ customerId, paymentTypeId: pay.CASH, amount: 100_000 })
        .expect(409);
      const rows = (
        await t
          .http()
          .post('/debt-payments')
          .set(manager.auth)
          .send({
            customerId,
            saleId: second.id,
            paymentTypeId: pay.BANK_TRANSFER,
            amount: 1_300_000,
            reference: 'TR-77',
          })
          .expect(201)
      ).body;
      expect(rows).toHaveLength(1);
      expect(rows[0].sale.paymentStatus).toBe('PAID');
      await t
        .http()
        .post('/debt-payments')
        .set(manager.auth)
        .send({
          customerId,
          paymentTypeId: pay.BANK_TRANSFER,
          amount: 1,
          reference: 'x',
        })
        .expect(409);
    });
  });

  describe('reports', () => {
    it('requires report.view', async () => {
      await t.http().get('/reports/dashboard').set(cashier.auth).expect(403);
    });

    it('adds a sale to the summary with VAT, cost and profit', async () => {
      const summary = async () =>
        (
          await t
            .http()
            .get('/reports/sales-summary?groupBy=day')
            .set(manager.auth)
            .expect(200)
        ).body;
      const before = await summary();
      const p = await product(1_120_000, 700_000);
      await sell({
        items: [{ productId: p.id, quantity: 1 }],
        payments: [{ paymentTypeId: pay.CASH, amount: 1_120_000 }],
      });
      const after = await summary();

      const delta = (k: string) =>
        D(after.totals[k]).sub(before.totals[k]).toString();
      expect(after.totals.count - before.totals.count).toBe(1);
      expect(delta('totalLak')).toBe('1120000');
      expect(delta('vatLak')).toBe('120000');
      expect(delta('costLak')).toBe('700000');
      expect(delta('profitLak')).toBe('300000');
      expect(after.groups).toHaveLength(1);
      expect(after.groups[0].key).toBe(after.from);
    });

    it('groups by payment type and cashier', async () => {
      const byType = (
        await t
          .http()
          .get('/reports/sales-summary?groupBy=paymentType')
          .set(manager.auth)
          .expect(200)
      ).body;
      expect(
        byType.groups.some((g: { kind: string }) => g.kind === 'CREDIT'),
      ).toBe(true);
      const byCashier = (
        await t
          .http()
          .get('/reports/sales-summary?groupBy=cashier')
          .set(manager.auth)
          .expect(200)
      ).body;
      expect(
        byCashier.groups.find((g: { key: string }) => g.key === cashier.id)
          .label,
      ).toBe('Test User');
    });

    it('ranks best sellers and values stock', async () => {
      // A fresh category keeps the ranking independent of earlier runs on the same database.
      const category = (
        await t
          .http()
          .post('/categories')
          .set(manager.auth)
          .send({ name: `Best ${uniq()}` })
          .expect(201)
      ).body;
      const p = await product(10_000, 4_000, 500, category.id);
      await sell({
        items: [{ productId: p.id, quantity: 400 }],
        payments: [{ paymentTypeId: pay.CASH, amount: 4_000_000 }],
      });
      const best = (
        await t
          .http()
          .get(`/reports/best-sellers?limit=1&categoryId=${category.id}`)
          .set(manager.auth)
          .expect(200)
      ).body;
      expect(best.items[0]).toMatchObject({
        productId: p.id,
        quantity: 400,
        revenueLak: '4000000',
        profitLak: '2400000',
      });

      const stock = (
        await t.http().get('/reports/stock-value').set(manager.auth).expect(200)
      ).body;
      expect(
        stock.items.find((x: { id: string }) => x.id === p.id),
      ).toMatchObject({ stockQty: 100, valueLak: '400000' });
    });

    it('reports receipts, debt aging, voids, customers and the dashboard', async () => {
      const received = (
        await t
          .http()
          .get('/reports/stock-documents?type=RECEIVE')
          .set(manager.auth)
          .expect(200)
      ).body;
      expect(received.totals.quantity).toBeGreaterThan(0);

      const aging = (
        await t.http().get('/reports/debt-aging').set(manager.auth).expect(200)
      ).body;
      expect(aging.totals).toHaveProperty('over90');

      const dash = (
        await t.http().get('/reports/dashboard').set(manager.auth).expect(200)
      ).body;
      expect(dash.today.count).toBeGreaterThan(0);
      expect(dash.last7Days.length).toBeGreaterThan(0);
      expect(
        dash.openShifts.some((s: { register: { code: string } }) =>
          s.register.code.startsWith('D'),
        ),
      ).toBe(true);

      for (const path of [
        'voided-sales',
        'customer-purchases',
        'debt-payments',
        'expenses',
        'repairs',
      ]) {
        await t.http().get(`/reports/${path}`).set(manager.auth).expect(200);
      }
      await t
        .http()
        .get('/reports/sales-summary?from=2026-10-27&to=2026-10-01')
        .set(manager.auth)
        .expect(400);
    });
  });
});
