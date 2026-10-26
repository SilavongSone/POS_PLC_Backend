import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { MAX_FAILED_LOGINS } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Runs against the database in DATABASE_URL (migrated; the built-in groups come from the migration).
describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const prefix = `e2e-auth-${Date.now()}`;
  const password = 'correct-horse-1';
  let counter = 0;

  async function createUser(overrides: { isActive?: boolean } = {}) {
    const cashier = await prisma.userGroup.findUniqueOrThrow({
      where: { name: 'Cashier' },
    });
    return prisma.user.create({
      data: {
        username: `${prefix}-${++counter}`,
        fullName: 'E2E Cashier',
        passwordHash: await argon2.hash(password),
        groupId: cashier.id,
        ...overrides,
      },
    });
  }

  const http = () => request(app.getHttpServer());
  const login = (username: string, pw = password) =>
    http().post('/auth/login').send({ username, password: pw });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { username: { startsWith: prefix } },
    });
    await app.close();
  });

  it('signs in with a password and returns the user with permissions', async () => {
    const user = await createUser();
    const res = await login(user.username).expect(200);

    expect(res.body).toMatchObject({
      expiresIn: 900,
      user: { id: user.id, groupName: 'Cashier' },
    });
    expect(res.body.user.permissions).toContain('sale.create');
    expect(res.body.user).not.toHaveProperty('passwordHash');

    const me = await http()
      .get('/auth/me')
      .set('Authorization', `Bearer ${res.body.accessToken}`)
      .expect(200);
    expect(me.body.username).toBe(user.username);
  });

  it('rejects requests without a valid bearer token', async () => {
    await http().get('/auth/me').expect(401);
    await http()
      .get('/auth/me')
      .set('Authorization', 'Bearer not-a-jwt')
      .expect(401);
  });

  it('returns the same error for an unknown user and a wrong password', async () => {
    const user = await createUser();
    const unknown = await login(`${prefix}-nobody`).expect(401);
    const wrong = await login(user.username, 'wrong-password').expect(401);
    expect(unknown.body.message).toBe(wrong.body.message);
  });

  it('validates the request body', async () => {
    const res = await http()
      .post('/auth/login')
      .send({ username: '' })
      .expect(400);
    expect(res.body.errors.map((e: { path: string }) => e.path)).toEqual(
      expect.arrayContaining(['username', 'password']),
    );
  });

  it('locks the account after repeated failures, then clears on success', async () => {
    const user = await createUser();
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
      await login(user.username, 'wrong-password').expect(401);
    }
    // Even the right password is refused while locked.
    await login(user.username).expect(423);

    await prisma.user.update({
      where: { id: user.id },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    });
    await login(user.username).expect(200);
    const after = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(after).toMatchObject({ failedLoginCount: 0, lockedUntil: null });
  });

  it('rotates refresh tokens and revokes all sessions when an old one is reused', async () => {
    const user = await createUser();
    const first = (await login(user.username).expect(200)).body;

    const second = (
      await http()
        .post('/auth/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(200)
    ).body;
    expect(second.refreshToken).not.toBe(first.refreshToken);

    // Reusing the rotated token is treated as theft…
    await http()
      .post('/auth/refresh')
      .send({ refreshToken: first.refreshToken })
      .expect(401);
    // …so the latest token is revoked too.
    await http()
      .post('/auth/refresh')
      .send({ refreshToken: second.refreshToken })
      .expect(401);
  });

  it('logs out by revoking the refresh token', async () => {
    const user = await createUser();
    const { refreshToken } = (await login(user.username).expect(200)).body;

    await http().post('/auth/logout').send({ refreshToken }).expect(204);
    await http().post('/auth/refresh').send({ refreshToken }).expect(401);
  });

  it('blocks deactivated users, including tokens issued before', async () => {
    const user = await createUser();
    const { accessToken } = (await login(user.username).expect(200)).body;

    await prisma.user.update({
      where: { id: user.id },
      data: { isActive: false },
    });
    await http()
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
    await login(user.username).expect(401);
  });

  it('sets a PIN with the current password and signs in with it', async () => {
    const user = await createUser();
    const { accessToken } = (await login(user.username).expect(200)).body;
    const auth = { Authorization: `Bearer ${accessToken}` };

    await http()
      .post('/auth/pin-login')
      .send({ username: user.username, pin: '1234' })
      .expect(401);
    await http()
      .put('/auth/pin')
      .set(auth)
      .send({ currentPassword: password, pin: '12ab' })
      .expect(400);
    await http()
      .put('/auth/pin')
      .set(auth)
      .send({ currentPassword: 'wrong-password', pin: '1234' })
      .expect(401);
    await http()
      .put('/auth/pin')
      .set(auth)
      .send({ currentPassword: password, pin: '1234' })
      .expect(204);

    const res = await http()
      .post('/auth/pin-login')
      .send({ username: user.username, pin: '1234' })
      .expect(200);
    expect(res.body.user.id).toBe(user.id);
  });

  it('changes the password and signs out every session', async () => {
    const user = await createUser();
    const { accessToken, refreshToken } = (
      await login(user.username).expect(200)
    ).body;

    await http()
      .post('/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: password, newPassword: 'short' })
      .expect(400);
    await http()
      .post('/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: password, newPassword: 'a-new-password-2' })
      .expect(204);

    await http().post('/auth/refresh').send({ refreshToken }).expect(401);
    await login(user.username).expect(401);
    await login(user.username, 'a-new-password-2').expect(200);
  });
});
