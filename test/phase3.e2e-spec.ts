import { createTestApp, type TestApp } from './helpers.js';

type User = Awaited<ReturnType<TestApp['userWith']>>;

describe('Bundles, quotations and repairs (e2e)', () => {
  let t: TestApp;
  let manager: User;
  let registerId: string;
  let pay: Record<string, string>;
  let customerId: string;
  const uniq = () =>
    Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  async function product(body: object, quantity = 0, serials?: string[]) {
    const p = (
      await t
        .http()
        .post('/products')
        .set(manager.auth)
        .send({
          sku: `P3-${uniq()}`,
          name: 'Phase 3',
          retailPrice: 100_000,
          ...body,
        })
        .expect(201)
    ).body;
    if (quantity) {
      const doc = (
        await t
          .http()
          .post('/stock-documents')
          .set(manager.auth)
          .send({
            type: 'RECEIVE',
            items: [{ productId: p.id, quantity, unitCost: 40_000, serials }],
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

  const stock = async (id: string) =>
    (await t.prisma.product.findUniqueOrThrow({ where: { id } })).stockQty;
  const serialStatus = async (serial: string) =>
    (await t.prisma.serialNumber.findFirstOrThrow({ where: { serial } }))
      .status;

  beforeAll(async () => {
    t = await createTestApp();
    manager = await t.userWith('Manager');
    registerId = (
      await t.prisma.register.create({
        data: {
          code: `B${uniq().slice(-5)}`.toUpperCase(),
          name: 'Phase 3',
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
    const types = await t.prisma.paymentType.findMany({
      where: { isActive: true },
    });
    pay = Object.fromEntries(types.map((x) => [x.kind, x.id]));
    customerId = (
      await t
        .http()
        .post('/customers')
        .set(manager.auth)
        .send({ name: `P3 ${uniq()}`, creditLimitLak: 50_000_000 })
        .expect(201)
    ).body.id;
  });
  afterAll(() => t.close());

  describe('bundles', () => {
    let bundle: { id: string };
    let terminal: { id: string };
    let drawer: { id: string };
    const serials = [`TB-${uniq()}`, `TB-${uniq()}`];

    beforeAll(async () => {
      terminal = await product(
        { trackSerial: true, warrantyMonths: 12 },
        2,
        serials,
      );
      drawer = await product({ warrantyMonths: 3 }, 5);
      bundle = await product({
        type: 'BUNDLE',
        trackStock: false,
        retailPrice: 20_000_000,
        name: 'Restaurant POS set',
      });
    });

    it('defines components with validation', async () => {
      const plain = await product({});
      await t
        .http()
        .put(`/products/${plain.id}/bundle-items`)
        .set(manager.auth)
        .send({ items: [{ componentId: drawer.id, quantity: 1 }] })
        .expect(400);
      await t
        .http()
        .put(`/products/${bundle.id}/bundle-items`)
        .set(manager.auth)
        .send({ items: [{ componentId: bundle.id, quantity: 1 }] })
        .expect(400);
      const res = await t
        .http()
        .put(`/products/${bundle.id}/bundle-items`)
        .set(manager.auth)
        .send({
          items: [
            { componentId: terminal.id, quantity: 1 },
            { componentId: drawer.id, quantity: 2 },
          ],
        })
        .expect(200);
      expect(res.body.bundleItems).toHaveLength(2);
    });

    it('sells a bundle: components leave stock, each serial keeps its own warranty, void restores', async () => {
      const sell = (componentSerials?: object) =>
        t
          .http()
          .post('/sales')
          .set(manager.auth)
          .send({
            registerId,
            items: [{ productId: bundle.id, quantity: 1, componentSerials }],
            payments: [{ paymentTypeId: pay.CASH, amount: 20_000_000 }],
          });
      await sell().expect(400);
      await sell({ [terminal.id]: ['NOPE'] }).expect(409);

      const sale = (await sell({ [terminal.id]: [serials[0]] }).expect(201))
        .body;
      expect(await stock(drawer.id)).toBe(3);
      expect(await serialStatus(serials[0])).toBe('SOLD');
      expect(sale.items[0].unitCostLak).toBe('120000'); // terminal 40k + 2 drawers × 40k
      expect(sale.items[0].serialNumbers[0].serial).toBe(serials[0]);

      await t
        .http()
        .post(`/sales/${sale.id}/void`)
        .set(manager.auth)
        .send({ reason: 'test' })
        .expect(200);
      expect(await stock(drawer.id)).toBe(5);
      expect(await serialStatus(serials[0])).toBe('IN_STOCK');
    });

    it('returns a whole bundle with its component serials', async () => {
      const sale = (
        await t
          .http()
          .post('/sales')
          .set(manager.auth)
          .send({
            registerId,
            items: [
              {
                productId: bundle.id,
                quantity: 1,
                componentSerials: { [terminal.id]: [serials[1]] },
              },
            ],
            payments: [{ paymentTypeId: pay.CASH, amount: 20_000_000 }],
          })
          .expect(201)
      ).body;
      const items = [{ saleItemId: sale.items[0].id, quantity: 1 }];
      await t
        .http()
        .post(`/sales/${sale.id}/returns`)
        .set(manager.auth)
        .send({ reason: 'x', paymentTypeId: pay.CASH, items })
        .expect(400);
      await t
        .http()
        .post(`/sales/${sale.id}/returns`)
        .set(manager.auth)
        .send({
          reason: 'Customer cancelled',
          paymentTypeId: pay.CASH,
          items: [{ ...items[0], serials: [serials[1]] }],
        })
        .expect(201);
      expect(await serialStatus(serials[1])).toBe('IN_STOCK');
      expect(await stock(drawer.id)).toBe(5);
    });
  });

  describe('quotations', () => {
    it('quotes, sends, accepts and converts at the quoted prices', async () => {
      const p = await product({ retailPrice: 1_000_000 }, 10);
      const promo = await t.prisma.promotion.create({
        data: {
          name: 'Everything -50%',
          discountType: 'PERCENT',
          value: 50,
          startsAt: new Date(Date.now() - 60_000),
          items: { create: { productId: p.id } },
        },
      });
      try {
        const q = (
          await t
            .http()
            .post('/quotations')
            .set(manager.auth)
            .send({
              customerId,
              validUntil: '2099-12-31',
              items: [{ productId: p.id, quantity: 3, unitPriceLak: 950_000 }],
              discountLak: 50_000,
            })
            .expect(201)
        ).body;
        expect(q).toMatchObject({
          quoteNo: expect.stringMatching(/^Q-\d{6}-\d{4}$/),
          status: 'DRAFT',
          subtotalLak: '2850000',
          totalLak: '2800000',
          expired: false,
          totalInWords: 'ສອງລ້ານແປດແສນກີບຖ້ວນ',
        });

        await t
          .http()
          .post(`/quotations/${q.id}/convert`)
          .set(manager.auth)
          .send({
            registerId,
            payments: [{ paymentTypeId: pay.CASH, amount: 2_800_000 }],
          })
          .expect(409);
        await t
          .http()
          .post(`/quotations/${q.id}/status`)
          .set(manager.auth)
          .send({ status: 'SENT' })
          .expect(200);
        await t
          .http()
          .post(`/quotations/${q.id}/status`)
          .set(manager.auth)
          .send({ status: 'ACCEPTED' })
          .expect(200);
        await t
          .http()
          .put(`/quotations/${q.id}`)
          .set(manager.auth)
          .send({
            customerId,
            validUntil: '2099-12-31',
            items: [{ productId: p.id, quantity: 1 }],
          })
          .expect(409);

        const sale = (
          await t
            .http()
            .post(`/quotations/${q.id}/convert`)
            .set(manager.auth)
            .send({
              registerId,
              payments: [{ paymentTypeId: pay.CASH, amount: 2_800_000 }],
            })
            .expect(201)
        ).body;
        expect(sale).toMatchObject({ totalLak: '2800000', quotationId: q.id });
        expect(sale.items[0]).toMatchObject({
          unitPriceLak: '950000',
          promotionId: null,
        });
        expect(
          (await t.http().get(`/quotations/${q.id}`).set(manager.auth)).body,
        ).toMatchObject({ status: 'CONVERTED', sale: { id: sale.id } });
        await t
          .http()
          .post(`/quotations/${q.id}/convert`)
          .set(manager.auth)
          .send({
            registerId,
            payments: [{ paymentTypeId: pay.CASH, amount: 2_800_000 }],
          })
          .expect(409);
      } finally {
        await t.prisma.promotion.update({
          where: { id: promo.id },
          data: { isActive: false },
        });
      }
    });
  });

  describe('repairs', () => {
    it('repairs a unit under warranty for free; parts leave stock against the ticket', async () => {
      const s = `RP-${uniq()}`;
      const printer = await product(
        { trackSerial: true, warrantyMonths: 12, name: 'Receipt printer' },
        1,
        [s],
      );
      const part = await product({ name: 'Print head' }, 3);
      await t
        .http()
        .post('/sales')
        .set(manager.auth)
        .send({
          registerId,
          customerId,
          items: [{ productId: printer.id, quantity: 1, serials: [s] }],
          payments: [{ paymentTypeId: pay.CASH, amount: 100_000 }],
        })
        .expect(201);

      const ticket = (
        await t
          .http()
          .post('/service-tickets')
          .set(manager.auth)
          .send({ customerId, serial: s, problem: 'Does not cut paper' })
          .expect(201)
      ).body;
      expect(ticket).toMatchObject({
        ticketNo: expect.stringMatching(/^T-\d{6}-\d{4}$/),
        deviceName: 'Receipt printer',
        underWarranty: true,
        status: 'RECEIVED',
      });
      expect(await serialStatus(s)).toBe('IN_SERVICE');
      await t
        .http()
        .post('/service-tickets')
        .set(manager.auth)
        .send({ customerId, serial: s, problem: 'again' })
        .expect(409);

      await t
        .http()
        .put(`/service-tickets/${ticket.id}/lines`)
        .set(manager.auth)
        .send({
          lines: [
            {
              type: 'PART',
              productId: part.id,
              description: 'Print head',
              quantity: 1,
              unitPriceLak: 300_000,
            },
            { type: 'LABOR', description: 'Labour', unitPriceLak: 100_000 },
          ],
        })
        .expect(200);
      await t
        .http()
        .post(`/service-tickets/${ticket.id}/deliver`)
        .set(manager.auth)
        .send({})
        .expect(409);
      await t
        .http()
        .post(`/service-tickets/${ticket.id}/status`)
        .set(manager.auth)
        .send({ status: 'READY' })
        .expect(200);

      const done = (
        await t
          .http()
          .post(`/service-tickets/${ticket.id}/deliver`)
          .set(manager.auth)
          .send({})
          .expect(200)
      ).body;
      expect(done).toMatchObject({
        status: 'DELIVERED',
        sale: null,
        chargeLak: '0',
        quotedLak: '400000',
      });
      expect(done.logs.map((l: { status: string }) => l.status)).toEqual([
        'RECEIVED',
        'READY',
        'DELIVERED',
      ]);
      expect(await stock(part.id)).toBe(2);
      expect(await serialStatus(s)).toBe('SOLD');
    });

    it('charges an out-of-warranty repair through a sale', async () => {
      const part = await product({ name: 'Power supply' }, 2);
      const ticket = (
        await t
          .http()
          .post('/service-tickets')
          .set(manager.auth)
          .send({
            customerId,
            deviceName: 'Old POS terminal',
            deviceSerial: 'X-1',
            problem: 'No power',
          })
          .expect(201)
      ).body;
      expect(ticket.underWarranty).toBe(false);
      await t
        .http()
        .put(`/service-tickets/${ticket.id}/lines`)
        .set(manager.auth)
        .send({
          lines: [
            {
              type: 'PART',
              productId: part.id,
              description: 'PSU 12V',
              unitPriceLak: 250_000,
            },
            {
              type: 'LABOR',
              description: 'Repair labour',
              unitPriceLak: 150_000,
            },
          ],
        })
        .expect(200);
      await t
        .http()
        .patch(`/service-tickets/${ticket.id}`)
        .set(manager.auth)
        .send({ warrantyDays: 30, diagnosis: 'PSU failed' })
        .expect(200);
      await t
        .http()
        .post(`/service-tickets/${ticket.id}/status`)
        .set(manager.auth)
        .send({ status: 'READY' })
        .expect(200);

      await t
        .http()
        .post(`/service-tickets/${ticket.id}/deliver`)
        .set(manager.auth)
        .send({})
        .expect(400);
      const done = (
        await t
          .http()
          .post(`/service-tickets/${ticket.id}/deliver`)
          .set(manager.auth)
          .send({
            registerId,
            payments: [{ paymentTypeId: pay.CASH, amount: 400_000 }],
          })
          .expect(200)
      ).body;
      expect(done).toMatchObject({
        status: 'DELIVERED',
        chargeLak: '400000',
        sale: { totalLak: '400000', status: 'COMPLETED' },
      });
      const sale = (
        await t.http().get(`/sales/${done.sale.id}`).set(manager.auth)
      ).body;
      expect(
        sale.items.map((i: { productName: string }) => i.productName).sort(),
      ).toEqual(['Power supply', 'Repair labour']);
      expect(await stock(part.id)).toBe(1);

      const report = (
        await t.http().get('/reports/repairs').set(manager.auth).expect(200)
      ).body;
      expect(report.delivered).toBeGreaterThanOrEqual(2);
    });
  });
});
