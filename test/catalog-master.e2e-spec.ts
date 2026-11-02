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
});
