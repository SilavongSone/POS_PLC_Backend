import { createTestApp, type TestApp } from './helpers.js';

type User = Awaited<ReturnType<TestApp['userWith']>>;

describe('Stock (e2e)', () => {
  let t: TestApp;
  let manager: User;
  let cashier: User;
  let supplierId: string;
  const uniq = () =>
    Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  beforeAll(async () => {
    t = await createTestApp();
    [manager, cashier] = await Promise.all([
      t.userWith('Manager'),
      t.userWith('Cashier'),
    ]);
    supplierId = (
      await t
        .http()
        .post('/suppliers')
        .set(manager.auth)
        .send({ name: `Supplier ${uniq()}`, phone: '020 5555 1234' })
        .expect(201)
    ).body.id;
  });
  afterAll(() => t.close());

  async function product(overrides: object = {}) {
    return (
      await t
        .http()
        .post('/products')
        .set(manager.auth)
        .send({
          sku: `ST-${uniq()}`,
          name: 'Stock test',
          retailPrice: 100_000,
          ...overrides,
        })
        .expect(201)
    ).body as { id: string; sku: string };
  }

  function doc(body: object, user = manager) {
    return t.http().post('/stock-documents').set(user.auth).send(body);
  }

  function post(id: string) {
    return t.http().post(`/stock-documents/${id}/post`).set(manager.auth);
  }

  /** Product.stockQty must always equal the sum of its ledger. */
  async function expectLedgerConsistent(productId: string) {
    const p = await t.prisma.product.findUniqueOrThrow({
      where: { id: productId },
    });
    const sum = await t.prisma.stockMovement.aggregate({
      where: { productId },
      _sum: { quantity: true },
    });
    expect(sum._sum.quantity ?? 0).toBe(p.stockQty);
    return p;
  }

  it('manages suppliers (stock.receive only)', async () => {
    await t.http().get('/suppliers').set(cashier.auth).expect(403);
    const list = await t
      .http()
      .get('/suppliers?q=Supplier')
      .set(manager.auth)
      .expect(200);
    expect(list.body.total).toBeGreaterThan(0);
  });

  it('receives serialized units through a posted document', async () => {
    const p = await product({ trackSerial: true, warrantyMonths: 12 });
    const s1 = `SN-${uniq()}`;
    const s2 = `SN-${uniq()}`;

    await doc({
      type: 'RECEIVE',
      supplierId,
      items: [{ productId: p.id, quantity: 2, unitCost: 1000, serials: [s1] }],
    }).then((r) => expect(r.status).toBe(400));
    await doc(
      {
        type: 'RECEIVE',
        items: [{ productId: p.id, quantity: 1, serials: [s1] }],
      },
      cashier,
    ).then((r) => expect(r.status).toBe(403));

    const draft = (
      await doc({
        type: 'RECEIVE',
        supplierId,
        reference: 'INV-001',
        items: [
          {
            productId: p.id,
            quantity: 2,
            unitCost: 1_500_000,
            serials: [s1, s2],
          },
        ],
      })
    ).body;
    expect(draft).toMatchObject({
      status: 'DRAFT',
      docNo: expect.stringMatching(/^GR-\d{6}-\d{4}$/),
    });
    expect((await expectLedgerConsistent(p.id)).stockQty).toBe(0);

    const posted = (await post(draft.id).expect(200)).body;
    expect(posted.status).toBe('POSTED');
    expect(
      posted.items[0].serials.map((s: { serial: string }) => s.serial).sort(),
    ).toEqual([s1, s2].sort());
    const after = await expectLedgerConsistent(p.id);
    expect(after.stockQty).toBe(2);
    expect(after.avgCostLak.toString()).toBe('1500000');

    await post(draft.id).expect(409);

    const history = (
      await t
        .http()
        .get(`/stock/serials/${s1}/history`)
        .set(cashier.auth)
        .expect(200)
    ).body;
    expect(history).toMatchObject({
      status: 'IN_STOCK',
      received: { docNo: draft.docNo, supplier: { id: supplierId } },
      sale: null,
    });
    expect(history).not.toHaveProperty('costLak');
  });

  it('rolls back the whole post when a serial already exists', async () => {
    const p = await product({ trackSerial: true });
    const existing = 'PRN-EPSON-T82X-0001';
    const draft = (
      await doc({
        type: 'RECEIVE',
        items: [
          { productId: p.id, quantity: 2, serials: [`SN-${uniq()}`, existing] },
        ],
      })
    ).body;
    await post(draft.id).expect(409);
    expect(
      (
        await t.prisma.stockDocument.findUniqueOrThrow({
          where: { id: draft.id },
        })
      ).status,
    ).toBe('DRAFT');
    expect((await expectLedgerConsistent(p.id)).stockQty).toBe(0);
  });

  it('converts foreign costs and keeps a moving-average cost', async () => {
    const p = await product();
    const first = (
      await doc({
        type: 'RECEIVE',
        currency: 'USD',
        lakPerUnit: 20000,
        items: [{ productId: p.id, quantity: 10, unitCost: 5 }],
      })
    ).body;
    expect(first.totalLak).toBe('1000000');
    await post(first.id).expect(200);

    const second = (
      await doc({
        type: 'RECEIVE',
        items: [{ productId: p.id, quantity: 30, unitCost: 120_000 }],
      })
    ).body;
    await post(second.id).expect(200);

    const after = await expectLedgerConsistent(p.id);
    // (10 × 100,000 + 30 × 120,000) / 40 = 115,000
    expect(after.avgCostLak.toString()).toBe('115000');
    expect(after).toMatchObject({ stockQty: 40, costCurrency: 'LAK' });
  });

  it('issues stock, refuses to go negative and restores on cancel', async () => {
    const p = await product();
    await post(
      (
        await doc({
          type: 'RECEIVE',
          items: [{ productId: p.id, quantity: 5, unitCost: 1000 }],
        })
      ).body.id,
    ).expect(200);

    await doc({
      type: 'ISSUE',
      items: [{ productId: p.id, quantity: 1 }],
    }).then((r) => expect(r.status).toBe(400));
    const tooMany = (
      await doc({
        type: 'ISSUE',
        reference: 'Damaged',
        items: [{ productId: p.id, quantity: 6 }],
      })
    ).body;
    await post(tooMany.id).expect(409);

    const issue = (
      await doc({
        type: 'ISSUE',
        reference: 'Shop use',
        items: [{ productId: p.id, quantity: 2 }],
      })
    ).body;
    await post(issue.id).expect(200);
    expect((await expectLedgerConsistent(p.id)).stockQty).toBe(3);

    await t
      .http()
      .post(`/stock-documents/${issue.id}/cancel`)
      .set(manager.auth)
      .send({ reason: 'mistake' })
      .expect(200);
    expect((await expectLedgerConsistent(p.id)).stockQty).toBe(5);
    await t
      .http()
      .post(`/stock-documents/${issue.id}/cancel`)
      .set(manager.auth)
      .send({ reason: 'again' })
      .expect(409);
  });

  it('issues named serials and blocks reversing a receipt whose units left stock', async () => {
    const p = await product({ trackSerial: true });
    const serials = [`SN-${uniq()}`, `SN-${uniq()}`];
    const receipt = (
      await doc({
        type: 'RECEIVE',
        items: [{ productId: p.id, quantity: 2, serials }],
      })
    ).body;
    await post(receipt.id).expect(200);

    const issue = (
      await doc({
        type: 'ISSUE',
        reference: 'Demo for client',
        items: [{ productId: p.id, quantity: 1, serials: [serials[0]] }],
      })
    ).body;
    await post(issue.id).expect(200);
    expect(
      (
        await t.prisma.serialNumber.findUniqueOrThrow({
          where: { serial: serials[0] },
        })
      ).status,
    ).toBe('ISSUED');

    await t
      .http()
      .post(`/stock-documents/${receipt.id}/cancel`)
      .set(manager.auth)
      .send({ reason: 'x' })
      .expect(409);
    expect((await expectLedgerConsistent(p.id)).stockQty).toBe(1);
  });

  it('reverses a receipt and its average cost', async () => {
    const p = await product();
    await post(
      (
        await doc({
          type: 'RECEIVE',
          items: [{ productId: p.id, quantity: 10, unitCost: 100 }],
        })
      ).body.id,
    );
    const wrong = (
      await doc({
        type: 'RECEIVE',
        items: [{ productId: p.id, quantity: 10, unitCost: 300 }],
      })
    ).body;
    await post(wrong.id).expect(200);
    expect((await expectLedgerConsistent(p.id)).avgCostLak.toString()).toBe(
      '200',
    );

    await t
      .http()
      .post(`/stock-documents/${wrong.id}/cancel`)
      .set(manager.auth)
      .send({ reason: 'wrong price' })
      .expect(200);
    const after = await expectLedgerConsistent(p.id);
    expect(after).toMatchObject({ stockQty: 10 });
    expect(after.avgCostLak.toString()).toBe('100');
  });

  it('takes expiring lots first-expiry-first-out', async () => {
    const p = await product({ trackExpiry: true });
    await doc({
      type: 'RECEIVE',
      items: [{ productId: p.id, quantity: 5 }],
    }).then((r) => expect(r.status).toBe(400));
    await post(
      (
        await doc({
          type: 'RECEIVE',
          items: [
            {
              productId: p.id,
              quantity: 5,
              lotNo: 'LATE',
              expiryDate: '2030-01-01',
            },
          ],
        })
      ).body.id,
    ).expect(200);
    await post(
      (
        await doc({
          type: 'RECEIVE',
          items: [
            {
              productId: p.id,
              quantity: 5,
              lotNo: 'SOON',
              expiryDate: '2026-11-15',
            },
          ],
        })
      ).body.id,
    ).expect(200);

    await post(
      (
        await doc({
          type: 'ISSUE',
          reference: 'use',
          items: [{ productId: p.id, quantity: 7 }],
        })
      ).body.id,
    ).expect(200);
    const lots = await t.prisma.stockLot.findMany({
      where: { productId: p.id },
      orderBy: { expiryDate: 'asc' },
    });
    expect(lots.map((l) => [l.lotNo, l.qty])).toEqual([
      ['SOON', 0],
      ['LATE', 3],
    ]);
    await expectLedgerConsistent(p.id);

    const expiring = await t
      .http()
      .get('/stock/lots/expiring?withinDays=3650')
      .set(cashier.auth)
      .expect(200);
    expect(
      expiring.body.some((l: { productId: string }) => l.productId === p.id),
    ).toBe(true);
  });

  it('adjusts up and down', async () => {
    const p = await product();
    await post(
      (
        await doc({
          type: 'ADJUST',
          reference: 'Count',
          items: [{ productId: p.id, quantity: 4 }],
        })
      ).body.id,
    ).expect(200);
    await post(
      (
        await doc({
          type: 'ADJUST',
          reference: 'Count',
          items: [{ productId: p.id, quantity: -1 }],
        })
      ).body.id,
    ).expect(200);
    expect((await expectLedgerConsistent(p.id)).stockQty).toBe(3);

    const card = await t
      .http()
      .get(`/stock/movements?productId=${p.id}`)
      .set(cashier.auth)
      .expect(200);
    expect(card.body.items.map((m: { type: string }) => m.type)).toEqual([
      'ADJUST_OUT',
      'ADJUST_IN',
    ]);
    expect(card.body.items[0]).not.toHaveProperty('unitCostLak');
  });

  it('edits drafts only and marks demo units with their own price', async () => {
    const p = await product({ trackSerial: true });
    const serial = `SN-${uniq()}`;
    const draft = (
      await doc({
        type: 'RECEIVE',
        items: [{ productId: p.id, quantity: 1, serials: [`SN-${uniq()}`] }],
      })
    ).body;
    await t
      .http()
      .put(`/stock-documents/${draft.id}`)
      .set(manager.auth)
      .send({
        type: 'RECEIVE',
        items: [
          {
            productId: p.id,
            quantity: 1,
            condition: 'DEMO',
            serials: [serial],
          },
        ],
      })
      .expect(200);
    await post(draft.id).expect(200);
    await t
      .http()
      .put(`/stock-documents/${draft.id}`)
      .set(manager.auth)
      .send({
        type: 'RECEIVE',
        items: [{ productId: p.id, quantity: 1, serials: ['x'] }],
      })
      .expect(409);

    const unit = await t.prisma.serialNumber.findUniqueOrThrow({
      where: { serial },
    });
    expect(unit.condition).toBe('DEMO');
    await t
      .http()
      .patch(`/stock/serials/${unit.id}`)
      .set(manager.auth)
      .send({ priceLak: 75_000 })
      .expect(200);
    const detail = (
      await t.http().get(`/products/${p.id}`).set(cashier.auth).expect(200)
    ).body;
    expect(detail.serialsInStock).toEqual({ DEMO: 1 });
    expect(detail.demoUnits).toEqual([
      { id: unit.id, serial, priceLak: '75000' },
    ]);
  });
});
