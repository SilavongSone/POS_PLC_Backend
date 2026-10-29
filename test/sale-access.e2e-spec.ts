import { createTestApp, type TestApp } from './helpers.js';

type User = Awaited<ReturnType<TestApp['userWith']>>;

/** Who may see a sale's cost price, and branch limits on sales and registers. */
describe('Sale cost visibility and branch access (e2e)', () => {
  let t: TestApp;
  let manager: User;
  let cashier: User;
  let otherBranchUser: User;
  let registerId: string;
  let otherRegisterId: string;
  let otherBranchId: string;
  let saleId: string;
  let productId: string;
  const uniq = () =>
    Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  beforeAll(async () => {
    t = await createTestApp();
    [manager, cashier, otherBranchUser] = await Promise.all([
      t.userWith('Manager'),
      t.userWith('Cashier'),
      t.userWith('Cashier'),
    ]);

    registerId = (
      await t.prisma.register.create({
        data: {
          code: `A${uniq().slice(-5)}`.toUpperCase(),
          name: 'Access test',
          branchId: t.branchId,
        },
      })
    ).id;
    const other = await t.prisma.branch.create({
      data: { code: `B${uniq().slice(-5)}`.toUpperCase(), name: 'Other' },
    });
    otherBranchId = other.id;
    otherRegisterId = (
      await t.prisma.register.create({
        data: {
          code: `O${uniq().slice(-5)}`.toUpperCase(),
          name: 'Other branch till',
          branchId: other.id,
        },
      })
    ).id;
    await t.prisma.userBranch.create({
      data: { userId: otherBranchUser.id, branchId: other.id },
    });

    const product = (
      await t
        .http()
        .post('/products')
        .set(manager.auth)
        .send({
          sku: `AC-${uniq()}`,
          name: 'Access test',
          retailPrice: 100_000,
        })
        .expect(201)
    ).body as { id: string };
    productId = product.id;
    const doc = (
      await t
        .http()
        .post('/stock-documents')
        .set(manager.auth)
        .send({
          type: 'RECEIVE',
          branchId: t.branchId,
          items: [{ productId: product.id, quantity: 2, unitCost: 60_000 }],
        })
        .expect(201)
    ).body as { id: string };
    await t
      .http()
      .post(`/stock-documents/${doc.id}/post`)
      .set(manager.auth)
      .expect(200);

    await t
      .http()
      .post('/shifts/open')
      .set(cashier.auth)
      .send({ registerId, openingCash: {} })
      .expect(201);
    const cash = (
      await t.prisma.paymentType.findFirstOrThrow({
        where: { kind: 'CASH', isActive: true },
      })
    ).id;
    const sale = await t
      .http()
      .post('/sales')
      .set(cashier.auth)
      .send({
        registerId,
        items: [{ productId: product.id, quantity: 1 }],
        payments: [{ paymentTypeId: cash, amount: 100_000 }],
      })
      .expect(201);
    saleId = sale.body.id;
    // A cashier (no product.viewCost) never gets the cost snapshot back.
    expect(sale.body.items[0]).not.toHaveProperty('unitCostLak');
  });
  // The e2e database is shared and never reset: a second active branch would make other
  // suites' branch-less stock documents fail with BRANCH_REQUIRED.
  afterAll(async () => {
    await t.prisma.branch.update({
      where: { id: otherBranchId },
      data: { isActive: false },
    });
    await t.close();
  });

  it('shows line costs only to users with product.viewCost', async () => {
    const asCashier = await t
      .http()
      .get(`/sales/${saleId}`)
      .set(cashier.auth)
      .expect(200);
    expect(asCashier.body.items[0]).not.toHaveProperty('unitCostLak');

    const receipt = await t
      .http()
      .get(`/sales/${saleId}/receipt`)
      .set(cashier.auth)
      .expect(200);
    expect(receipt.body.sale.items[0]).not.toHaveProperty('unitCostLak');

    const asManager = await t
      .http()
      .get(`/sales/${saleId}`)
      .set(manager.auth)
      .expect(200);
    expect(asManager.body.items[0].unitCostLak).toBe('60000');
  });

  it('keeps receipts and print records inside the user’s branches', async () => {
    const receipt = await t
      .http()
      .get(`/sales/${saleId}/receipt`)
      .set(otherBranchUser.auth)
      .expect(403);
    expect(receipt.body.code).toBe('BRANCH_FORBIDDEN');

    const printed = await t
      .http()
      .post(`/sales/${saleId}/printed`)
      .set(otherBranchUser.auth)
      .expect(403);
    expect(printed.body.code).toBe('BRANCH_FORBIDDEN');

    const count = await t.prisma.sale.findUniqueOrThrow({
      where: { id: saleId },
      select: { printCount: true },
    });
    expect(count.printCount).toBe(0);
  });

  it('lists only registers in the user’s branches', async () => {
    const limited = (
      await t.http().get('/registers').set(otherBranchUser.auth).expect(200)
    ).body as { id: string }[];
    expect(limited.map((r) => r.id)).toContain(otherRegisterId);
    expect(limited.map((r) => r.id)).not.toContain(registerId);

    await t
      .http()
      .get(`/registers/${registerId}`)
      .set(otherBranchUser.auth)
      .expect(403);

    const unrestricted = (
      await t.http().get('/registers').set(cashier.auth).expect(200)
    ).body as { id: string }[];
    expect(unrestricted.map((r) => r.id)).toEqual(
      expect.arrayContaining([registerId, otherRegisterId]),
    );
  });

  it('charges the branch’s own VAT rate, else the company default', async () => {
    const admin = await t.userWith('Admin');
    const vatOf = async (user: User, register: string) =>
      (
        await t
          .http()
          .post('/sales/quote')
          .set(user.auth)
          .send({
            registerId: register,
            items: [{ productId, quantity: 1 }],
          })
          .expect(200)
      ).body.vatPercent as string;
    const companyRate = await vatOf(cashier, registerId);

    const rate = (
      await t
        .http()
        .post('/tax-rates')
        .set(admin.auth)
        .send({ name: `Branch VAT ${uniq()}`, percent: 7 })
        .expect(201)
    ).body as { id: string };
    const branch = await t
      .http()
      .patch(`/branches/${otherBranchId}`)
      .set(admin.auth)
      .send({ taxRateId: rate.id })
      .expect(200);
    expect(branch.body.taxRateId).toBe(rate.id);

    expect(await vatOf(otherBranchUser, otherRegisterId)).toBe('7');
    expect(await vatOf(cashier, registerId)).toBe(companyRate);

    // An inactive rate falls back to the default and cannot be chosen.
    await t
      .http()
      .patch(`/tax-rates/${rate.id}`)
      .set(admin.auth)
      .send({ isActive: false })
      .expect(200);
    expect(await vatOf(otherBranchUser, otherRegisterId)).toBe(companyRate);
    const bad = await t
      .http()
      .patch(`/branches/${otherBranchId}`)
      .set(admin.auth)
      .send({ taxRateId: rate.id })
      .expect(400);
    expect(bad.body.code).toBe('TAX_RATE_INVALID');
  });
});
