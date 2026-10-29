import argon2 from 'argon2';
import type { Response } from 'supertest';
import { z } from 'zod';
import { GoogleIdentityService } from '../src/account/google-identity.service.js';
import {
  authTokensSchema,
  authUserSchema,
  emailVerifiedSchema,
} from '../src/auth/auth.responses.js';
import {
  branchesSchema,
  branchSchema,
} from '../src/branches/branches.responses.js';
import {
  categoriesSchema,
  productDetailSchema,
  productLookupSchema,
  productPageSchema,
} from '../src/catalog/catalog.responses.js';
import { errorResponseSchema } from '../src/common/openapi.js';
import { MailService } from '../src/mail/mail.service.js';
import {
  publicPlansSchema,
  signupCompletedSchema,
  signupPendingSchema,
} from '../src/platform/platform.responses.js';
import {
  printCountSchema,
  saleQuoteSchema,
  saleReceiptSchema,
  saleSchema,
} from '../src/sales/sales.responses.js';
import {
  currentRatesSchema,
  paymentTypesSchema,
  registersSchema,
} from '../src/settings/settings.responses.js';
import { dashboardSchema } from '../src/reports/reports.responses.js';
import { shiftSchema } from '../src/shifts/shifts.responses.js';
import { subscriptionSchema } from '../src/tenancy/subscription.responses.js';
import { createTestApp, TEST_PASSWORD, type TestApp } from './helpers.js';

type User = Awaited<ReturnType<TestApp['userWith']>>;

/**
 * Drift guard for the OpenAPI contract (docs/openapi.json): every endpoint the frontend
 * calls is exercised and its real response parsed with the same zod schema the docs are
 * generated from. Schemas are strict, so a new, renamed or retyped field fails here.
 */
