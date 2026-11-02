import { createTestApp, type TestApp } from './helpers.js';

describe('Platform settings (e2e)', () => {
  let t: TestApp;
  let platform: { Authorization: string };

  beforeAll(async () => {
    t = await createTestApp();
    const res = await t
      .http()
      .post('/platform/auth/login')
      .send({ email: 'platform@test.local', password: 'platform-password-1' })
      .expect(200);
    platform = { Authorization: `Bearer ${res.body.accessToken as string}` };
  });
  afterAll(async () => {
    // Other files expect sign-up open (SIGNUP_ENABLED=true in the e2e env).
    await t
      .http()
      .patch('/platform/settings')
      .set(platform)
      .send({ signupEnabled: true });
    await t.close();
  });

  const signup = () =>
    t
      .http()
      .post('/public/signup')
      .send({
        name: 'Switch Test Shop',
        email: `switch-${Date.now()}@example.com`,
        owner: { password: 'owner-password-1' },
      });

  it('opens and closes self-service sign-up without a restart', async () => {
    const start = await t
      .http()
      .get('/platform/settings')
      .set(platform)
      .expect(200);
    expect(start.body.signupEnabled).toBe(true);

    const closed = await t
      .http()
      .patch('/platform/settings')
      .set(platform)
      .send({ signupEnabled: false })
      .expect(200);
    expect(closed.body).toMatchObject({
      signupEnabled: false,
      signupEnabledSource: 'setting',
    });
    await t.http().get('/public/signup/status').expect(200, { open: false });
    const refused = await signup().expect(403);
    expect(refused.body.code).toBe('SIGNUP_DISABLED');

    await t
      .http()
      .patch('/platform/settings')
      .set(platform)
      .send({ signupEnabled: true })
      .expect(200);
    await t.http().get('/public/signup/status').expect(200, { open: true });
    await signup().expect(201);
  });

  it('needs a platform token to change it', async () => {
    await t
      .http()
      .patch('/platform/settings')
      .send({ signupEnabled: false })
      .expect(401);
    await t
      .http()
      .patch('/platform/settings')
      .set(platform)
      .send({ signupEnabled: 'yes' })
      .expect(400);
  });
});
