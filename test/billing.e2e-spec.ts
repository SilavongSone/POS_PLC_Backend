import { createHmac } from 'node:crypto';
import { MailService } from '../src/mail/mail.service.js';
import { createTestApp, type TestApp } from './helpers.js';

const SECRET = 'test-webhook-secret-123456';
const DAY = 86_400_000;
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

describe('Plan billing (e2e)', () => {
  let t: TestApp;
  let platform: { Authorization: string };
  const uniq = () =>
    Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  beforeAll(async () => {
    t = await createTestApp();
    const res = await t
      .http()
      .post('/platform/auth/login')
      .send({ email: 'platform@test.local', password: 'platform-password-1' })
      .expect(200);
    platform = { Authorization: `Bearer ${res.body.accessToken as string}` };
  });
  afterAll(() => t.close());

  async function company(planCode = 'STARTER') {
    const code = `bill-${uniq()}`;
    const created = (
      await t
        .http()
        .post('/platform/tenants')
        .set(platform)
        .send({
          code,
          name: `Billing ${code}`,
          email: `${code}@example.com`,
          planCode,
          status: 'ACTIVE',
          owner: {
            username: 'owner',
            fullName: 'Owner',
            password: 'owner-password-1',
          },
        })
        .expect(201)
    ).body;
    const login = await t
      .http()
      .post('/auth/login')
      .send({
        tenantCode: code,
        username: 'owner',
        password: 'owner-password-1',
      })
      .expect(200);
    return {
      id: created.tenant.id as string,
      code,
      email: `${code}@example.com`,
      auth: { Authorization: `Bearer ${login.body.accessToken as string}` },
    };
  }

  const webhook = (body: object, secret = SECRET) => {
    const raw = JSON.stringify(body);
    const sig = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
    return t
      .http()
      .post('/public/billing/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Signature', sig)
      .send(raw);
  };

  it('invoices a plan and extends the subscription once it is paid online', async () => {
    const c = await company();
    const invoice = (
      await t
        .http()
        .post('/billing/checkout')
        .set(c.auth)
        .send({ planCode: 'BUSINESS', months: 12 })
        .expect(201)
    ).body;
    expect(invoice).toMatchObject({
      status: 'PENDING',
      months: 12,
      amountLak: '4990000',
      plan: { code: 'BUSINESS' },
      payment: { bankInfo: 'BCEL 010-12-00-123456 PLC POS' },
    });
    expect(invoice.number).toMatch(/^BILL-\d{4}-\d{6}$/);
    // Invoice numbers restart per company; the company code keeps the transfer note unique.
    expect(invoice.payment.reference).toBe(
      `${c.code.toUpperCase()}-${invoice.number}`,
    );

    const pay = {
      invoiceId: invoice.id,
      status: 'PAID',
      amountLak: 4_990_000,
      reference: 'TX-1',
    };
    expect(
      (await webhook(pay, 'wrong-secret-xxxxxxxx').expect(401)).body.code,
    ).toBe('WEBHOOK_SIGNATURE_INVALID');
    expect(
      (await webhook({ ...pay, amountLak: 1 }).expect(400)).body.code,
    ).toBe('AMOUNT_MISMATCH');
    const paid = (await webhook(pay).expect(200)).body;
    expect(paid.status).toBe('PAID');
    // Gateways retry: still fine, not extended twice.
    await webhook(pay).expect(200);

    const sub = (await t.http().get('/subscription').set(c.auth).expect(200))
      .body;
    expect(sub).toMatchObject({ status: 'ACTIVE', plan: { code: 'BUSINESS' } });
    const end = new Date(sub.currentPeriodEnd).getTime();
    expect(end).toBeGreaterThan(Date.now() + 360 * DAY);
    expect(end).toBeLessThan(Date.now() + 370 * DAY);
    expect(t.app.get(MailService).lastTo(c.email)!.subject).toContain(
      invoice.number,
    );

    // Another month, confirmed by the platform admin: added after the current end.
    const next = (
      await t
        .http()
        .post('/billing/checkout')
        .set(c.auth)
        .send({ planCode: 'BUSINESS', months: 1 })
        .expect(201)
    ).body;
    const pending = (
      await t
        .http()
        .get('/platform/invoices?status=PENDING')
        .set(platform)
        .expect(200)
    ).body;
    expect(pending.items.some((i: { id: string }) => i.id === next.id)).toBe(
      true,
    );
    await t
      .http()
      .post(`/platform/invoices/${next.id}/mark-paid`)
      .set(platform)
      .send({ reference: 'BCEL 123' })
      .expect(200);
    await t
      .http()
      .post(`/platform/invoices/${next.id}/mark-paid`)
      .set(platform)
      .send({})
      .expect(409);
    const after = (await t.http().get('/subscription').set(c.auth).expect(200))
      .body;
    expect(new Date(after.currentPeriodEnd).getTime()).toBeGreaterThan(
      end + 27 * DAY,
    );

    const list = (
      await t.http().get('/billing/invoices').set(c.auth).expect(200)
    ).body;
    expect(list.items.map((i: { status: string }) => i.status)).toEqual([
      'PAID',
      'PAID',
    ]);
  });

  it('lets an expired, read-only company pay, and cancels unpaid invoices', async () => {
    const c = await company();
    await t
      .http()
      .patch(`/platform/tenants/${c.id}/subscription`)
      .set(platform)
      .send({ currentPeriodEnd: new Date(Date.now() - 30 * DAY).toISOString() })
      .expect(200);
    await t
      .http()
      .post('/brands')
      .set(c.auth)
      .send({ name: `B ${uniq()}` })
      .expect(402);
    const inv = (
      await t
        .http()
        .post('/billing/checkout')
        .set(c.auth)
        .send({ planCode: 'STARTER', months: 1 })
        .expect(201)
    ).body;
    const cancelled = await t
      .http()
      .post(`/billing/invoices/${inv.id}/cancel`)
      .set(c.auth)
      .expect(200);
    expect(cancelled.body.status).toBe('CANCELLED');
    await webhook({
      invoiceId: inv.id,
      status: 'PAID',
      amountLak: 199_000,
      reference: 'x',
    }).expect(409);

    await t
      .http()
      .post('/billing/checkout')
      .set(c.auth)
      .send({ planCode: 'FREE', months: 1 })
      .expect(400);
  });

  it('addresses the migrated company and branch by UUID', async () => {
    expect(t.tenantId).toMatch(/^[0-9a-f-]{36}$/);
    const admin = await t.userWith('Admin');
    await t
      .http()
      .get(`/reports/sales-summary?branchId=${t.branchId}`)
      .set(admin.auth)
      .expect(200);
  });

  it('pays by QR: bank accounts in the pay dialog, slip review, reject, then confirm', async () => {
    // Super Admin adds a bank account with its QR code.
    const qr = (
      await t
        .http()
        .post('/platform/uploads/bank-qr')
        .set(platform)
        .attach('file', PNG, { filename: 'qr.png', contentType: 'image/png' })
        .expect(201)
    ).body.url as string;
    expect(qr).toMatch(/^\/api\/uploads\/platform\//);
    await t
      .http()
      .post('/platform/bank-accounts')
      .set(platform)
      .send({
        bankName: 'BCEL',
        accountName: 'PLC',
        accountNumber: '010-12-00-1',
        qrImageUrl: '/api/uploads/products/x/evil.png',
      })
      .expect(400);
    const bank = (
      await t
        .http()
        .post('/platform/bank-accounts')
        .set(platform)
        .send({
          bankName: `BCEL ${uniq()}`,
          accountName: 'PLC POS',
          accountNumber: '010-12-00-1',
          qrImageUrl: qr,
        })
        .expect(201)
    ).body;

    const c = await company();
    const inv = (
      await t
        .http()
        .post('/billing/checkout')
        .set(c.auth)
        .send({ planCode: 'BUSINESS', months: 1 })
        .expect(201)
    ).body;
    expect(inv.review).toBe('UNPAID');
    expect(
      inv.payment.bankAccounts.some(
        (b: { id: string; qrImageUrl: string }) =>
          b.id === bank.id && b.qrImageUrl === qr,
      ),
    ).toBe(true);

    // Nothing to reject before a slip is sent; a shop token cannot use the platform route.
    await t
      .http()
      .post(`/platform/invoices/${inv.id}/reject`)
      .set(platform)
      .send({ reason: 'x' })
      .expect(409);
    await t
      .http()
      .post(`/platform/invoices/${inv.id}/reject`)
      .set(c.auth)
      .send({ reason: 'x' })
      .expect(401);

    const sent = (
      await t
        .http()
        .post(`/billing/invoices/${inv.id}/slip`)
        .set(c.auth)
        .attach('file', PNG, { filename: 'slip.png', contentType: 'image/png' })
        .expect(201)
    ).body;
    expect(sent.review).toBe('IN_REVIEW');
    expect(sent.slipUrl).toContain(`/slips/${c.id}/`);

    const inReview = (
      await t
        .http()
        .get(`/platform/invoices?inReview=true&tenantId=${c.id}`)
        .set(platform)
        .expect(200)
    ).body;
    expect(inReview.items.map((i: { id: string }) => i.id)).toEqual([inv.id]);

    // Rejected: the company sees why, and the invoice leaves the review list.
    await t
      .http()
      .post(`/platform/invoices/${inv.id}/reject`)
      .set(platform)
      .send({ reason: 'Amount not visible' })
      .expect(200);
    const list = (
      await t.http().get('/billing/invoices').set(c.auth).expect(200)
    ).body;
    const mine = list.items.find((i: { id: string }) => i.id === inv.id);
    expect(mine.review).toBe('REJECTED');
    expect(mine.rejectReason).toBe('Amount not visible');
    expect(
      (
        await t
          .http()
          .get(`/platform/invoices?inReview=true&tenantId=${c.id}`)
          .set(platform)
          .expect(200)
      ).body.items,
    ).toHaveLength(0);

    // A new slip goes back to review; confirming it activates the plan.
    await new Promise((r) => setTimeout(r, 5));
    const again = (
      await t
        .http()
        .post(`/billing/invoices/${inv.id}/slip`)
        .set(c.auth)
        .attach('file', PNG, {
          filename: 'slip2.png',
          contentType: 'image/png',
        })
        .expect(201)
    ).body;
    expect(again.review).toBe('IN_REVIEW');
    await t
      .http()
      .post(`/platform/invoices/${inv.id}/mark-paid`)
      .set(platform)
      .send({ reference: 'slip checked' })
      .expect(200);
    await t
      .http()
      .post(`/billing/invoices/${inv.id}/slip`)
      .set(c.auth)
      .attach('file', PNG, { filename: 'late.png', contentType: 'image/png' })
      .expect(409);

    await t
      .http()
      .delete(`/platform/bank-accounts/${bank.id}`)
      .set(platform)
      .expect(204);
  });
});
