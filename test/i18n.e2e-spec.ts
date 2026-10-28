import { createTestApp, type TestApp } from './helpers.js';

describe('Languages (e2e)', () => {
  let t: TestApp;
  let manager: Awaited<ReturnType<TestApp['userWith']>>;
  const uniq = () =>
    Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const missing = '00000000-0000-4000-8000-000000000000';

  beforeAll(async () => {
    t = await createTestApp();
    manager = await t.userWith('Manager');
  });
  afterAll(() => t.close());

  it('returns a stable code, a message in the request language and the request id', async () => {
    const res = await t
      .http()
      .get(`/products/${missing}`)
      .set(manager.auth)
      .set('Accept-Language', 'th-TH,th;q=0.9,en;q=0.8')
      .set('X-Request-Id', 'req-test-12345')
      .expect(404);
    expect(res.body).toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'ไม่พบข้อมูล',
      requestId: 'req-test-12345',
    });
    expect(res.headers['x-request-id']).toBe('req-test-12345');

    const lao = await t.http().get(`/products/${missing}`).set(manager.auth);
    expect(lao.body.message).toBe('ບໍ່ພົບຂໍ້ມູນ');
    expect(lao.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);

    const en = await t
      .http()
      .get(`/products/${missing}?lang=en`)
      .set(manager.auth)
      .set('Accept-Language', 'th');
    expect(en.body.message).toBe('Not found');
  });

  it('translates validation errors and keeps their paths', async () => {
    const res = await t
      .http()
      .post('/brands')
      .set(manager.auth)
      .set('Accept-Language', 'en')
      .send({ name: '' })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.errors).toEqual([
      { path: 'name', code: 'too_small', message: 'Too small (minimum 1)' },
    ]);
  });

  it('shows names in the reader’s language and keeps every translation for editing', async () => {
    const created = (
      await t
        .http()
        .post('/products')
        .set(manager.auth)
        .send({
          sku: `I18N-${uniq()}`,
          name: 'ເຄື່ອງພິມໃບບິນ',
          nameI18n: { th: 'เครื่องพิมพ์ใบเสร็จ', en: 'Receipt printer' },
          retailPrice: 100_000,
        })
        .expect(201)
    ).body;
    const get = (lang?: string) => {
      const req = t.http().get(`/products/${created.id}`).set(manager.auth);
      return lang ? req.set('Accept-Language', lang) : req;
    };
    expect((await get()).body.name).toBe('ເຄື່ອງພິມໃບບິນ');
    const th = (await get('th')).body;
    expect(th.name).toBe('เครื่องพิมพ์ใบเสร็จ');
    expect(th.nameI18n).toEqual({
      th: 'เครื่องพิมพ์ใบเสร็จ',
      en: 'Receipt printer',
    });

    // A user's own language beats the browser's; ?lang beats both.
    await t
      .http()
      .patch('/auth/me')
      .set(manager.auth)
      .send({ language: 'en' })
      .expect(200);
    expect((await get('th')).body.name).toBe('Receipt printer');
    const q = await t
      .http()
      .get(`/products/${created.id}?lang=th`)
      .set(manager.auth);
    expect(q.body.name).toBe('เครื่องพิมพ์ใบเสร็จ');
    const list = await t
      .http()
      .get(`/products?q=${created.sku}`)
      .set(manager.auth);
    expect(list.body.items[0].name).toBe('Receipt printer');
  });
});
