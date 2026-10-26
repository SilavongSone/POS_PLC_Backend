import { existsSync } from 'node:fs';
import path from 'node:path';
import { Prisma } from '../src/generated/prisma/client.js';
import { createTestApp, type TestApp } from './helpers.js';

type User = Awaited<ReturnType<TestApp['userWith']>>;

// A 1×1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

describe('Catalog (e2e)', () => {
  let t: TestApp;
  let manager: User;
  let cashier: User;
  let viewer: User;
  const uniq = () =>
    Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  beforeAll(async () => {
    t = await createTestApp();
    [manager, cashier, viewer] = await Promise.all([
      t.userWith('Manager'),
      t.userWith('Cashier'),
      t.userWith('Viewer'),
    ]);
  });
  afterAll(() => t.close());

  async function newCategory() {
    return (
      await t
        .http()
        .post('/categories')
        .set(manager.auth)
        .send({ name: `Test Cat ${uniq()}` })
        .expect(201)
    ).body as { id: string; slug: string };
  }

  async function newProduct(overrides: object = {}) {
    return (
      await t
        .http()
        .post('/products')
        .set(manager.auth)
        .send({
          sku: `T-${uniq()}`,
          name: 'Test product',
          retailPrice: 100_000,
          ...overrides,
        })
        .expect(201)
    ).body;
  }

  describe('categories and brands', () => {
    it('returns the seeded tree and filters products by a parent category', async () => {
      const tree = (
        await t.http().get('/categories?tree=true').set(viewer.auth).expect(200)
      ).body;
      const printers = tree.find((c: { slug: string }) => c.slug === 'printer');
      expect(printers.children.map((c: { slug: string }) => c.slug)).toEqual(
        expect.arrayContaining(['printer-receipt', 'printer-label']),
      );

      const res = await t
        .http()
        .get('/products')
        .query({ categoryId: printers.id, pageSize: 100 })
        .set(viewer.auth)
        .expect(200);
      expect(res.body.items.map((p: { sku: string }) => p.sku)).toEqual(
        expect.arrayContaining(['PRN-EPSON-T82X', 'PRN-XP-365B']),
      );
    });

    it('creates with an automatic slug, prevents cycles and protects used categories', async () => {
      const parent = await newCategory();
      expect(parent.slug).toMatch(/^test-cat-/);
      const child = (
        await t
          .http()
          .post('/categories')
          .set(manager.auth)
          .send({ name: `Child ${uniq()}`, parentId: parent.id })
          .expect(201)
      ).body;

      await t
        .http()
        .patch(`/categories/${parent.id}`)
        .set(manager.auth)
        .send({ parentId: child.id })
        .expect(400);
      await t
        .http()
        .post('/categories')
        .set(cashier.auth)
        .send({ name: 'x' })
        .expect(403);

      await newProduct({ categoryId: child.id });
      await t
        .http()
        .delete(`/categories/${child.id}`)
        .set(manager.auth)
        .expect(409);
      await t
        .http()
        .delete(`/categories/${parent.id}`)
        .set(manager.auth)
        .expect(409);
    });

    it('manages brands', async () => {
      const brand = (
        await t
          .http()
          .post('/brands')
          .set(manager.auth)
          .send({ name: `Brand ${uniq()}` })
          .expect(201)
      ).body;
      await t
        .http()
        .post('/brands')
        .set(manager.auth)
        .send({ name: brand.name })
        .expect(409);
      await newProduct({ brandId: brand.id });
      await t
        .http()
        .delete(`/brands/${brand.id}`)
        .set(manager.auth)
        .expect(409);
      const list = (await t.http().get('/brands').set(viewer.auth).expect(200))
        .body;
      expect(
        list.find((b: { id: string }) => b.id === brand.id).productCount,
      ).toBe(1);
    });
  });

  describe('products', () => {
    it('hides costs from users without product.viewCost', async () => {
      const asViewer = (
        await t.http().get('/products?q=EPSON').set(viewer.auth).expect(200)
      ).body;
      expect(asViewer.items[0]).not.toHaveProperty('avgCostLak');
      expect(asViewer.items[0]).not.toHaveProperty('costPrice');
      const asManager = (
        await t.http().get('/products?q=EPSON').set(manager.auth).expect(200)
      ).body;
      expect(asManager.items[0]).toHaveProperty('avgCostLak');
    });

    it('converts USD prices to LAK with the current rate, rounded up to 1,000', async () => {
      const product = await t.prisma.product.findUniqueOrThrow({
        where: { sku: 'DSP-MSI-PRO-MP243' },
      });
      const rate = (
        await t.http().get('/exchange-rates/current').set(viewer.auth)
      ).body.USD.lakPerUnit;
      const expected = new Prisma.Decimal(product.retailPrice)
        .mul(rate)
        .div(1000)
        .ceil()
        .mul(1000)
        .toString();
      const res = await t
        .http()
        .get(`/products/${product.id}`)
        .set(viewer.auth)
        .expect(200);
      expect(res.body).toMatchObject({
        priceCurrency: 'USD',
        retailPriceLak: expected,
      });
      expect(res.body.serialsInStock.NEW).toBe(product.stockQty);
    });

    it('looks up by barcode, SKU (any case) and serial number', async () => {
      const byBarcode = await t
        .http()
        .get('/products/lookup?code=8850001000042')
        .set(cashier.auth)
        .expect(200);
      expect(byBarcode.body).toMatchObject({
        product: { sku: 'PRN-EPSON-T82X' },
        serial: null,
      });

      await t
        .http()
        .get('/products/lookup?code=prn-epson-t82x')
        .set(cashier.auth)
        .expect(200);

      const bySerial = await t
        .http()
        .get('/products/lookup?code=PRN-EPSON-T82X-0001')
        .set(cashier.auth)
        .expect(200);
      expect(bySerial.body.serial).toMatchObject({
        status: 'IN_STOCK',
        condition: 'NEW',
      });

      await t
        .http()
        .get('/products/lookup?code=NOPE-123')
        .set(cashier.auth)
        .expect(404);
    });

    it('lists products at or below their low-stock alert', async () => {
      const res = await t
        .http()
        .get('/products?lowStock=true&pageSize=100')
        .set(viewer.auth)
        .expect(200);
      const skus = res.body.items.map((p: { sku: string }) => p.sku);
      expect(skus).toContain('CON-PAPER-58');
      expect(skus).not.toContain('CON-PAPER-80');
    });

    it('creates and updates products with validation and audit', async () => {
      await t
        .http()
        .post('/products')
        .set(cashier.auth)
        .send({ sku: 'X', name: 'x' })
        .expect(403);
      await t
        .http()
        .post('/products')
        .set(manager.auth)
        .send({
          sku: `S-${uniq()}`,
          name: 'Install',
          type: 'SERVICE',
          trackSerial: true,
          retailPrice: 1,
        })
        .expect(400);

      const p = await newProduct({
        sku: `t-${uniq()}`,
        priceCurrency: 'USD',
        retailPrice: 99.99,
        costCurrency: 'USD',
        costPrice: 80,
        specs: { Size: '24"' },
      });
      expect(p.sku).toBe(p.sku.toUpperCase());
      expect(Number(p.avgCostLak)).toBeGreaterThan(0);
      await t
        .http()
        .post('/products')
        .set(manager.auth)
        .send({ sku: p.sku, name: 'dup', retailPrice: 1 })
        .expect(409);

      await t
        .http()
        .patch(`/products/${p.id}`)
        .set(manager.auth)
        .send({ retailPrice: 105, specs: null })
        .expect(200);
      const log = await t.prisma.auditLog.findFirst({
        where: { entityId: p.id, action: 'PRODUCT_PRICE_CHANGE' },
      });
      expect(log).not.toBeNull();
    });

    it('refuses to switch serial tracking while stock is on hand', async () => {
      const epson = await t.prisma.product.findUniqueOrThrow({
        where: { sku: 'PRN-EPSON-T82X' },
      });
      await t
        .http()
        .patch(`/products/${epson.id}`)
        .set(manager.auth)
        .send({ trackSerial: false })
        .expect(409);
    });

    it('changes prices in bulk by percentage and explicitly', async () => {
      const category = await newCategory();
      const lak = await newProduct({
        categoryId: category.id,
        retailPrice: 100_000,
        wholesalePrice: 90_000,
      });
      const usd = await newProduct({
        categoryId: category.id,
        priceCurrency: 'USD',
        retailPrice: 10,
      });

      const res = await t
        .http()
        .post('/products/bulk-price')
        .set(manager.auth)
        .send({ categoryId: category.id, percent: 7.5, field: 'both' })
        .expect(200);
      expect(res.body.updated).toBe(2);

      const after = await t.prisma.product.findMany({
        where: { categoryId: category.id },
      });
      const byId = Object.fromEntries(after.map((p) => [p.id, p]));
      expect(byId[lak.id].retailPrice.toString()).toBe('108000'); // 107,500 → up to 1,000
      expect(byId[lak.id].wholesalePrice!.toString()).toBe('97000'); // 96,750 → 97,000
      expect(byId[usd.id].retailPrice.toString()).toBe('10.75');

      await t
        .http()
        .put('/products/prices')
        .set(manager.auth)
        .send({
          items: [
            { productId: lak.id, retailPrice: 111_000, wholesalePrice: null },
          ],
        })
        .expect(200);
      const updated = await t.prisma.product.findUniqueOrThrow({
        where: { id: lak.id },
      });
      expect(updated).toMatchObject({ wholesalePrice: null });
      expect(updated.retailPrice.toString()).toBe('111000');
    });

    it('uploads, orders and deletes images', async () => {
      const p = await newProduct();
      await t
        .http()
        .post(`/products/${p.id}/images`)
        .set(manager.auth)
        .attach('file', Buffer.from('not an image'), {
          filename: 'a.txt',
          contentType: 'text/plain',
        })
        .expect(400);

      const first = (
        await t
          .http()
          .post(`/products/${p.id}/images`)
          .set(manager.auth)
          .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' })
          .expect(201)
      ).body;
      const second = (
        await t
          .http()
          .post(`/products/${p.id}/images`)
          .set(manager.auth)
          .attach('file', PNG, { filename: 'b.png', contentType: 'image/png' })
          .expect(201)
      ).body;
      expect(first.url).toMatch(/^\/api\/uploads\/products\/.+\.png$/);
      const file = path.join(
        process.env.UPLOAD_DIR!,
        first.url.replace('/api/uploads/', ''),
      );
      expect(existsSync(file)).toBe(true);

      const ordered = await t
        .http()
        .put(`/products/${p.id}/images/order`)
        .set(manager.auth)
        .send({ imageIds: [second.id, first.id] })
        .expect(200);
      expect(ordered.body.map((i: { id: string }) => i.id)).toEqual([
        second.id,
        first.id,
      ]);

      await t
        .http()
        .delete(`/products/${p.id}/images/${first.id}`)
        .set(manager.auth)
        .expect(204);
      expect(existsSync(file)).toBe(false);
    });
  });
});
