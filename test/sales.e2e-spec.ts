import argon2 from 'argon2';
import { Prisma } from '../src/generated/prisma/client.js';
import { createTestApp, type TestApp } from './helpers.js';

type User = Awaited<ReturnType<TestApp['userWith']>>;
const D = (v: Prisma.Decimal | number | string) => new Prisma.Decimal(v);

describe('Sales, shifts, held bills, tax invoices (e2e)', () => {
  let t: TestApp;
  let manager: User;
  let cashier: User;
  let registerId: string;
  let registerCode: string;
  let shiftId: string;
  let pay: Record<'CASH' | 'QR' | 'CREDIT' | 'BANK_TRANSFER', string>;
  let usdRate: Prisma.Decimal;
  const uniq = () =>
    Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  async function product(
    body: object,
    stock: { quantity: number; serials?: string[]; cost?: number },
  ) {
    const p = (
      await t
        .http()
        .post('/products')
        .set(manager.auth)
        .send({
          sku: `SL-${uniq()}`,
          name: 'Sale test',
          retailPrice: 100_000,
          ...body,
        })
        .expect(201)
    ).body;
    if (stock.quantity) {
      const doc = (
        await t
          .http()
          .post('/stock-documents')
          .set(manager.auth)
          .send({
            type: 'RECEIVE',
            items: [
              {
                productId: p.id,
                quantity: stock.quantity,
                unitCost: stock.cost ?? 60_000,
                serials: stock.serials,
              },
            ],
          })
          .expect(201)
      ).body;
      await t
        .http()
        .post(`/stock-documents/${doc.id}/post`)
        .set(manager.auth)
        .expect(200);
    }
    return p as { id: string; sku: string };
  }

  const sell = (body: object, user = cashier) =>
    t
      .http()
      .post('/sales')
      .set(user.auth)
      .send({ registerId, ...body });
  const cash = (amount: number) => ({ paymentTypeId: pay.CASH, amount });

  async function approval(permission: string) {
    return (
      await t
        .http()
        .post('/auth/approve')
        .set(cashier.auth)
        .send({ username: manager.username, pin: '9876', permission })
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
      data: { pinHash: await argon2.hash('9876') },
    });
    registerCode = `Q${uniq().slice(-5)}`.toUpperCase();
    registerId = (
      await t.prisma.register.create({
        data: { code: registerCode, name: 'Sales test', branchId: t.branchId },
      })
    ).id;
    const types = await t.prisma.paymentType.findMany();
    const byKind = (kind: string) =>
      types.find((x) => x.kind === kind && x.isActive)!.id;
    pay = {
      CASH: byKind('CASH'),
      QR: byKind('QR'),
      CREDIT: byKind('CREDIT'),
      BANK_TRANSFER: byKind('BANK_TRANSFER'),
    };
    usdRate = D(
      (await t.http().get('/exchange-rates/current').set(cashier.auth)).body.USD
        .lakPerUnit,
    );
  });
  afterAll(() => t.close());

  it('needs an open shift on the register', async () => {
    const p = await product({}, { quantity: 1 });
    const res = await sell({
      items: [{ productId: p.id, quantity: 1 }],
      payments: [cash(100_000)],
    }).expect(404);
    expect(res.body.code).toBe('NO_OPEN_SHIFT');
  });

  it('opens one shift per register and user', async () => {
    const res = await t
      .http()
      .post('/shifts/open')
      .set(cashier.auth)
      .send({ registerId, openingCash: { LAK: 500_000, USD: 20 } })
      .expect(201);
    shiftId = res.body.id;
    expect(res.body.openingCash).toEqual({
      LAK: '500000',
      THB: '0',
      USD: '20',
    });
    await t
      .http()
      .post('/shifts/open')
      .set(cashier.auth)
      .send({ registerId, openingCash: {} })
      .expect(409);
    expect(
      (await t.http().get('/shifts/current').set(cashier.auth).expect(200)).body
        .id,
    ).toBe(shiftId);
  });

  it('sells serialized and plain items for cash with change and extracted VAT', async () => {
    const plain = await product(
      { retailPrice: 150_000 },
      { quantity: 5, cost: 90_000 },
    );
    const s = [`SL-SN-${uniq()}`, `SL-SN-${uniq()}`];
    const serialized = await product(
      { retailPrice: 1_000_000, trackSerial: true, warrantyMonths: 12 },
      { quantity: 2, serials: s, cost: 700_000 },
    );

    const res = await sell({
      items: [
        { productId: plain.id, quantity: 2 },
        { productId: serialized.id, quantity: 1, serials: [s[0]] },
      ],
      payments: [cash(1_500_000)],
    }).expect(201);
    const sale = res.body;
    expect(sale.receiptNo).toMatch(
      new RegExp(`^S-${registerCode}-\\d{6}-0001$`),
    );
    expect(sale).toMatchObject({
      status: 'COMPLETED',
      paymentStatus: 'PAID',
      subtotalLak: '1300000',
      totalLak: '1300000',
      paidLak: '1300000',
      changeLak: '200000',
      vatPercent: '12',
      vatLak: '139286', // 1,300,000 × 12 / 112
    });
    const serialLine = sale.items.find(
      (i: { productId: string }) => i.productId === serialized.id,
    );
    // Cashiers lack product.viewCost: the cost snapshot is stored but not returned.
    expect(serialLine).not.toHaveProperty('unitCostLak');
    const storedLine = await t.prisma.saleItem.findUniqueOrThrow({
      where: { id: serialLine.id },
    });
    expect(storedLine.unitCostLak.toString()).toBe('700000');
    expect(serialLine.serialNumbers[0].serial).toBe(s[0]);
    expect(serialLine.serialNumbers[0].warrantyEndsAt).not.toBeNull();

    const unit = await t.prisma.serialNumber.findFirstOrThrow({
      where: { serial: s[0] },
    });
    expect(unit.status).toBe('SOLD');
    expect(
      (await t.prisma.product.findUniqueOrThrow({ where: { id: plain.id } }))
        .stockQty,
    ).toBe(3);

    const history = (
      await t.http().get(`/stock/serials/${s[0]}/history`).set(cashier.auth)
    ).body;
    expect(history.sale.receiptNo).toBe(sale.receiptNo);
    expect(history.warranty.active).toBe(true);
  });

  it('takes several currencies and only gives change from cash', async () => {
    const p = await product({ retailPrice: 3_000_000 }, { quantity: 3 });
    const usd = 100;
    const usdLak = D(usd)
      .mul(usdRate)
      .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
    const rest = D(3_000_000).sub(usdLak);

    const ok = await sell({
      items: [{ productId: p.id, quantity: 1 }],
      payments: [
        { paymentTypeId: pay.CASH, currency: 'USD', amount: usd },
        { paymentTypeId: pay.QR, amount: Number(rest), reference: 'QR-123' },
      ],
    }).expect(201);
    expect(
      ok.body.payments.find((x: { currency: string }) => x.currency === 'USD')
        .amountLak,
    ).toBe(usdLak.toString());

    await sell({
      items: [{ productId: p.id, quantity: 1 }],
      payments: [cash(2_000_000)],
    }).expect(400);
    await sell({
      items: [{ productId: p.id, quantity: 1 }],
      payments: [{ paymentTypeId: pay.QR, amount: 3_100_000, reference: 'x' }],
    }).expect(400);
    await sell({
      items: [{ productId: p.id, quantity: 1 }],
      payments: [{ paymentTypeId: pay.QR, amount: 3_000_000 }],
    }).expect(400);
  });

  it('needs a manager approval to change prices or give discounts', async () => {
    const p = await product({ retailPrice: 200_000 }, { quantity: 5 });
    const res = await sell({
      items: [{ productId: p.id, quantity: 1, unitPriceLak: 180_000 }],
      payments: [cash(180_000)],
    }).expect(403);
    expect(res.body.code).toBe('APPROVAL_REQUIRED');

    const overridden = await sell({
      items: [{ productId: p.id, quantity: 1, unitPriceLak: 180_000 }],
      payments: [cash(180_000)],
      approvals: { 'price.override': await approval('price.override') },
    }).expect(201);
    expect(overridden.body.items[0]).toMatchObject({
      listPriceLak: '200000',
      unitPriceLak: '180000',
      priceOverriddenById: manager.id,
    });

    await sell({
      items: [{ productId: p.id, quantity: 1 }],
      discountLak: 10_000,
      payments: [cash(190_000)],
    }).expect(403);
    const discounted = await sell({
      items: [{ productId: p.id, quantity: 1, discountLak: 5_000 }],
      discountLak: 15_000,
      payments: [cash(180_000)],
      approvals: { 'sale.discount': await approval('sale.discount') },
    }).expect(201);
    expect(discounted.body).toMatchObject({
      subtotalLak: '195000',
      discountLak: '15000',
      totalLak: '180000',
    });
  });

  it('uses wholesale prices for wholesale customers and quantities', async () => {
    const p = await product(
      { retailPrice: 100_000, wholesalePrice: 80_000, wholesaleMinQty: 10 },
      { quantity: 20 },
    );
    const quote = (qty: number, customerId?: string) =>
      t
        .http()
        .post('/sales/quote')
        .set(cashier.auth)
        .send({
          registerId,
          customerId,
          items: [{ productId: p.id, quantity: qty }],
        })
        .expect(200);

    expect((await quote(2)).body.lines[0].unitPriceLak).toBe('100000');
    expect((await quote(10)).body.lines[0].unitPriceLak).toBe('80000');
    const shop = (
      await t
        .http()
        .post('/customers')
        .set(cashier.auth)
        .send({ name: `Shop ${uniq()}`, priceTier: 'WHOLESALE' })
        .expect(201)
    ).body;
    expect(shop.code).toMatch(/^C\d{5}$/);
    expect((await quote(1, shop.id)).body).toMatchObject({
      priceTier: 'WHOLESALE',
      lines: [{ unitPriceLak: '80000' }],
    });
  });

  it('sells demo units at their own price, on their own line', async () => {
    const s = [`DEMO-${uniq()}`, `NEW-${uniq()}`];
    const p = await product(
      { retailPrice: 5_000_000, trackSerial: true },
      { quantity: 2, serials: s },
    );
    await t.prisma.serialNumber.updateMany({
      where: { serial: s[0] },
      data: { condition: 'DEMO', priceLak: 3_900_000 },
    });

    await sell({
      items: [{ productId: p.id, quantity: 2, serials: s }],
      payments: [cash(10_000_000)],
    }).expect(400);
    const res = await sell({
      items: [{ productId: p.id, quantity: 1, serials: [s[0]] }],
      payments: [cash(3_900_000)],
    }).expect(201);
    expect(res.body.items[0]).toMatchObject({
      listPriceLak: '3900000',
      unitPriceLak: '3900000',
    });
  });

  it('applies the best active promotion for the product category', async () => {
    const category = (
      await t
        .http()
        .post('/categories')
        .set(manager.auth)
        .send({ name: `Promo ${uniq()}` })
        .expect(201)
    ).body;
    const p = await product(
      { retailPrice: 400_000, categoryId: category.id },
      { quantity: 5 },
    );
    const promo = await t.prisma.promotion.create({
      data: {
        name: '10% off',
        discountType: 'PERCENT',
        value: 10,
        startsAt: new Date(Date.now() - 60_000),
        items: { create: { categoryId: category.id } },
      },
    });
    try {
      const res = await sell({
        items: [{ productId: p.id, quantity: 2 }],
        payments: [cash(720_000)],
      }).expect(201);
      expect(res.body.items[0]).toMatchObject({
        discountLak: '80000',
        lineTotalLak: '720000',
        promotion: { id: promo.id },
      });
    } finally {
      await t.prisma.promotion.update({
        where: { id: promo.id },
        data: { isActive: false },
      });
    }
  });

  it('sells on credit within the customer limit', async () => {
    const p = await product({ retailPrice: 1_000_000 }, { quantity: 5 });
    const credit = (amount: number) => ({ paymentTypeId: pay.CREDIT, amount });
    await sell({
      items: [{ productId: p.id, quantity: 1 }],
      payments: [credit(1_000_000)],
    }).expect(400);

    const noLimit = (
      await t
        .http()
        .post('/customers')
        .set(cashier.auth)
        .send({ name: `NoCredit ${uniq()}` })
    ).body;
    const r1 = await sell({
      customerId: noLimit.id,
      items: [{ productId: p.id, quantity: 1 }],
      payments: [credit(1_000_000)],
    }).expect(409);
    expect(r1.body.code).toBe('CREDIT_LIMIT');

    const firm = (
      await t
        .http()
        .post('/customers')
        .set(cashier.auth)
        .send({
          name: `Firm ${uniq()}`,
          type: 'BUSINESS',
          creditLimitLak: 1_500_000,
        })
    ).body;
    const partial = await sell({
      customerId: firm.id,
      items: [{ productId: p.id, quantity: 1 }],
      payments: [cash(400_000), credit(600_000)],
      dueDate: '2026-12-31',
    }).expect(201);
    expect(partial.body).toMatchObject({
      paymentStatus: 'PARTIAL',
      paidLak: '400000',
    });

    await sell({
      customerId: firm.id,
      items: [{ productId: p.id, quantity: 1 }],
      payments: [credit(1_000_000)],
    }).expect(409);
    const detail = (
      await t.http().get(`/customers/${firm.id}`).set(cashier.auth)
    ).body;
    expect(detail.outstandingLak).toBe('600000');
    const debtors = (
      await t
        .http()
        .get('/customers?withDebt=true&pageSize=100')
        .set(cashier.auth)
    ).body;
    expect(debtors.items.some((c: { id: string }) => c.id === firm.id)).toBe(
      true,
    );
  });

  it('voids with a manager approval and puts stock and serials back', async () => {
    const s = [`V-${uniq()}`];
    const p = await product(
      { retailPrice: 500_000, trackSerial: true },
      { quantity: 1, serials: s },
    );
    const sale = (
      await sell({
        items: [{ productId: p.id, quantity: 1, serials: s }],
        payments: [cash(500_000)],
      }).expect(201)
    ).body;

    await t
      .http()
      .post(`/sales/${sale.id}/void`)
      .set(cashier.auth)
      .send({ reason: 'wrong item' })
      .expect(403);
    const approvalToken = await approval('sale.void');
    const voided = await t
      .http()
      .post(`/sales/${sale.id}/void`)
      .set(cashier.auth)
      .send({ reason: 'wrong item', approvalToken })
      .expect(200);
    expect(voided.body).toMatchObject({
      status: 'VOIDED',
      voidReason: 'wrong item',
    });
    expect(
      (
        await t.prisma.serialNumber.findFirstOrThrow({
          where: { serial: s[0] },
        })
      ).status,
    ).toBe('IN_STOCK');
    expect(
      (await t.prisma.product.findUniqueOrThrow({ where: { id: p.id } }))
        .stockQty,
    ).toBe(1);
    await t
      .http()
      .post(`/sales/${sale.id}/void`)
      .set(manager.auth)
      .send({ reason: 'again' })
      .expect(409);
  });

  it('issues, protects, cancels and reissues tax invoices', async () => {
    const p = await product({ retailPrice: 2_240_000 }, { quantity: 2 });
    const firm = (
      await t
        .http()
        .post('/customers')
        .set(cashier.auth)
        .send({
          name: 'Somchai',
          companyName: `ABC Co ${uniq()}`,
          taxId: '1234567890',
          type: 'BUSINESS',
        })
    ).body;
    const sale = (
      await sell({
        customerId: firm.id,
        items: [{ productId: p.id, quantity: 1 }],
        payments: [cash(2_240_000)],
      }).expect(201)
    ).body;

    const inv = (
      await t
        .http()
        .post(`/sales/${sale.id}/tax-invoice`)
        .set(cashier.auth)
        .send({})
        .expect(201)
    ).body;
    expect(inv).toMatchObject({
      invoiceNo: expect.stringMatching(/^INV-\d{4}-\d{6}$/),
      buyerName: firm.companyName,
      buyerTaxId: '1234567890',
      amounts: {
        beforeVatLak: '2000000',
        vatLak: '240000',
        totalLak: '2240000',
        totalInWords: 'ສອງລ້ານສອງແສນສີ່ໝື່ນກີບຖ້ວນ',
      },
    });
    await t
      .http()
      .post(`/sales/${sale.id}/tax-invoice`)
      .set(cashier.auth)
      .send({})
      .expect(409);
    await t
      .http()
      .post(`/sales/${sale.id}/void`)
      .set(manager.auth)
      .send({ reason: 'x' })
      .expect(409);

    await t
      .http()
      .post(`/tax-invoices/${inv.id}/cancel`)
      .set(manager.auth)
      .send({ reason: 'wrong name' })
      .expect(200);
    const again = (
      await t
        .http()
        .post(`/sales/${sale.id}/tax-invoice`)
        .set(cashier.auth)
        .send({ buyerName: 'ABC Company' })
        .expect(201)
    ).body;
    expect(again.invoiceNo).not.toBe(inv.invoiceNo);
  });

  it('parks a cart and clears it when the sale completes', async () => {
    const p = await product({}, { quantity: 2 });
    const bill = (
      await t
        .http()
        .post('/held-bills')
        .set(cashier.auth)
        .send({
          label: 'Table 4',
          cart: { items: [{ productId: p.id, quantity: 1 }] },
        })
        .expect(201)
    ).body;
    expect(
      (await t.http().get('/held-bills').set(cashier.auth)).body.some(
        (b: { id: string }) => b.id === bill.id,
      ),
    ).toBe(true);
    await sell({
      heldBillId: bill.id,
      items: [{ productId: p.id, quantity: 1 }],
      payments: [cash(100_000)],
    }).expect(201);
    await t.http().get(`/held-bills/${bill.id}`).set(cashier.auth).expect(404);
  });

  it('builds receipts and audits reprints', async () => {
    const p = await product({}, { quantity: 1 });
    const sale = (
      await sell({
        items: [{ productId: p.id, quantity: 1 }],
        payments: [cash(100_000)],
      }).expect(201)
    ).body;
    const receipt = (
      await t
        .http()
        .get(`/sales/${sale.id}/receipt`)
        .set(cashier.auth)
        .expect(200)
    ).body;
    expect(receipt).toMatchObject({
      totalInWords: 'ໜຶ່ງແສນກີບຖ້ວນ',
      isReprint: false,
      sale: { id: sale.id },
    });
    await t
      .http()
      .post(`/sales/${sale.id}/printed`)
      .set(cashier.auth)
      .expect(200);
    await t
      .http()
      .post(`/sales/${sale.id}/printed`)
      .set(cashier.auth)
      .expect(200);
    expect(
      await t.prisma.auditLog.count({
        where: { entityId: sale.id, action: 'SALE_REPRINT' },
      }),
    ).toBe(1);
  });

  it('reports expected cash and closes the shift with the difference', async () => {
    await t
      .http()
      .post(`/shifts/${shiftId}/cash-movements`)
      .set(cashier.auth)
      .send({ type: 'PAY_OUT', currency: 'LAK', amount: 50_000, reason: 'Ice' })
      .expect(201);
    const report = (
      await t
        .http()
        .get(`/shifts/${shiftId}/report`)
        .set(cashier.auth)
        .expect(200)
    ).body;

    // Recompute expected LAK cash independently from the database.
    const cashLak = await t.prisma.payment.aggregate({
      where: {
        sale: { shiftId, status: 'COMPLETED' },
        paymentTypeId: pay.CASH,
        currency: 'LAK',
      },
      _sum: { amount: true },
    });
    const change = await t.prisma.sale.aggregate({
      where: { shiftId, status: 'COMPLETED' },
      _sum: { changeLak: true },
    });
    const expectedLak = D(500_000)
      .add(cashLak._sum.amount ?? 0)
      .sub(change._sum.changeLak ?? 0)
      .sub(50_000);
    expect(report.cash.expected.LAK).toBe(expectedLak.toString());
    expect(report.voided.count).toBe(1);

    const closed = (
      await t
        .http()
        .post(`/shifts/${shiftId}/close`)
        .set(cashier.auth)
        .send({
          closingCash: {
            LAK: Number(expectedLak) - 1000,
            USD: Number(report.cash.expected.USD),
          },
        })
        .expect(200)
    ).body;
    expect(closed.cash.difference).toMatchObject({ LAK: '-1000', USD: '0' });
    await t
      .http()
      .post(`/shifts/${shiftId}/close`)
      .set(cashier.auth)
      .send({ closingCash: {} })
      .expect(409);

    const any = await t.prisma.sale.findFirstOrThrow({
      where: { shiftId, status: 'COMPLETED' },
    });
    await t
      .http()
      .post(`/sales/${any.id}/void`)
      .set(manager.auth)
      .send({ reason: 'late' })
      .expect(409);
  });
});