describe('API contract (e2e)', () => {
  let t: TestApp;
  let mail: MailService;
  let manager: User;
  let cashier: User;
  let registerId: string;
  let cashTypeId: string;
  const uniq = () =>
    Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  /** Parses the body with `schema`; on mismatch the error lists every bad path. */
  function conforms<T extends z.ZodType>(schema: T, res: Response): z.infer<T> {
    const result = schema.safeParse(res.body);
    if (!result.success) {
      // supertest keeps the Node request on the response (not in its types).
      const req = (res as unknown as { req: { method: string; path: string } })
        .req;
      throw new Error(
        `${req.method} ${req.path} does not match its schema:\n${z.prettifyError(result.error)}`,
      );
    }
    return result.data;
  }
  const tokenFrom = (to: string) =>
    /token=([\w-]+)/.exec(mail.lastTo(to)!.text)![1];
  const codeFrom = (to: string) =>
    /\b(\d{6})\b/.exec(mail.lastTo(to)!.text)![1];
  const googleToken = (o: object) =>
    JSON.stringify({ name: 'Google User', emailVerified: true, ...o });

  beforeAll(async () => {
    t = await createTestApp();
    mail = t.app.get(MailService);
    // Google is not reachable from tests: the "ID token" is the identity as JSON.
    t.app.get(GoogleIdentityService).verify = (idToken: string) =>
      Promise.resolve(JSON.parse(idToken) as never);
    [manager, cashier] = await Promise.all([
      t.userWith('Manager'),
      t.userWith('Cashier'),
    ]);
    registerId = (
      await t.prisma.register.create({
        data: {
          code: `C${uniq().slice(-5)}`.toUpperCase(),
          name: 'Contract test',
          branchId: t.branchId,
        },
      })
    ).id;
    cashTypeId = (
      await t.prisma.paymentType.findFirstOrThrow({
        where: { kind: 'CASH', isActive: true },
      })
    ).id;
  });
  afterAll(() => t.close());

  describe('auth', () => {
    it('login, refresh, logout', async () => {
      const login = conforms(
        authTokensSchema,
        await t
          .http()
          .post('/auth/login')
          .send({ username: cashier.username, password: TEST_PASSWORD })
          .expect(200),
      );
      const refreshed = conforms(
        authTokensSchema,
        await t
          .http()
          .post('/auth/refresh')
          .send({ refreshToken: login.refreshToken })
          .expect(200),
      );
      const out = await t
        .http()
        .post('/auth/logout')
        .send({ refreshToken: refreshed.refreshToken })
        .expect(204);
      expect(out.text).toBe('');
    });

    it('pin login', async () => {
      await t.prisma.user.update({
        where: { id: manager.id },
        data: { pinHash: await argon2.hash('2468') },
      });
      conforms(
        authTokensSchema,
        await t
          .http()
          .post('/auth/pin-login')
          .send({ username: manager.username, pin: '2468' })
          .expect(200),
      );
    });

    it('error body', async () => {
      const res = await t
        .http()
        .post('/auth/login')
        .send({ username: '' })
        .expect(400);
      const body = conforms(errorResponseSchema, res);
      expect(body.code).toBe('VALIDATION_FAILED');
      expect(body.errors?.length).toBeGreaterThan(0);
      conforms(
        errorResponseSchema,
        await t
          .http()
          .post('/auth/login')
          .send({ username: 'nobody-here', password: 'wrong-password' })
          .expect(401),
      );
    });

    it('google sign-in', async () => {
      const sub = `contract-${uniq()}`;
      const user = await t.userWith('Cashier');
      await t.prisma.user.update({
        where: { id: user.id },
        data: { googleSub: sub },
      });
      conforms(
        authTokensSchema,
        await t
          .http()
          .post('/auth/google')
          .send({
            idToken: googleToken({ sub, email: `${sub}@example.com` }),
            tenantCode: 'plc',
          })
          .expect(200),
      );
    });

    it('e-mail confirmation', async () => {
      const user = await t.userWith('Cashier');
      const email = `verify-${uniq()}@example.com`;
      await t.prisma.user.update({ where: { id: user.id }, data: { email } });
      const resent = await t
        .http()
        .post('/auth/resend-verification')
        .set(user.auth)
        .expect(204);
      expect(resent.text).toBe('');
      const verified = conforms(
        emailVerifiedSchema,
        await t
          .http()
          .post('/auth/verify-email')
          .send({ token: tokenFrom(email) })
          .expect(200),
      );
      expect(verified.email).toBe(email);
    });

    it('password reset', async () => {
      const user = await t.userWith('Cashier');
      const email = `reset-${uniq()}@example.com`;
      await t.prisma.user.update({
        where: { id: user.id },
        data: { email, emailVerifiedAt: new Date() },
      });
      const forgot = await t
        .http()
        .post('/auth/forgot-password')
        .send({ tenantCode: 'plc', email })
        .expect(202);
      expect(forgot.text).toBe('');
      const reset = await t
        .http()
        .post('/auth/reset-password')
        .send({ token: tokenFrom(email), newPassword: 'new-password-123' })
        .expect(204);
      expect(reset.text).toBe('');
    });
  });

  describe('public', () => {
    it('plans', async () => {
      const plans = conforms(
        publicPlansSchema,
        await t.http().get('/public/plans').expect(200),
      );
      expect(plans.length).toBeGreaterThan(0);
    });

    it('sign-up with an e-mailed code', async () => {
      const code = `ct-${uniq()}`;
      const email = `${code}@example.com`;
      const pending = conforms(
        signupPendingSchema,
        await t
          .http()
          .post('/public/signup')
          .send({
            code,
            name: 'Contract shop',
            email,
            planCode: 'STARTER',
            owner: {
              username: 'boss',
              fullName: 'Boss',
              password: 'owner-password-1',
            },
          })
          .expect(201),
      );
      conforms(
        signupPendingSchema,
        await t
          .http()
          .post('/public/signup/resend')
          .send({ requestId: pending.requestId })
          .expect(200),
      );
      const done = conforms(
        signupCompletedSchema,
        await t
          .http()
          .post('/public/signup/verify')
          .send({ requestId: pending.requestId, code: codeFrom(email) })
          .expect(200),
      );
      expect(done.tenant.code).toBe(code);
    });

    it('sign-up with Google', async () => {
      const code = `cg-${uniq()}`;
      conforms(
        signupCompletedSchema,
        await t
          .http()
          .post('/public/signup/google')
          .send({
            code,
            name: 'Google shop',
            planCode: 'STARTER',
            idToken: googleToken({ sub: code, email: `${code}@example.com` }),
          })
          .expect(201),
      );
    });
  });

  describe('catalog and settings', () => {
    let serialProduct: { id: string; sku: string };
    const serial = `CT-SN-${uniq()}`;

    beforeAll(async () => {
      serialProduct = (
        await t
          .http()
          .post('/products')
          .set(manager.auth)
          .send({
            sku: `CT-${uniq()}`,
            name: 'Contract printer',
            retailPrice: 250_000,
            trackSerial: true,
            warrantyMonths: 12,
          })
          .expect(201)
      ).body as { id: string; sku: string };
      const doc = (
        await t
          .http()
          .post('/stock-documents')
          .set(manager.auth)
          .send({
            type: 'RECEIVE',
            items: [
              {
                productId: serialProduct.id,
                quantity: 2,
                unitCost: 150_000,
                serials: [serial, `${serial}-2`],
              },
            ],
          })
          .expect(201)
      ).body as { id: string };
      await t
        .http()
        .post(`/stock-documents/${doc.id}/post`)
        .set(manager.auth)
        .expect(200);
    });

    it('categories, flat and as a tree', async () => {
      const flat = conforms(
        categoriesSchema,
        await t.http().get('/categories').set(cashier.auth).expect(200),
      );
      expect(flat.length).toBeGreaterThan(0);
      expect(flat.every((c) => c.children === undefined)).toBe(true);
      const tree = conforms(
        categoriesSchema,
        await t
          .http()
          .get('/categories?tree=true')
          .set(cashier.auth)
          .expect(200),
      );
      expect(tree.every((c) => Array.isArray(c.children))).toBe(true);
    });

    it('product list, with and without cost', async () => {
      const withCost = conforms(
        productPageSchema,
        await t
          .http()
          .get(`/products?pageSize=100&branchId=${t.branchId}`)
          .set(manager.auth)
          .expect(200),
      );
      expect(withCost.items[0].costPrice).toBeDefined();
      const withoutCost = conforms(
        productPageSchema,
        await t
          .http()
          .get(`/products?q=${serialProduct.sku}&inStock=true&sort=sku`)
          .set(cashier.auth)
          .expect(200),
      );
      expect(withoutCost.items).toHaveLength(1);
      expect(withoutCost.items[0].costPrice).toBeUndefined();
    });

    it('product detail and scan lookup', async () => {
      const detail = conforms(
        productDetailSchema,
        await t
          .http()
          .get(`/products/${serialProduct.id}?branchId=${t.branchId}`)
          .set(cashier.auth)
          .expect(200),
      );
      expect(detail.serialsInStock.NEW).toBe(2);
      const bySku = conforms(
        productLookupSchema,
        await t
          .http()
          .get(`/products/lookup?code=${serialProduct.sku}`)
          .set(cashier.auth)
          .expect(200),
      );
      expect(bySku.serial).toBeNull();
      const bySerial = conforms(
        productLookupSchema,
        await t
          .http()
          .get(`/products/lookup?code=${serial}`)
          .set(manager.auth)
          .expect(200),
      );
      expect(bySerial.serial?.serial).toBe(serial);
      conforms(
        errorResponseSchema,
        await t
          .http()
          .get('/products/lookup?code=no-such-code-anywhere')
          .set(cashier.auth)
          .expect(404),
      );
    });

    it('payment types, exchange rates, registers', async () => {
      conforms(
        paymentTypesSchema,
        await t.http().get('/payment-types').set(cashier.auth).expect(200),
      );
      conforms(
        paymentTypesSchema,
        await t
          .http()
          .get('/payment-types?active=true')
          .set(cashier.auth)
          .expect(200),
      );
      conforms(
        currentRatesSchema,
        await t
          .http()
          .get('/exchange-rates/current')
          .set(cashier.auth)
          .expect(200),
      );
      conforms(
        registersSchema,
        await t.http().get('/registers').set(cashier.auth).expect(200),
      );
    });

    it('app shell: me, branches, subscription', async () => {
      conforms(
        authUserSchema,
        await t.http().get('/auth/me').set(cashier.auth).expect(200),
      );
      const branches = conforms(
        branchesSchema,
        await t.http().get('/branches?all=true').set(cashier.auth).expect(200),
      );
      conforms(
        branchSchema,
        await t
          .http()
          .get(`/branches/${branches[0].id}`)
          .set(cashier.auth)
          .expect(200),
      );
      conforms(
        subscriptionSchema,
        await t.http().get('/subscription').set(cashier.auth).expect(200),
      );
    });

    describe('till: shift, quote, sale, receipt', () => {
      let saleId: string;
      // Serialized: a quote needs the scanned serial too.
      const items = () => [
        { productId: serialProduct.id, quantity: 1, serials: [serial] },
      ];

      it('no open shift: empty body, not JSON null', async () => {
        const res = await t
          .http()
          .get('/shifts/current')
          .set(cashier.auth)
          .expect(200);
        expect(res.text).toBe('');
      });

      it('opens a shift and reads it back', async () => {
        const opened = conforms(
          shiftSchema,
          await t
            .http()
            .post('/shifts/open')
            .set(cashier.auth)
            .send({ registerId, openingCash: { LAK: 500_000, USD: 20 } })
            .expect(201),
        );
        const current = conforms(
          shiftSchema,
          await t.http().get('/shifts/current').set(cashier.auth).expect(200),
        );
        expect(current.id).toBe(opened.id);
        // The register list now shows the open shift.
        const registers = conforms(
          registersSchema,
          await t.http().get('/registers').set(cashier.auth).expect(200),
        );
        expect(registers.find((r) => r.id === registerId)?.openShift?.id).toBe(
          opened.id,
        );
      });

      it('quotes a cart without, with and with too little payment', async () => {
        const quote = (payments?: object[]) =>
          t
            .http()
            .post('/sales/quote')
            .set(cashier.auth)
            .send({ registerId, items: items(), payments })
            .expect(200);
        const none = conforms(saleQuoteSchema, await quote());
        expect(none.payment).toBeNull();
        const paid = conforms(
          saleQuoteSchema,
          await quote([
            { paymentTypeId: cashTypeId, currency: 'USD', amount: 5 },
            { paymentTypeId: cashTypeId, amount: 300_000 },
          ]),
        );
        expect(paid.payment).toHaveProperty('changeLak');
        const short = conforms(
          saleQuoteSchema,
          await quote([{ paymentTypeId: cashTypeId, amount: 1000 }]),
        );
        expect(short.payment).toHaveProperty('error');
      });

      it('completes a sale with a serial number', async () => {
        const sale = conforms(
          saleSchema,
          await t
            .http()
            .post('/sales')
            .set(cashier.auth)
            .set('Idempotency-Key', `contract-${uniq()}`)
            .send({
              registerId,
              items: items(),
              payments: [{ paymentTypeId: cashTypeId, amount: 300_000 }],
            })
            .expect(201),
        );
        expect(sale.items[0].serialNumbers[0].serial).toBe(serial);
        saleId = sale.id;
      });

      it('receipt and print count', async () => {
        const receipt = conforms(
          saleReceiptSchema,
          await t
            .http()
            .get(`/sales/${saleId}/receipt`)
            .set(cashier.auth)
            .expect(200),
        );
        expect(receipt.isReprint).toBe(false);
        const printed = conforms(
          printCountSchema,
          await t
            .http()
            .post(`/sales/${saleId}/printed`)
            .set(cashier.auth)
            .expect(200),
        );
        expect(printed.printCount).toBe(1);
      });

      it('dashboard after the sale', async () => {
        const dash = conforms(
          dashboardSchema,
          await t
            .http()
            .get('/reports/dashboard')
            .set(manager.auth)
            .expect(200),
        );
        expect(dash.today.count).toBeGreaterThan(0);
        expect(dash.topProductsToday.length).toBeGreaterThan(0);
        expect(dash.today.profitLak).toBeDefined();
      });
    });
  });
});
