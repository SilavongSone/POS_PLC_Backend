import { RequestContext } from '../src/common/request-context.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, type TestApp } from './helpers.js';

type Store = { id: string; code: string; auth: { Authorization: string } };

/**
 * Separate stores (POST /stores): a new company with a one-time copy of the catalog, owned
 * by the same confirmed e-mail, switchable without the password, never sharing data.
 */
describe('Independent stores (e2e)', () => {
  let t: TestApp;
  let platform: { Authorization: string };
  const uniq = () =>
    Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const PASSWORD = 'owner-password-1';

  const base = () => t.app.get(PrismaService);
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function company(email: string, verified = true): Promise<Store> {
    const code = `st-${uniq()}`;
    const res = await t
      .http()
      .post('/platform/tenants')
      .set(platform)
      .send({
        code,
        name: `Store ${code}`,
        planCode: 'BUSINESS',
        status: 'ACTIVE',
        owner: {
          username: 'owner',
          fullName: 'Owner',
          password: PASSWORD,
          email,
        },
      })
      .expect(201);
    const id = res.body.tenant.id as string;
    await RequestContext.asPlatform(() =>
      base().user.updateMany({
        where: { tenantId: id, username: 'owner' },
        data: { emailVerifiedAt: verified ? new Date() : null },
      }),
    );
    const login = await t
      .http()
      .post('/auth/login')
      .send({ tenantCode: code, username: 'owner', password: PASSWORD })
      .expect(200);
    return { id, code, auth: bearer(login.body.accessToken as string) };
  }

  beforeAll(async () => {
    t = await createTestApp();
    const res = await t
      .http()
      .post('/platform/auth/login')
      .send({ email: 'platform@test.local', password: 'platform-password-1' })
      .expect(200);
    platform = bearer(res.body.accessToken as string);
  });
  afterAll(() => t.close());

  it('is created by the Super Admin only', async () => {
    const shop = await company(`a-${uniq()}@test.local`);
    // Shop users have no way to create one.
    await t
      .http()
      .post('/stores')
      .set(shop.auth)
      .send({ name: 'Second shop' })
      .expect(404);
    await t
      .http()
      .post(`/platform/tenants/${shop.id}/stores`)
      .set(shop.auth)
      .send({ name: 'Second shop' })
      .expect(401);
  });

  it('creates a store for an owner without a confirmed e-mail, but no switching', async () => {
    const shop = await company(`u-${uniq()}@test.local`, false);
    const created = await t
      .http()
      .post(`/platform/tenants/${shop.id}/stores`)
      .set(platform)
      .send({ name: 'Unconfirmed owner shop', copy: { catalog: false } })
      .expect(201);
    expect(created.body).toMatchObject({
      ownerCanSwitch: false,
      owner: { username: 'owner' },
    });
    const listed = (await t.http().get('/stores').set(shop.auth).expect(200))
      .body as { code: string }[];
    expect(listed.map((s) => s.code)).toEqual([shop.code]);
    // The owner can still sign in to the new store with the same password.
    await t
      .http()
      .post('/auth/login')
      .send({
        tenantCode: created.body.code,
        username: 'owner',
        password: PASSWORD,
      })
      .expect(200);
  });

  it('copies the catalog once and keeps the stores apart', async () => {
    const email = `o-${uniq()}@test.local`;
    const shop = await company(email);
    const http = t.http();
    const category = (
      await http
        .post('/categories')
        .set(shop.auth)
        .send({ name: `Cat ${uniq()}` })
        .expect(201)
    ).body as { id: string };
    const brand = (
      await http
        .post('/brands')
        .set(shop.auth)
        .send({ name: `Brand ${uniq()}`, categoryIds: [category.id] })
        .expect(201)
    ).body as { id: string };
    const product = (
      await http
        .post('/products')
        .set(shop.auth)
        .send({
          sku: 'COPY-1',
          barcode: '8850000000011',
          name: 'Copied printer',
          retailPrice: 1_500_000,
          costPrice: 1_000_000,
          categoryId: category.id,
          brandId: brand.id,
        })
        .expect(201)
    ).body as { id: string };
    await http
      .put(`/products/${product.id}/units`)
      .set(shop.auth)
      .send({ items: [{ unit: 'box', factor: 10, retailPrice: 14_000_000 }] })
      .expect(200);
    await http
      .post('/customers')
      .set(shop.auth)
      .send({ name: 'Only here', phone: `020${Date.now() % 1e8}` })
      .expect(201);

    const created = await http
      .post(`/platform/tenants/${shop.id}/stores`)
      .set(platform)
      .send({ name: 'Second shop', branchName: 'Vientiane 2' })
      .expect(201);
    expect(created.body.ownerCanSwitch).toBe(true);
    expect(created.body.copied).toMatchObject({ products: 1, customers: 0 });
    const code = created.body.code as string;
    expect(code).not.toBe(shop.code);

    const stores = (await http.get('/stores').set(shop.auth).expect(200))
      .body as { code: string; current: boolean }[];
    expect(stores.map((s) => s.code)).toEqual(
      expect.arrayContaining([shop.code, code]),
    );
    expect(stores.find((s) => s.current)?.code).toBe(shop.code);

    const switched = await http
      .post('/stores/switch')
      .set(shop.auth)
      .send({ tenantCode: code })
      .expect(200);
    expect(switched.body.tenantCode).toBe(code);
    const second = bearer(switched.body.accessToken as string);

    // The copy: same SKU and price, new id, no stock, packs kept; no customers.
    const list = (await http.get('/products?q=COPY-1').set(second).expect(200))
      .body as { items: { id: string; sku: string; stockQty: number }[] };
    expect(list.items).toHaveLength(1);
    const copy = list.items[0];
    expect(copy.id).not.toBe(product.id);
    expect(copy.stockQty).toBe(0);
    const detail = (
      await http.get(`/products/${copy.id}`).set(second).expect(200)
    ).body as {
      retailPrice: string;
      units: { factor: number }[];
      brand: { id: string } | null;
    };
    expect(Number(detail.retailPrice)).toBe(1_500_000);
    expect(detail.units.map((u) => u.factor)).toEqual([10]);
    expect(detail.brand?.id).not.toBe(brand.id);
    const customers = (
      await http.get('/customers?q=Only here').set(second).expect(200)
    ).body as { items: unknown[] };
    expect(customers.items).toHaveLength(0);
    const branches = (await http.get('/branches').set(second).expect(200))
      .body as {
      name: string;
    }[];
    expect(branches.map((b) => b.name)).toEqual(['Vientiane 2']);

    // Separate from now on: edits and deletes stay in their store.
    await http
      .patch(`/products/${copy.id}`)
      .set(second)
      .send({ retailPrice: 1_700_000 })
      .expect(200);
    const original = (
      await http.get(`/products/${product.id}`).set(shop.auth).expect(200)
    ).body as { retailPrice: string };
    expect(Number(original.retailPrice)).toBe(1_500_000);
    await http.get(`/products/${copy.id}`).set(shop.auth).expect(404);
    await http.get(`/products/${product.id}`).set(second).expect(404);
    await http.delete(`/products/${copy.id}`).set(second).expect(204);
    await http.get(`/products/${product.id}`).set(shop.auth).expect(200);

    // And back again.
    const back = await http
      .post('/stores/switch')
      .set(second)
      .send({ tenantCode: shop.code })
      .expect(200);
    expect(back.body.tenantCode).toBe(shop.code);
  });

  it('copies customers when asked', async () => {
    const shop = await company(`c-${uniq()}@test.local`);
    await t
      .http()
      .post('/customers')
      .set(shop.auth)
      .send({ name: 'Regular', phone: `021${Date.now() % 1e8}` })
      .expect(201);
    const created = await t
      .http()
      .post(`/platform/tenants/${shop.id}/stores`)
      .set(platform)
      .send({
        name: 'Copy with customers',
        planCode: 'STARTER',
        status: 'ACTIVE',
        copy: { catalog: false, customers: true },
      })
      .expect(201);
    expect(created.body.copied).toMatchObject({ customers: 1, products: 0 });
    const plan = await RequestContext.asPlatform(() =>
      base().subscription.findFirst({
        where: { tenant: { code: created.body.code as string } },
        select: { status: true, plan: { select: { code: true } } },
      }),
    );
    expect(plan).toMatchObject({ status: 'ACTIVE', plan: { code: 'STARTER' } });
  });

  it('switches only to stores of the same confirmed e-mail', async () => {
    const mine = await company(`m-${uniq()}@test.local`);
    const other = await company(`x-${uniq()}@test.local`);
    const res = await t
      .http()
      .post('/stores/switch')
      .set(mine.auth)
      .send({ tenantCode: other.code })
      .expect(403);
    expect(res.body.code).toBe('STORE_NOT_YOURS');

    // Same address but never confirmed there: not a way in either.
    const email = `s-${uniq()}@test.local`;
    const a = await company(email);
    const b = await company(email, false);
    await t
      .http()
      .post('/stores/switch')
      .set(a.auth)
      .send({ tenantCode: b.code })
      .expect(403);
    const listed = (await t.http().get('/stores').set(a.auth).expect(200))
      .body as {
      code: string;
    }[];
    expect(listed.map((s) => s.code)).toEqual([a.code]);
  });
});
