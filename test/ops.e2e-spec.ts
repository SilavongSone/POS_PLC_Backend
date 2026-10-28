import { createTestApp, type TestApp } from './helpers.js';

describe('Retries and audit trail (e2e)', () => {
  let t: TestApp;
  let manager: Awaited<ReturnType<TestApp['userWith']>>;
  let registerId: string;
  let cash: string;
  const uniq = () =>
    Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  beforeAll(async () => {
    t = await createTestApp();
    manager = await t.userWith('Manager');
    registerId = (
      await t.prisma.register.create({
        data: {
          code: `I${uniq().slice(-5)}`.toUpperCase(),
          name: 'Retry till',
          branchId: t.branchId,
        },
      })
    ).id;
    await t
      .http()
      .post('/shifts/open')
      .set(manager.auth)
      .send({ registerId, openingCash: {} })
      .expect(201);
    cash = (
      await t.prisma.paymentType.findFirstOrThrow({ where: { kind: 'CASH' } })
    ).id;
  });
  afterAll(() => t.close());

  async function stockedProduct(qty: number) {
    const p = (
      await t
        .http()
        .post('/products')
        .set(manager.auth)
        .send({
          sku: `IDEM-${uniq()}`,
          name: 'Retry item',
          retailPrice: 10_000,
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
          items: [{ productId: p.id, quantity: qty, unitCost: 5_000 }],
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

  it('replays a sale sent twice with the same Idempotency-Key', async () => {
    const p = await stockedProduct(5);
    const body = {
      registerId,
      items: [{ productId: p.id, quantity: 1 }],
      payments: [{ paymentTypeId: cash, amount: 10_000 }],
    };
    const key = `till-${uniq()}`;
    const send = (b: object) =>
      t
        .http()
        .post('/sales')
        .set(manager.auth)
        .set('Idempotency-Key', key)
        .send(b);

    const first = await send(body).expect(201);
    const again = await send(body).expect(201);
    expect(again.body.id).toBe(first.body.id);
    expect(again.headers['idempotent-replayed']).toBe('true');
    const product = await t.prisma.product.findUniqueOrThrow({
      where: { id: p.id },
    });
    expect(product.stockQty).toBe(4);

    const other = await send({
      ...body,
      items: [{ productId: p.id, quantity: 2 }],
    }).expect(409);
    expect(other.body.code).toBe('IDEMPOTENCY_CONFLICT');

    await t
      .http()
      .post('/sales')
      .set(manager.auth)
      .set('Idempotency-Key', 'bad key!')
      .send(body)
      .expect(400);
  });

  it('lets a failed request be retried with the same key', async () => {
    const p = await stockedProduct(1);
    const key = `till-${uniq()}`;
    const send = (quantity: number) =>
      t
        .http()
        .post('/sales')
        .set(manager.auth)
        .set('Idempotency-Key', key)
        .send({
          registerId,
          items: [{ productId: p.id, quantity }],
          payments: [{ paymentTypeId: cash, amount: quantity * 10_000 }],
        });
    await send(2).expect(409);
    // Same key, corrected request.
    await send(1).expect(201);
  });

  it('lists the audit trail for managers with the permission', async () => {
    const admin = await t.userWith('Admin');
    const cashier = await t.userWith('Cashier');
    await t.http().get('/audit-logs').set(cashier.auth).expect(403);
    const res = await t
      .http()
      .get('/audit-logs?action=STOCK_DOC_POST&pageSize=5')
      .set(admin.auth)
      .expect(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items[0]).toMatchObject({ action: 'STOCK_DOC_POST' });
  });
});
