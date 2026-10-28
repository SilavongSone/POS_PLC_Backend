import argon2 from 'argon2';
import { ApprovalService } from '../src/auth/approval.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import { createTestApp, type TestApp } from './helpers.js';

describe('Manager approval (e2e)', () => {
  let t: TestApp;
  let cashier: Awaited<ReturnType<TestApp['userWith']>>;
  let manager: Awaited<ReturnType<TestApp['userWith']>>;

  beforeAll(async () => {
    t = await createTestApp();
    cashier = await t.userWith('Cashier');
    manager = await t.userWith('Manager');
    await t.prisma.user.update({
      where: { id: manager.id },
      data: { pinHash: await argon2.hash('2468') },
    });
  });
  afterAll(() => t.close());

  const approve = (body: object) =>
    t.http().post('/auth/approve').set(cashier.auth).send(body);

  async function cashierUser() {
    return (await t.service(AuthService).findActiveUser(cashier.id))!;
  }

  it('issues a token for a manager PIN and authorizes only that action for that cashier', async () => {
    const res = await approve({
      username: manager.username,
      pin: '2468',
      permission: 'sale.void',
    }).expect(200);
    expect(res.body).toMatchObject({
      expiresIn: 120,
      permission: 'sale.void',
      approver: { id: manager.id },
    });

    const approvals = t.service(ApprovalService);
    const user = await cashierUser();
    await expect(
      approvals.authorize(user, 'sale.void', res.body.approvalToken),
    ).resolves.toBe(manager.id);
    await expect(
      approvals.authorize(user, 'price.override', res.body.approvalToken),
    ).rejects.toThrow('does not match');

    const other = (await t.service(AuthService).findActiveUser(manager.id))!;
    await expect(
      approvals.authorize(
        { ...other, permissions: [] },
        'sale.void',
        res.body.approvalToken,
      ),
    ).rejects.toThrow('does not match');
  });

  it('requires approval when the user lacks the permission, and skips it when they have it', async () => {
    const approvals = t.service(ApprovalService);
    await expect(
      approvals.authorize(await cashierUser(), 'sale.void'),
    ).rejects.toMatchObject({
      response: { code: 'APPROVAL_REQUIRED' },
    });
    const mgr = (await t.service(AuthService).findActiveUser(manager.id))!;
    await expect(approvals.authorize(mgr, 'sale.void')).resolves.toBe(
      manager.id,
    );
  });

  it('rejects wrong PINs and approvers without the permission', async () => {
    await approve({
      username: manager.username,
      pin: '0000',
      permission: 'sale.void',
    }).expect(401);
    const other = await t.userWith('Cashier');
    await approve({
      username: other.username,
      password: 'test-password-1',
      permission: 'sale.void',
    }).expect(403);
    await approve({
      username: manager.username,
      permission: 'sale.void',
    }).expect(400);
  });

  it('never accepts an approval token as a login', async () => {
    const { approvalToken } = (
      await approve({
        username: manager.username,
        pin: '2468',
        permission: 'sale.void',
      }).expect(200)
    ).body;
    await t
      .http()
      .get('/auth/me')
      .set('Authorization', `Bearer ${approvalToken}`)
      .expect(401);
  });
});
