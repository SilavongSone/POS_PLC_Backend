import { createTestApp, type TestApp } from './helpers.js';

describe('HTTP security and limits (e2e)', () => {
  let t: TestApp;
  let auth: { Authorization: string };

  beforeAll(async () => {
    t = await createTestApp();
    auth = (await t.userWith('Manager')).auth;
  });
  afterAll(() => t.close());

  it('sends security headers and hides the framework', async () => {
    const res = await t.http().get('/health').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('reports health without a login', async () => {
    const res = await t.http().get('/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'up' });
  });

  it('only allows configured browser origins', async () => {
    const allowed = await t
      .http()
      .get('/health')
      .set('Origin', 'http://localhost:3000');
    expect(allowed.headers['access-control-allow-origin']).toBe(
      'http://localhost:3000',
    );
    const other = await t
      .http()
      .get('/health')
      .set('Origin', 'https://evil.example');
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects oversized JSON bodies', async () => {
    const huge = { username: 'x', password: 'y'.repeat(1_100_000) };
    await t.http().post('/auth/login').send(huge).expect(413);
  });

  it('compresses large responses', async () => {
    const res = await t
      .http()
      .get('/products?pageSize=100')
      .set(auth)
      .set('Accept-Encoding', 'gzip')
      .expect(200);
    expect(res.headers['content-encoding']).toBe('gzip');
  });

  it('caps page sizes', async () => {
    await t.http().get('/products?pageSize=101').set(auth).expect(400);
  });

  it('rate-limits credential endpoints per client', async () => {
    const previous = process.env.THROTTLE_AUTH_LIMIT;
    process.env.THROTTLE_AUTH_LIMIT = '5';
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 8; i++) {
        const res = await t
          .http()
          .post('/auth/login')
          .send({ username: 'nobody', password: 'wrong' });
        statuses.push(res.status);
        if (res.status === 429) {
          expect(res.headers['retry-after']).toBeDefined();
          break;
        }
      }
      // Earlier logins in this file count too, so at most 5 get through.
      expect(statuses.at(-1)).toBe(429);
      expect(statuses.filter((s) => s === 401).length).toBeLessThanOrEqual(5);
    } finally {
      process.env.THROTTLE_AUTH_LIMIT = previous;
    }
  });
});
