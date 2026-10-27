import argon2 from 'argon2';
import { createTestApp, type TestApp } from './helpers.js';

type User = Awaited<ReturnType<TestApp['userWith']>>;

describe('Returns, promotions and expenses (e2e)', () => {
  let t: TestApp;
  let manager: User;
  let cashier: User;
  let registerId: string;
  let shiftId: string;
  let pay: Record<string, string>;
  const uniq = () =>
    Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  async function product(body: object, quantity: number, serials?: string[]) {
    const p = (
      await t
        .http()
        .post('/products')
        .set(manager.auth)
        .send({
          sku: `P2-${uniq()}`,
          name: 'Phase 2',
          retailPrice: 100_000,
          ...body,
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
          items: [{ productId: p.id, quantity, unitCost: 50_000, serials }],
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

  async function approval(permission: string) {
    return (
      await t
        .http()
        .post('/auth/approve')
        .set(cashier.auth)
        .send({ username: manager.username, pin: '1357', permission })
        .expect(200)
    ).body.approvalToken as string;
  }

  beforeAll(async () => {
    t = await createTestApp();
    [manager, cashier] = await Promise.all([
      t.userWith('Manager'),
      t.userWith('Cashier'),
    ]);
    await t.prisma.user.update({
      where: { id: manager.id },
      data: { pinHash: await argon2.hash('1357') },
    });
    registerId = (
      await t.prisma.register.create({
        data: {
          code: `P${uniq().slice(-5)}`.toUpperCase(),
          name: 'Phase 2',
          branchId: t.branchId,
        },
      })
    ).id;
    shiftId = (
      await t
        .http()
        .post('/shifts/open')
        .set(cashier.auth)
        .send({ registerId, openingCash: { LAK: 1_000_000 } })
        .expect(201)
    ).body.id;
    const types = await t.prisma.paymentType.findMany({
      where: { isActive: true },
    });
    pay = Object.fromEntries(types.map((x) => [x.kind, x.id]));
  });
  afterAll(() => t.close());

  describe('returns', () => {
    it('refunds the paid share, restocks and needs approval for cashiers', async () => {
      const p = await product({ retailPrice: 200_000 }, 5);
      const sale = (
        await sell({
          items: [{ productId: p.id, quantity: 3 }],
          discountLak: 60_000,
          approvals: { 'sale.discount': await approval('sale.discount') },
          payments: [{ paymentTypeId: pay.CASH, amount: 540_000 }],
        })
      ).body;
      const line = sale.items[0].id;
      const body = {
        reason: 'Changed mind',
        paymentTypeId: pay.CASH,
        items: [{ saleItemId: line, quantity: 1 }],
      };

      await t
        .http()
        .post(`/sales/${sale.id}/returns`)
        .set(cashier.auth)
        .send(body)
        .expect(403);
      const approvalToken = await approval('return.create');
      const ret = (
        await t
          .http()
          .post(`/sales/${sale.id}/returns`)
          .set(cashier.auth)
          .send({ ...body, approvalToken })
          .expect(201)
      ).body;
      // 540,000 paid for 3 units → 180,000 each after the bill discount.
      expect(ret).toMatchObject({
        refundLak: '180000',
        returnNo: expect.stringMatching(/^R-\d{6}-\d{4}$/),
      });
      expect(
        (await t.prisma.product.findUniqueOrThrow({ where: { id: p.id } }))
          .stockQty,
      ).toBe(3);

      await t
        .http()
        .post(`/sales/${sale.id}/returns`)
        .set(manager.auth)
        .send({ ...body, items: [{ saleItemId: line, quantity: 3 }] })
        .expect(400);
      await t
        .http()
        .post(`/sales/${sale.id}/void`)
        .set(manager.auth)
        .send({ reason: 'x' })
        .expect(409);

      const report = (
        await t
          .http()
          .get(`/shifts/${shiftId}/report`)
          .set(cashier.auth)
          .expect(200)
      ).body;
      expect(report.returns[0].refundLak).toBe('180000');
    });

    it('takes back serials: defective units are not resold', async () => {
      const s = [`R-${uniq()}`, `R-${uniq()}`];
      const p = await product(
        { retailPrice: 1_000_000, trackSerial: true },
        2,
        s,
      );
      const sale = (
        await sell({
          items: [{ productId: p.id, quantity: 2, serials: s }],
          payments: [{ paymentTypeId: pay.CASH, amount: 2_000_000 }],
        })
      ).body;
      const line = sale.items[0].id;

      await t
        .http()
        .post(`/sales/${sale.id}/returns`)
        .set(manager.auth)
        .send({
          reason: 'x',
          paymentTypeId: pay.CASH,
          items: [{ saleItemId: line, quantity: 1, serials: ['NOT-SOLD'] }],
        })
        .expect(400);
      await t
        .http()
        .post(`/sales/${sale.id}/returns`)
        .set(manager.auth)
        .send({
          reason: 'Dead on arrival',
          paymentTypeId: pay.CASH,
          items: [
            { saleItemId: line, quantity: 1, serials: [s[0]], restock: false },
          ],
        })
        .expect(409); // manager has no open shift for a cash refund

      await t
        .http()
        .post(`/sales/${sale.id}/returns`)
        .set(manager.auth)
        .send({
          reason: 'Dead on arrival',
          paymentTypeId: pay.BANK_TRANSFER,
          items: [
            { saleItemId: line, quantity: 1, serials: [s[0]], restock: false },
          ],
        })
        .expect(201);
      await t
        .http()
        .post(`/sales/${sale.id}/returns`)
        .set(manager.auth)
        .send({
          reason: 'Unwanted',
          paymentTypeId: pay.BANK_TRANSFER,
          items: [{ saleItemId: line, quantity: 1, serials: [s[1]] }],
        })
        .expect(201);

      const units = await t.prisma.serialNumber.findMany({
        where: { serial: { in: s } },
        orderBy: { serial: 'asc' },
      });
      const status = Object.fromEntries(units.map((u) => [u.serial, u.status]));
      expect(status).toEqual({ [s[0]]: 'DEFECTIVE', [s[1]]: 'IN_STOCK' });
      expect(
        (await t.prisma.product.findUniqueOrThrow({ where: { id: p.id } }))
          .stockQty,
      ).toBe(1);
    });

    it('takes unpaid credit off the debt instead of paying cash', async () => {
      const customer = (
        await t
          .http()
          .post('/customers')
          .set(cashier.auth)
          .send({ name: `Ret ${uniq()}`, creditLimitLak: 10_000_000 })
      ).body;
      const p = await product({ retailPrice: 500_000 }, 2);
      const sale = (
        await sell({
          customerId: customer.id,
          items: [{ productId: p.id, quantity: 2 }],
          payments: [{ paymentTypeId: pay.CREDIT, amount: 1_000_000 }],
        })
      ).body;
      const items = [{ saleItemId: sale.items[0].id, quantity: 1 }];

      await t
        .http()
        .post(`/sales/${sale.id}/returns`)
        .set(manager.auth)
        .send({ reason: 'x', paymentTypeId: pay.BANK_TRANSFER, items })
        .expect(400);
      await t
        .http()
        .post(`/sales/${sale.id}/returns`)
        .set(manager.auth)
        .send({ reason: 'x', paymentTypeId: pay.CREDIT, items })
        .expect(201);
      expect(
        (await t.http().get(`/customers/${customer.id}`).set(cashier.auth)).body
          .outstandingLak,
      ).toBe('500000');
    });
  });

  describe('promotions', () => {
    it('creates, validates and applies promotions to sales', async () => {
      const p = await product({ retailPrice: 300_000 }, 10);
      await t.http().post('/promotions').set(cashier.auth).send({}).expect(403);
      await t
        .http()
        .post('/promotions')
        .set(manager.auth)
        .send({
          name: 'Bad',
          discountType: 'PERCENT',
          value: 120,
          startsAt: new Date().toISOString(),
        })
        .expect(400);

      const promo = (
        await t
          .http()
          .post('/promotions')
          .set(manager.auth)
          .send({
            name: 'Buy 2 get 50k off each',
            discountType: 'AMOUNT',
            value: 50_000,
            minQty: 2,
            startsAt: new Date(Date.now() - 60_000).toISOString(),
            targets: [{ productId: p.id }],
          })
          .expect(201)
      ).body;
      const current = (
        await t
          .http()
          .get('/promotions?current=true')
          .set(cashier.auth)
          .expect(200)
      ).body;
      expect(current.some((x: { id: string }) => x.id === promo.id)).toBe(true);

      const quote = (qty: number) =>
        t
          .http()
          .post('/sales/quote')
          .set(cashier.auth)
          .send({ registerId, items: [{ productId: p.id, quantity: qty }] })
          .expect(200);
      expect((await quote(1)).body.lines[0].promotionDiscountLak).toBe('0');
      expect((await quote(2)).body.lines[0]).toMatchObject({
        promotionDiscountLak: '100000',
        lineTotalLak: '500000',
      });

      await t
        .http()
        .patch(`/promotions/${promo.id}`)
        .set(manager.auth)
        .send({ isActive: false })
        .expect(200);
      expect((await quote(2)).body.lines[0].promotionDiscountLak).toBe('0');
    });
  });

  describe('expenses', () => {
    it('records expenses, from the drawer when asked, and reports them', async () => {
      await t.http().get('/expenses').set(cashier.auth).expect(403);
      const accountant = await t.userWith({
        permissions: ['expense.manage', 'shift.operate'],
      });
      const category = (
        await t
          .http()
          .post('/expense-categories')
          .set(manager.auth)
          .send({ name: `Fuel ${uniq()}` })
          .expect(201)
      ).body;

      await t
        .http()
        .post('/expenses')
        .set(accountant.auth)
        .send({
          categoryId: category.id,
          description: 'Petrol',
          amount: 150_000,
          paymentTypeId: pay.CASH,
          fromDrawer: true,
        })
        .expect(409);

      const usd = (
        await t
          .http()
          .post('/expenses')
          .set(manager.auth)
          .send({
            categoryId: category.id,
            description: 'Courier',
            currency: 'USD',
            amount: 12.5,
            paymentTypeId: pay.BANK_TRANSFER,
          })
          .expect(201)
      ).body;
      expect(Number(usd.amountLak)).toBeGreaterThan(0);

      const list = (
        await t
          .http()
          .get(`/expenses?categoryId=${category.id}`)
          .set(manager.auth)
          .expect(200)
      ).body;
      expect(list).toMatchObject({ total: 1, totalLak: usd.amountLak });

      const report = (
        await t.http().get('/reports/expenses').set(manager.auth).expect(200)
      ).body;
      expect(
        report.byCategory.find(
          (c: { categoryId: string }) => c.categoryId === category.id,
        ).amountLak,
      ).toBe(usd.amountLak);

      await t
        .http()
        .delete(`/expenses/${usd.id}`)
        .set(manager.auth)
        .expect(204);
    });

    it('lowers the drawer’s expected cash for drawer expenses', async () => {
      const before = (
        await t.http().get(`/shifts/${shiftId}/report`).set(cashier.auth)
      ).body.cash.expected.LAK;
      const drawerUser = await t.prisma.user.findUniqueOrThrow({
        where: { id: cashier.id },
      });
      const group = await t.prisma.userGroup.create({
        data: {
          name: `cashier+expenses ${uniq()}`,
          permissions: ['shift.operate', 'expense.manage', 'sale.create'],
        },
      });
      await t.prisma.user.update({
        where: { id: drawerUser.id },
        data: { groupId: group.id },
      });
      const category = (await t.prisma.expenseCategory.findFirstOrThrow()).id;
      await t
        .http()
        .post('/expenses')
        .set(cashier.auth)
        .send({
          categoryId: category,
          description: 'Water',
          amount: 20_000,
          paymentTypeId: pay.CASH,
          fromDrawer: true,
        })
        .expect(201);
      const after = (
        await t.http().get(`/shifts/${shiftId}/report`).set(cashier.auth)
      ).body.cash.expected.LAK;
      expect(Number(before) - Number(after)).toBe(20_000);
    });
  });
});
