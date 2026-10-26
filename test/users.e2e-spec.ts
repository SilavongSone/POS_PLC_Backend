import { TEST_PASSWORD, createTestApp, type TestApp } from './helpers.js';

describe('Users and groups (e2e)', () => {
  let t: TestApp;
  let admin: Awaited<ReturnType<TestApp['userWith']>>;
  let cashierGroupId: string;
  const uniq = () =>
    `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  beforeAll(async () => {
    t = await createTestApp();
    admin = await t.userWith('Admin');
    cashierGroupId = (
      await t.prisma.userGroup.findUniqueOrThrow({ where: { name: 'Cashier' } })
    ).id;
  });
  afterAll(() => t.close());

  const createUser = (username = uniq()) =>
    t
      .http()
      .post('/users')
      .set(admin.auth)
      .send({
        username,
        fullName: 'New Cashier',
        password: 'password-123',
        groupId: cashierGroupId,
      });

  it('requires users.manage', async () => {
    const manager = await t.userWith('Manager');
    await t.http().get('/users').set(manager.auth).expect(403);
    await t.http().get('/user-groups').set(manager.auth).expect(403);
  });

  it('creates a user without exposing hashes, and rejects duplicates', async () => {
    const username = uniq();
    const res = await createUser(username).expect(201);
    expect(res.body).toMatchObject({
      username,
      isActive: true,
      hasPin: false,
      group: { name: 'Cashier' },
    });
    expect(res.body).not.toHaveProperty('passwordHash');
    expect(res.body).not.toHaveProperty('pinHash');

    await createUser(username).expect(409);
    await t
      .http()
      .post('/users')
      .set(admin.auth)
      .send({ username: 'x', fullName: '', password: 'short', groupId: 'nope' })
      .expect(400);
  });

  it('lists and searches users with pagination', async () => {
    const username = uniq();
    await createUser(username).expect(201);
    const res = await t
      .http()
      .get('/users')
      .query({ q: username, pageSize: 5 })
      .set(admin.auth)
      .expect(200);
    expect(res.body).toMatchObject({ total: 1, page: 1, pageSize: 5 });
    expect(res.body.items[0].username).toBe(username);
  });

  it('deactivates a user and signs them out', async () => {
    const created = (await createUser().expect(201)).body;
    const login = await t
      .http()
      .post('/auth/login')
      .send({ username: created.username, password: 'password-123' })
      .expect(200);

    await t
      .http()
      .patch(`/users/${created.id}`)
      .set(admin.auth)
      .send({ isActive: false })
      .expect(200);
    await t
      .http()
      .post('/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(401);
  });

  it('resets password, sets PIN and unlocks', async () => {
    const created = (await createUser().expect(201)).body;
    await t
      .http()
      .post(`/users/${created.id}/reset-password`)
      .set(admin.auth)
      .send({ newPassword: 'another-pass-9' })
      .expect(204);
    await t
      .http()
      .post('/auth/login')
      .send({ username: created.username, password: 'another-pass-9' })
      .expect(200);

    await t
      .http()
      .put(`/users/${created.id}/pin`)
      .set(admin.auth)
      .send({ pin: '4321' })
      .expect(204);
    await t
      .http()
      .post('/auth/pin-login')
      .send({ username: created.username, pin: '4321' })
      .expect(200);

    await t.prisma.user.update({
      where: { id: created.id },
      data: { lockedUntil: new Date(Date.now() + 60_000), failedLoginCount: 0 },
    });
    const unlocked = await t
      .http()
      .post(`/users/${created.id}/unlock`)
      .set(admin.auth)
      .expect(200);
    expect(unlocked.body.lockedUntil).toBeNull();

    await t
      .http()
      .delete(`/users/${created.id}/pin`)
      .set(admin.auth)
      .expect(204);
    expect(
      (await t.http().get(`/users/${created.id}`).set(admin.auth)).body.hasPin,
    ).toBe(false);
  });

  it('does not let an admin deactivate themselves', async () => {
    await t
      .http()
      .patch(`/users/${admin.id}`)
      .set(admin.auth)
      .send({ isActive: false })
      .expect(400);
  });

  it('manages custom groups and validates permission codes', async () => {
    const name = `Technician ${uniq()}`;
    await t
      .http()
      .post('/user-groups')
      .set(admin.auth)
      .send({ name, permissions: ['repair.manage', 'not.a.permission'] })
      .expect(400);

    const group = (
      await t
        .http()
        .post('/user-groups')
        .set(admin.auth)
        .send({
          name,
          permissions: ['repair.manage', 'repair.manage', 'catalog.view'],
        })
        .expect(201)
    ).body;
    expect(group.permissions).toEqual(['repair.manage', 'catalog.view']);

    const user = (
      await t
        .http()
        .post('/users')
        .set(admin.auth)
        .send({
          username: uniq(),
          fullName: 'Tech',
          password: TEST_PASSWORD,
          groupId: group.id,
        })
        .expect(201)
    ).body;
    await t
      .http()
      .delete(`/user-groups/${group.id}`)
      .set(admin.auth)
      .expect(409);

    await t
      .http()
      .patch(`/users/${user.id}`)
      .set(admin.auth)
      .send({ groupId: cashierGroupId })
      .expect(200);
    await t
      .http()
      .delete(`/user-groups/${group.id}`)
      .set(admin.auth)
      .expect(204);
  });

  it('protects built-in groups', async () => {
    const groups = (
      await t.http().get('/user-groups').set(admin.auth).expect(200)
    ).body as {
      id: string;
      name: string;
      userCount: number;
    }[];
    const adminGroup = groups.find((g) => g.name === 'Admin')!;
    expect(adminGroup.userCount).toBeGreaterThan(0);

    await t
      .http()
      .delete(`/user-groups/${adminGroup.id}`)
      .set(admin.auth)
      .expect(400);
    await t
      .http()
      .patch(`/user-groups/${adminGroup.id}`)
      .set(admin.auth)
      .send({ name: 'Boss' })
      .expect(400);
    await t
      .http()
      .patch(`/user-groups/${adminGroup.id}`)
      .set(admin.auth)
      .send({ permissions: ['catalog.view'] })
      .expect(409);
  });

  it('lists permission codes', async () => {
    const res = await t
      .http()
      .get('/user-groups/permissions')
      .set(admin.auth)
      .expect(200);
    expect(res.body).toEqual(
      expect.arrayContaining(['*', 'sale.void', 'users.manage']),
    );
  });
});
