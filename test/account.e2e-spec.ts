import { GoogleIdentityService } from '../src/account/google-identity.service.js';
import { MailService } from '../src/mail/mail.service.js';
import { createTestApp, type TestApp } from './helpers.js';

/** Sign-up with e-mail code, e-mail confirmation, password reset, Google sign-in. */
describe('Accounts and e-mail (e2e)', () => {
  let t: TestApp;
  let mail: MailService;
  const uniq = () =>
    Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const PASSWORD = 'owner-password-1';

  beforeAll(async () => {
    t = await createTestApp();
    mail = t.app.get(MailService);
    // Google is not reachable from tests: the "ID token" is the identity as JSON.
    t.app.get(GoogleIdentityService).verify = (idToken: string) =>
      Promise.resolve(JSON.parse(idToken) as never);
  });
  afterAll(() => t.close());

  const codeFrom = (to: string) =>
    /\b(\d{6})\b/.exec(mail.lastTo(to)!.text)![1];
  const tokenFrom = (to: string) =>
    /token=([\w-]+)/.exec(mail.lastTo(to)!.text)![1];
  const googleToken = (o: object) =>
    JSON.stringify({ name: 'Google User', emailVerified: true, ...o });

  describe('sign-up with e-mail', () => {
    it('creates the company only after the mailed code is entered', async () => {
      const code = `su-${uniq()}`;
      const email = `${code}@example.com`;
      const body = {
        code,
        name: 'Signup shop',
        email,
        planCode: 'STARTER',
        owner: { username: 'boss', fullName: 'Boss', password: PASSWORD },
      };
      const req = (
        await t
          .http()
          .post('/public/signup')
          .set('Accept-Language', 'en')
          .send(body)
          .expect(201)
      ).body;
      expect(req).toMatchObject({ email });
      const sent = mail.lastTo(email)!;
      expect(sent.subject).toMatch(/^Verification code \d{6}/);
      expect(sent.text).toContain(
        `https://pos.test/signup/verify?request=${req.requestId}`,
      );

      // Not created yet.
      await t
        .http()
        .post('/auth/login')
        .send({ tenantCode: code, username: 'boss', password: PASSWORD })
        .expect(401);

      const right = codeFrom(email);
      const wrong = right === '000000' ? '111111' : '000000';
      const bad = await t
        .http()
        .post('/public/signup/verify')
        .send({ requestId: req.requestId, code: wrong })
        .expect(400);
      expect(bad.body.code).toBe('SIGNUP_CODE_INVALID');

      const done = (
        await t
          .http()
          .post('/public/signup/verify')
          .send({ requestId: req.requestId, code: right })
          .expect(200)
      ).body;
      expect(done.tenant.code).toBe(code);
      expect(done.user).toMatchObject({ email, emailVerified: true });
      const auth = { Authorization: `Bearer ${done.accessToken as string}` };
      const sub = (await t.http().get('/subscription').set(auth).expect(200))
        .body;
      expect(sub.status).toBe('TRIAL');
      expect(sub.company.name).toBe('Signup shop');

      // The code is single-use; the company code is now taken.
      await t
        .http()
        .post('/public/signup/verify')
        .send({ requestId: req.requestId, code: right })
        .expect(400);
      await t.http().post('/public/signup').send(body).expect(409);
      await t
        .http()
        .post('/public/signup')
        .send({ ...body, code: `x-${uniq()}`, planCode: 'NOPE' })
        .expect(400);
    });

    it('needs only shop name, e-mail and password; derives code, owner and plan', async () => {
      const local = `quick.${uniq()}`;
      const email = `${local}@example.com`;
      const signup = (name: string) =>
        t
          .http()
          .post('/public/signup')
          .send({ name, email, owner: { password: PASSWORD } })
          .expect(201);
      const verify = async (requestId: string) =>
        (
          await t
            .http()
            .post('/public/signup/verify')
            .send({ requestId, code: codeFrom(email) })
            .expect(200)
        ).body;

      // A Lao shop name has no Latin letters: the code comes from the e-mail.
      const lao = await verify((await signup('ຮ້ານ ທົດລອງ')).body.requestId);
      const fromEmail = local.replace(/[^a-z0-9]+/g, '-');
      expect(lao.tenant.code).toBe(fromEmail);
      expect(lao.user).toMatchObject({
        username: local,
        fullName: 'ຮ້ານ ທົດລອງ',
        email,
      });
      const sub = (
        await t
          .http()
          .get('/subscription')
          .set({ Authorization: `Bearer ${lao.accessToken as string}` })
          .expect(200)
      ).body;
      expect(sub.status).toBe('TRIAL');

      // The owner signs in with the derived code and username.
      await t
        .http()
        .post('/auth/login')
        .send({
          tenantCode: lao.tenant.code,
          username: local,
          password: PASSWORD,
        })
        .expect(200);

      // A Latin shop name gives the code; a taken code gets a number.
      const latinName = `Quick ${uniq()}`;
      const first = await verify((await signup(latinName)).body.requestId);
      const base = latinName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      expect(first.tenant.code).toBe(base);
      const second = await verify((await signup(latinName)).body.requestId);
      expect(second.tenant.code).toBe(`${base}-2`);
    });

    it('stops guessing after 5 wrong codes, and can resend a new one', async () => {
      const code = `su-${uniq()}`;
      const email = `${code}@example.com`;
      const req = (
        await t
          .http()
          .post('/public/signup')
          .send({
            code,
            name: 'Guess shop',
            email,
            planCode: 'FREE',
            owner: { username: 'boss', fullName: 'Boss', password: PASSWORD },
          })
          .expect(201)
      ).body;
      const right = codeFrom(email);
      const wrong = right === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) {
        await t
          .http()
          .post('/public/signup/verify')
          .send({ requestId: req.requestId, code: wrong })
          .expect(400);
      }
      await t
        .http()
        .post('/public/signup/verify')
        .send({ requestId: req.requestId, code: right })
        .expect(400);

      await t
        .http()
        .post('/public/signup/resend')
        .send({ requestId: req.requestId })
        .expect(200);
      await t
        .http()
        .post('/public/signup/verify')
        .send({ requestId: req.requestId, code: codeFrom(email) })
        .expect(200);
    });
  });

  describe('e-mail on users', () => {
    it('confirms a new user’s e-mail and resets a forgotten password', async () => {
      const admin = await t.userWith('Admin');
      const group = (await t.http().get('/user-groups').set(admin.auth)).body[0]
        .id;
      const email = `staff-${uniq()}@example.com`;
      const username = `staff-${uniq()}`;
      const user = (
        await t
          .http()
          .post('/users')
          .set(admin.auth)
          .send({
            username,
            fullName: 'Staff',
            password: PASSWORD,
            groupId: group,
            email,
          })
          .expect(201)
      ).body;
      expect(user).toMatchObject({ email, emailVerifiedAt: null });

      // Unconfirmed addresses get no reset link.
      await t.http().post('/auth/forgot-password').send({ email }).expect(202);
      expect(mail.lastTo(email)!.text).toContain('/verify-email?token=');

      const verified = await t
        .http()
        .post('/auth/verify-email')
        .send({ token: tokenFrom(email) })
        .expect(200);
      expect(verified.body.email).toBe(email);
      await t
        .http()
        .post('/auth/verify-email')
        .send({ token: tokenFrom(email) })
        .expect(400);

      await t
        .http()
        .post('/auth/forgot-password')
        .send({ tenantCode: 'plc', email })
        .expect(202);
      expect(mail.lastTo(email)!.text).toContain('/reset-password?token=');
      const reset = tokenFrom(email);
      await t
        .http()
        .post('/auth/reset-password')
        .send({ token: reset, newPassword: 'brand-new-password' })
        .expect(204);
      await t
        .http()
        .post('/auth/login')
        .send({ username, password: 'brand-new-password' })
        .expect(200);
      await t
        .http()
        .post('/auth/reset-password')
        .send({ token: reset, newPassword: 'another-password' })
        .expect(400);

      // Unknown addresses get the same answer and no mail.
      const unknown = `nobody-${uniq()}@example.com`;
      await t
        .http()
        .post('/auth/forgot-password')
        .send({ email: unknown })
        .expect(202);
      expect(mail.lastTo(unknown)).toBeUndefined();

      // Changing the address needs a new confirmation.
      const changed = (
        await t
          .http()
          .patch(`/users/${user.id}`)
          .set(admin.auth)
          .send({ email: `new-${email}` })
          .expect(200)
      ).body;
      expect(changed.emailVerifiedAt).toBeNull();
      expect(mail.lastTo(`new-${email}`)).toBeDefined();
    });
  });

  describe('Google', () => {
    it('signs up with Google and signs in with it later', async () => {
      const code = `go-${uniq()}`;
      const email = `${code}@gmail.com`;
      const sub = `google-${uniq()}`;
      const res = (
        await t
          .http()
          .post('/public/signup/google')
          .send({
            idToken: googleToken({ sub, email }),
            code,
            name: 'Google shop',
            planCode: 'STARTER',
          })
          .expect(201)
      ).body;
      expect(res.user).toMatchObject({
        email,
        emailVerified: true,
        googleLinked: true,
      });

      const login = (
        await t
          .http()
          .post('/auth/google')
          .send({ idToken: googleToken({ sub, email }) })
          .expect(200)
      ).body;
      expect(login.user.id).toBe(res.user.id);

      const unverified = await t
        .http()
        .post('/public/signup/google')
        .send({
          idToken: googleToken({
            sub: `x-${uniq()}`,
            email: 'x@gmail.com',
            emailVerified: false,
          }),
          code: `go-${uniq()}`,
          name: 'X',
          planCode: 'STARTER',
        })
        .expect(400);
      expect(unverified.body.code).toBe('GOOGLE_EMAIL_UNVERIFIED');

      const stranger = await t
        .http()
        .post('/auth/google')
        .send({
          idToken: googleToken({
            sub: `s-${uniq()}`,
            email: `s-${uniq()}@gmail.com`,
          }),
        })
        .expect(401);
      expect(stranger.body.code).toBe('GOOGLE_ACCOUNT_UNKNOWN');
    });

    it('links by confirmed e-mail and asks for the company when there are several', async () => {
      const email = `multi-${uniq()}@gmail.com`;
      const sub = `google-${uniq()}`;
      // Two companies, each with a user owning this confirmed e-mail.
      for (const company of [`m1-${uniq()}`, `m2-${uniq()}`]) {
        await t
          .http()
          .post('/public/signup/google')
          .send({
            idToken: googleToken({ sub: `${sub}-${company}`, email }),
            code: company,
            name: company,
            planCode: 'FREE',
          })
          .expect(201);
      }
      const res = await t
        .http()
        .post('/auth/google')
        .send({ idToken: googleToken({ sub, email }) })
        .expect(409);
      expect(res.body.code).toBe('TENANT_REQUIRED');
      expect(res.body.companies).toHaveLength(2);
      const code = res.body.companies[0].code as string;
      const ok = await t
        .http()
        .post('/auth/google')
        .send({ idToken: googleToken({ sub, email }), tenantCode: code })
        .expect(200);
      expect(ok.body.user.googleLinked).toBe(true);
    });
  });
});
