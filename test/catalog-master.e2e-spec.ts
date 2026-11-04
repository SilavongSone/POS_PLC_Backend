import { createTestApp, type TestApp } from './helpers.js';

type User = Awaited<ReturnType<TestApp['userWith']>>;

describe('Catalog master data (e2e)', () => {
  let t: TestApp;
  let manager: User;
  let cashier: User;
  const uniq = () =>
    Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  beforeAll(async () => {
    t = await createTestApp();
    [manager, cashier] = await Promise.all([
      t.userWith('Manager'),
      t.userWith('Cashier'),
    ]);
  });
  afterAll(() => t.close());

  async function newCategory(parentId?: string) {
    return (
      await t
        .http()
        .post('/categories')
        .set(manager.auth)
        .send({ name: `Cat ${uniq()}`, ...(parentId && { parentId }) })
        .expect(201)
    ).body as { id: string };
  }

  async function newBrand(categoryIds?: string[]) {
    return (
      await t
        .http()
        .post('/brands')
        .set(manager.auth)
        .send({ name: `Brand ${uniq()}`, categoryIds })
        .expect(201)
    ).body as { id: string };
  }

  async function brandsOf(categoryId?: string) {
    const res = await t
      .http()
      .get('/brands')
      .query(categoryId ? { categoryId } : {})
      .set(cashier.auth)
      .expect(200);
    return res.body as { id: string; categoryIds: string[] }[];
  }

  describe('order', () => {
    it('adds new categories at the end of their level and reorders them', async () => {
      const parent = await newCategory();
      const a = await newCategory(parent.id);
      const b = await newCategory(parent.id);
      const c = await newCategory(parent.id);
      const children = async () =>
        (
          (await t.http().get('/categories').set(cashier.auth).expect(200))
            .body as { id: string; parentId: string | null }[]
        )
          .filter((x) => x.parentId === parent.id)
          .map((x) => x.id);
      expect(await children()).toEqual([a.id, b.id, c.id]);

      await t
        .http()
        .put('/categories/order')
        .set(manager.auth)
        .send({ ids: [c.id, a.id, b.id] })
        .expect(204);
      expect(await children()).toEqual([c.id, a.id, b.id]);

      await t
        .http()
        .put('/categories/order')
        .set(manager.auth)
        .send({ ids: [a.id, '00000000-0000-4000-8000-000000000000'] })
        .expect(404);
      await t
        .http()
        .put('/categories/order')
        .set(cashier.auth)
        .send({ ids: [a.id] })
        .expect(403);
    });

    it('reorders units', async () => {
      const units = (await t.http().get('/units').set(cashier.auth).expect(200))
        .body as { id: string }[];
      const ids = units.map((u) => u.id);
      const reversed = [...ids].reverse();
      await t
        .http()
        .put('/units/order')
        .set(manager.auth)
        .send({ ids: reversed })
        .expect(204);
      const after = (await t.http().get('/units').set(cashier.auth).expect(200))
        .body as { id: string }[];
      expect(after.map((u) => u.id)).toEqual(reversed);
      // Put the shared test company back in its usual order.
      await t
        .http()
        .put('/units/order')
        .set(manager.auth)
        .send({ ids })
        .expect(204);
    });
  });

  describe('units', () => {
    it('lists the standard units', async () => {
      const units = (await t.http().get('/units').set(cashier.auth).expect(200))
        .body as { code: string }[];
      expect(units.map((u) => u.code)).toEqual(
        expect.arrayContaining(['pcs', 'set', 'box', 'roll']),
      );
    });

    it('creates, rejects duplicates, renames on products and blocks delete in use', async () => {
      const name = `u${uniq()}`.slice(0, 12);
      const unit = (
        await t
          .http()
          .post('/units')
          .set(manager.auth)
          .send({ name, nameI18n: { lo: 'ທົດສອບ', en: 'test' } })
          .expect(201)
      ).body as { id: string };
      const dup = await t
        .http()
        .post('/units')
        .set(manager.auth)
        .send({ name })
        .expect(409);
      expect(dup.body.code).toBe('UNIT_EXISTS');

      const product = (
        await t
          .http()
          .post('/products')
          .set(manager.auth)
          .send({
            sku: `U-${uniq()}`,
            name: 'Unit test',
            retailPrice: 1000,
            unit: name,
          })
          .expect(201)
      ).body as { id: string };

      const renamed = `r${uniq()}`.slice(0, 12);
      await t
        .http()
        .patch(`/units/${unit.id}`)
        .set(manager.auth)
        .send({ name: renamed })
        .expect(200);
      const after = await t
        .http()
        .get(`/products/${product.id}`)
        .set(manager.auth)
        .expect(200);
      expect(after.body.unit).toBe(renamed);

      const list = (await t.http().get('/units').set(manager.auth).expect(200))
        .body as { id: string; productCount: number }[];
      expect(list.find((u) => u.id === unit.id)?.productCount).toBe(1);

      const blocked = await t
        .http()
        .delete(`/units/${unit.id}`)
        .set(manager.auth)
        .expect(409);
      expect(blocked.body.code).toBe('UNIT_IN_USE');
    });

    it('adds a unit a product is saved with, and deletes an unused one', async () => {
      const name = `n${uniq()}`.slice(0, 12);
      await t
        .http()
        .post('/products')
        .set(manager.auth)
        .send({
          sku: `N-${uniq()}`,
          name: 'New unit',
          retailPrice: 1000,
          unit: name,
        })
        .expect(201);
      const units = (await t.http().get('/units').set(manager.auth).expect(200))
        .body as { name: string }[];
      expect(units.map((u) => u.name)).toContain(name);

      const spare = (
        await t
          .http()
          .post('/units')
          .set(manager.auth)
          .send({ name: `s${uniq()}`.slice(0, 12) })
          .expect(201)
      ).body as { id: string };
      await t.http().delete(`/units/${spare.id}`).set(manager.auth).expect(204);
    });

    it('needs product.manage to change', async () => {
      await t
        .http()
        .post('/units')
        .set(cashier.auth)
        .send({ name: 'x' })
        .expect(403);
    });
  });

  describe('brands by category', () => {
    it('lists brands of a category, including those linked to a parent', async () => {
      const parent = await newCategory();
      const child = await newCategory(parent.id);
      const other = await newCategory();
      const parentBrand = await newBrand([parent.id]);
      const childBrand = await newBrand([child.id]);
      const otherBrand = await newBrand([other.id]);

      const ofChild = (await brandsOf(child.id)).map((b) => b.id);
      expect(ofChild).toEqual(
        expect.arrayContaining([parentBrand.id, childBrand.id]),
      );
      expect(ofChild).not.toContain(otherBrand.id);

      const ofParent = (await brandsOf(parent.id)).map((b) => b.id);
      expect(ofParent).toContain(parentBrand.id);
      expect(ofParent).not.toContain(childBrand.id);
    });

    it('replaces the category list on update and rejects unknown ids', async () => {
      const a = await newCategory();
      const b = await newCategory();
      const brand = await newBrand([a.id]);
      await t
        .http()
        .patch(`/brands/${brand.id}`)
        .set(manager.auth)
        .send({ categoryIds: [b.id, b.id] })
        .expect(200);
      const row = (await brandsOf()).find((x) => x.id === brand.id);
      expect(row?.categoryIds).toEqual([b.id]);

      await t
        .http()
        .post('/brands')
        .set(manager.auth)
        .send({
          name: `Bad ${uniq()}`,
          categoryIds: ['00000000-0000-4000-8000-000000000000'],
        })
        .expect(400);
    });

    it('links a brand to the category of a product saved with it', async () => {
      const parent = await newCategory();
      const child = await newCategory(parent.id);
      const other = await newCategory();
      const brand = await newBrand([parent.id]);

      // Already covered through the parent: no extra link.
      await t
        .http()
        .post('/products')
        .set(manager.auth)
        .send({
          sku: `B-${uniq()}`,
          name: 'Linked',
          retailPrice: 1000,
          brandId: brand.id,
          categoryId: child.id,
        })
        .expect(201);
      let row = (await brandsOf()).find((x) => x.id === brand.id);
      expect(row?.categoryIds).toEqual([parent.id]);

      const product = (
        await t
          .http()
          .post('/products')
          .set(manager.auth)
          .send({
            sku: `B-${uniq()}`,
            name: 'Moved',
            retailPrice: 1000,
            brandId: brand.id,
          })
          .expect(201)
      ).body as { id: string };
      await t
        .http()
        .patch(`/products/${product.id}`)
        .set(manager.auth)
        .send({ categoryId: other.id })
        .expect(200);
      row = (await brandsOf()).find((x) => x.id === brand.id);
      expect(row?.categoryIds).toEqual(
        expect.arrayContaining([parent.id, other.id]),
      );
    });
  });

  describe('label templates', () => {
    const elements = [
      { id: 'name', type: 'name', x: 1, y: 1, w: 38, h: 6, fontSize: 8 },
      { id: 'bc', type: 'barcode', x: 1, y: 8, w: 38, h: 12 },
      { id: 'side', type: 'barcode', x: 30, y: 8, w: 8, h: 20, rotation: 90 },
      { id: 'price', type: 'price', x: 20, y: 22, w: 19, h: 6, bold: true },
    ];

    it('creates, keeps one default, rejects duplicate names and deletes', async () => {
      const name = `Roll ${uniq()}`;
      const first = (
        await t
          .http()
          .post('/label-templates')
          .set(manager.auth)
          .send({ name, widthMm: 40, heightMm: 30, elements, isDefault: true })
          .expect(201)
      ).body as {
        id: string;
        columns: number;
        elements: { align: string; rotation: number }[];
      };
      expect(first.columns).toBe(1);
      expect(first.elements[0]).toMatchObject({ align: 'left', rotation: 0 });
      expect(first.elements[2].rotation).toBe(90);

      const dup = await t
        .http()
        .post('/label-templates')
        .set(manager.auth)
        .send({ name, widthMm: 40, heightMm: 30, elements: [] })
        .expect(409);
      expect(dup.body.code).toBe('LABEL_TEMPLATE_EXISTS');

      const second = (
        await t
          .http()
          .post('/label-templates')
          .set(manager.auth)
          .send({
            name: `3-up ${uniq()}`,
            widthMm: 32.04,
            heightMm: 25,
            columns: 3,
            elements,
            isDefault: true,
          })
          .expect(201)
      ).body as { id: string; widthMm: number };
      expect(second.widthMm).toBe(32);

      const list = (
        await t.http().get('/label-templates').set(cashier.auth).expect(200)
      ).body as { id: string; isDefault: boolean }[];
      expect(list.filter((x) => x.isDefault).map((x) => x.id)).toEqual([
        second.id,
      ]);

      await t
        .http()
        .patch(`/label-templates/${first.id}`)
        .set(manager.auth)
        .send({ columns: 2, gapMm: 3 })
        .expect(200);
      await t
        .http()
        .delete(`/label-templates/${second.id}`)
        .set(manager.auth)
        .expect(204);
    });

    it('validates the layout and needs product.manage', async () => {
      await t
        .http()
        .post('/label-templates')
        .set(manager.auth)
        .send({
          name: `Bad ${uniq()}`,
          widthMm: 40,
          heightMm: 30,
          elements: [elements[0], elements[0]],
        })
        .expect(400);
      await t
        .http()
        .post('/label-templates')
        .set(manager.auth)
        .send({
          name: `Tilted ${uniq()}`,
          widthMm: 40,
          heightMm: 30,
          elements: [{ ...elements[1], rotation: 45 }],
        })
        .expect(400);
      await t
        .http()
        .post('/label-templates')
        .set(cashier.auth)
        .send({ name: 'x', widthMm: 40, heightMm: 30, elements: [] })
        .expect(403);
    });
  });

  describe('product groups (versions of a model)', () => {
    async function newProduct(body: object = {}) {
      return (
        await t
          .http()
          .post('/products')
          .set(manager.auth)
          .send({
            sku: `GV-${uniq()}`,
            name: `Model ${uniq()}`,
            retailPrice: 850_000,
            ...body,
          })
          .expect(201)
      ).body as { id: string; sku: string };
    }

    it('groups products, adds a copied version, renames and ungroups', async () => {
      const category = await newCategory();
      const wifi = await newProduct({
        categoryId: category.id,
        warrantyMonths: 12,
      });
      const lan = await newProduct({ warrantyMonths: 6 });
      const created = (
        await t
          .http()
          .post('/product-groups')
          .set(manager.auth)
          .send({
            name: 'Xprinter XP-T80Q',
            optionName: 'Version',
            products: [
              { productId: wifi.id, value: 'USB+WiFi' },
              { productId: lan.id, value: 'USB+LAN' },
            ],
            newVariants: [{ value: 'USB+Bluetooth', retailPrice: 900_000 }],
          })
          .expect(201)
      ).body as {
        id: string;
        products: {
          id: string;
          name: string;
          sku: string;
          variantValue: string;
          retailPriceLak: string;
        }[];
      };
      expect(created.products.map((p) => p.name)).toEqual([
        'Xprinter XP-T80Q (USB+WiFi)',
        'Xprinter XP-T80Q (USB+LAN)',
        'Xprinter XP-T80Q (USB+Bluetooth)',
      ]);
      const bt = created.products[2];
      expect(bt.sku).toBe(`${wifi.sku}-USB-BLUETOOTH`);
      expect(bt.retailPriceLak).toBe('900000');

      // The first product gave its category and warranty to every version.
      const lanRow = await t.prisma.product.findUniqueOrThrow({
        where: { id: lan.id },
      });
      expect(lanRow).toMatchObject({
        categoryId: category.id,
        warrantyMonths: 12,
      });

      // Editing one version's shared fields updates the others; its name stays the model's.
      await t
        .http()
        .patch(`/products/${lan.id}`)
        .set(manager.auth)
        .send({
          warrantyMonths: 24,
          name: 'Renamed by hand',
          retailPrice: 820_000,
        })
        .expect(200);
      const rows = await t.prisma.product.findMany({
        where: { groupId: created.id },
      });
      expect(rows.map((r) => r.warrantyMonths)).toEqual([24, 24, 24]);
      expect(rows.find((r) => r.id === lan.id)).toMatchObject({
        name: 'Xprinter XP-T80Q (USB+LAN)',
      });
      expect(rows.find((r) => r.id === wifi.id)!.retailPrice.toString()).toBe(
        '850000',
      );

      // Duplicate versions are refused; renaming the model renames every version.
      const dup = await t
        .http()
        .post(`/product-groups/${created.id}/variants`)
        .set(manager.auth)
        .send({ value: 'usb+lan' })
        .expect(409);
      expect(dup.body).toMatchObject({
        code: 'VARIANT_EXISTS',
        field: 'value',
      });
      const renamed = (
        await t
          .http()
          .patch(`/product-groups/${created.id}`)
          .set(manager.auth)
          .send({
            name: 'XP-T80Q',
            variants: [
              { productId: lan.id, value: 'LAN' },
              { productId: wifi.id, value: 'WiFi' },
            ],
          })
          .expect(200)
      ).body as { products: { name: string }[] };
      expect(renamed.products.map((p) => p.name)).toEqual([
        'XP-T80Q (LAN)',
        'XP-T80Q (WiFi)',
        'XP-T80Q (USB+Bluetooth)',
      ]);

      // A product of a model cannot join another one.
      const other = await newProduct();
      const taken = await t
        .http()
        .post('/product-groups')
        .set(manager.auth)
        .send({
          name: 'Other',
          optionName: 'Size',
          products: [
            { productId: other.id, value: 'A' },
            { productId: wifi.id, value: 'B' },
          ],
        })
        .expect(409);
      expect(taken.body.code).toBe('PRODUCT_IN_GROUP');

      // The list shows the model on each version; ungrouping keeps the products.
      const list = (
        await t
          .http()
          .get('/products')
          .query({ groupId: created.id })
          .set(cashier.auth)
          .expect(200)
      ).body as { items: { group: { name: string } | null }[] };
      expect(list.items).toHaveLength(3);
      expect(list.items[0].group?.name).toBe('XP-T80Q');
      await t
        .http()
        .delete(`/product-groups/${created.id}`)
        .set(manager.auth)
        .expect(204);
      const after = await t.prisma.product.findUniqueOrThrow({
        where: { id: wifi.id },
      });
      expect(after).toMatchObject({ groupId: null, name: 'XP-T80Q (WiFi)' });

      await t
        .http()
        .post('/product-groups')
        .set(cashier.auth)
        .send({
          name: 'x',
          optionName: 'y',
          products: [{ productId: other.id, value: 'A' }],
        })
        .expect(403);
    });
  });
});
