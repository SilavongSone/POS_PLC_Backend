import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { AuditService } from '../common/audit.service.js';
import { DocNumberService } from '../common/doc-number.service.js';
import { pageArgs, toPage, type PageQuery } from '../common/pagination.js';
import { RequestContext } from '../common/request-context.js';
import { addMonths } from '../common/time.js';
import type { Env } from '../config/env.js';
import { Prisma, type InvoiceStatus } from '../generated/prisma/client.js';
import { currentLang } from '../i18n/i18n.js';
import { MailService } from '../mail/mail.service.js';
import { mailTemplates } from '../mail/templates.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { EntitlementsService } from '../tenancy/entitlements.service.js';
import { ImageStoreService } from '../common/image-store.service.js';
import { BankAccountsService } from './bank-accounts.service.js';

const notPending = () =>
  new ConflictException({
    message: 'This invoice is already paid or cancelled',
    code: 'INVOICE_NOT_PENDING',
  });

export const webhookBodySchema = z.object({
  invoiceId: z.uuid(),
  status: z.literal('PAID'),
  amountLak: z.coerce.number().int().positive(),
  reference: z.string().trim().min(1).max(100),
});

/** Plan invoices: the company checks out, then a gateway or a platform admin confirms payment. */
/**
 * What a company writes in its bank-transfer note. Invoice numbers restart per company,
 * so the company code makes it unique on the bank statement (PLC-LAO-BILL-2026-000001).
 */
export function transferReference(tenantCode: string, invoiceNumber: string) {
  return `${tenantCode.toUpperCase()}-${invoiceNumber}`;
}

/**
 * Where a pending invoice stands: UNPAID (no slip yet), IN_REVIEW (slip sent, a platform admin
 * has to check it) or REJECTED (slip turned down: send a new one). Paid/cancelled: null.
 */
export type SlipReview = 'UNPAID' | 'IN_REVIEW' | 'REJECTED';
export function slipReview(inv: {
  status: InvoiceStatus;
  slipAt: Date | null;
  rejectedAt: Date | null;
}): SlipReview | null {
  if (inv.status !== 'PENDING') return null;
  if (!inv.slipAt) return 'UNPAID';
  return inv.rejectedAt && inv.rejectedAt >= inv.slipAt
    ? 'REJECTED'
    : 'IN_REVIEW';
}

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly docNumbers: DocNumberService,
    private readonly entitlements: EntitlementsService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<Env, true>,
    private readonly banks: BankAccountsService,
    private readonly images: ImageStoreService,
  ) {}

  /** How to pay an invoice: bank accounts with QR codes and, if configured, an online link. */
  private payment(
    inv: {
      id: string;
      number: string;
      amountLak: Prisma.Decimal;
    },
    tenantCode: string,
    bankAccounts: Awaited<ReturnType<BankAccountsService['listActive']>>,
  ) {
    const url = this.config.get('BILLING_PAY_URL', { infer: true });
    return {
      bankAccounts,
      bankInfo: this.config.get('BILLING_BANK_INFO', { infer: true }) ?? null,
      payUrl: url
        ? url
            .replaceAll('{invoiceId}', inv.id)
            .replaceAll('{number}', encodeURIComponent(inv.number))
            .replaceAll('{amount}', inv.amountLak.toString())
        : null,
      /** Put this in the transfer note so the payment can be matched. */
      reference: transferReference(tenantCode, inv.number),
    };
  }

  /** Current company: an invoice for `months` of a plan. */
  async checkout(planCode: string, months: number, userId: string) {
    const plan = await this.prisma.plan.findUnique({
      where: { code: planCode },
    });
    const current = await this.prisma.subscription.findUnique({
      where: { tenantId: RequestContext.tenantId() },
    });
    if (!plan?.isActive || (!plan.isPublic && plan.id !== current?.planId)) {
      throw new BadRequestException('Unknown plan');
    }
    const amountLak =
      months === 12 ? plan.priceYearlyLak : plan.priceMonthlyLak.mul(months);
    if (amountLak.lte(0)) {
      throw new BadRequestException({
        message: 'This plan is free; ask support to switch to it',
        code: 'PLAN_FREE',
      });
    }
    const invoice = await this.prisma.$transaction(async (tx) =>
      tx.billingInvoice.create({
        data: {
          number: await this.docNumbers.yearly(tx, 'BILL'),
          planId: plan.id,
          months,
          amountLak,
        },
        include: { plan: { select: { code: true, name: true } } },
      }),
    );
    await this.audit.log({
      userId,
      action: 'BILLING_CHECKOUT',
      entity: 'BillingInvoice',
      entityId: invoice.id,
      after: { plan: plan.code, months, amountLak },
    });
    return {
      ...invoice,
      review: slipReview(invoice),
      payment: this.payment(
        invoice,
        await this.tenantCode(),
        await this.banks.listActive(),
      ),
    };
  }

  /** Code of the current company (invoice numbers repeat across companies; codes don't). */
  private async tenantCode() {
    const id = RequestContext.tenantId();
    const tenant = await RequestContext.asPlatform(() =>
      this.prisma.tenant.findUniqueOrThrow({
        where: { id },
        select: { code: true },
      }),
    );
    return tenant.code;
  }

  async list(q: PageQuery & { status?: InvoiceStatus }) {
    const where = { status: q.status };
    const [items, total, code, banks] = await Promise.all([
      this.prisma.billingInvoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { plan: { select: { code: true, name: true } } },
        ...pageArgs(q),
      }),
      this.prisma.billingInvoice.count({ where }),
      this.tenantCode(),
      this.banks.listActive(),
    ]);
    return toPage(
      items.map((i) => ({
        ...i,
        review: slipReview(i),
        payment: i.status === 'PENDING' ? this.payment(i, code, banks) : null,
      })),
      total,
      q,
    );
  }

  async cancel(id: string, userId: string) {
    const { count } = await this.prisma.billingInvoice.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
    if (count === 0) {
      await this.prisma.billingInvoice.findUniqueOrThrow({ where: { id } });
      throw notPending();
    }
    await this.audit.log({
      userId,
      action: 'BILLING_CANCEL',
      entity: 'BillingInvoice',
      entityId: id,
    });
    return this.prisma.billingInvoice.findUniqueOrThrow({ where: { id } });
  }

  /** Platform: invoices of every company. */
  listAll(
    q: PageQuery & {
      status?: InvoiceStatus;
      tenantId?: string;
      inReview?: boolean;
    },
  ) {
    return RequestContext.asPlatform(async () => {
      // In review: pending, with a slip sent after the last rejection.
      const where: Prisma.BillingInvoiceWhereInput = q.inReview
        ? {
            tenantId: q.tenantId,
            status: 'PENDING',
            slipAt: { not: null },
            OR: [
              { rejectedAt: null },
              { rejectedAt: { lt: this.prisma.billingInvoice.fields.slipAt } },
            ],
          }
        : { status: q.status, tenantId: q.tenantId };
      const [items, total] = await Promise.all([
        this.prisma.billingInvoice.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          include: {
            plan: { select: { code: true, name: true } },
            tenant: { select: { code: true, name: true } },
          },
          ...pageArgs(q),
        }),
        this.prisma.billingInvoice.count({ where }),
      ]);
      return toPage(
        items.map((i) => ({
          ...i,
          review: slipReview(i),
          transferReference: transferReference(i.tenant.code, i.number),
        })),
        total,
        q,
      );
    });
  }

  /**
   * Current company: a screenshot of the transfer for a pending invoice. A platform admin
   * checks it, then confirms (mark-paid) or rejects it with a reason; a new slip can follow.
   */
  async uploadSlip(
    invoiceId: string,
    file: { buffer: Buffer; mimetype: string; size: number },
    userId: string,
  ) {
    const inv = await this.prisma.billingInvoice.findUniqueOrThrow({
      where: { id: invoiceId },
    });
    if (inv.status !== 'PENDING') throw notPending();
    const slipUrl = await this.images.save('slips', file);
    const updated = await this.prisma.billingInvoice.update({
      where: { id: invoiceId },
      data: { slipUrl, slipAt: new Date() },
      include: { plan: { select: { code: true, name: true } } },
    });
    await this.audit.log({
      userId,
      action: 'BILLING_SLIP',
      entity: 'BillingInvoice',
      entityId: invoiceId,
      after: { slipUrl },
    });
    return { ...updated, review: slipReview(updated) };
  }

  /** Platform: the slip does not show the payment; the company is asked for a new one. */
  async rejectSlip(invoiceId: string, reason: string, platformAdminId: string) {
    const inv = await RequestContext.asPlatform(() =>
      this.prisma.billingInvoice.findUniqueOrThrow({
        where: { id: invoiceId },
      }),
    );
    if (slipReview(inv) !== 'IN_REVIEW')
      throw new ConflictException({
        message: 'This invoice has no slip waiting for review',
        code: 'SLIP_NOT_IN_REVIEW',
      });
    return RequestContext.withTenant(inv.tenantId, async () => {
      const updated = await this.prisma.billingInvoice.update({
        where: { id: invoiceId },
        data: { rejectReason: reason, rejectedAt: new Date() },
      });
      await this.audit.log({
        userId: null,
        action: 'BILLING_SLIP_REJECT',
        entity: 'BillingInvoice',
        entityId: invoiceId,
        after: { reason, platformAdminId },
      });
      return { ...updated, review: slipReview(updated) };
    });
  }

  /**
   * Records a payment and extends the subscription by the invoice's months from the
   * later of today and the current end. Paying twice does not extend twice.
   */
  async markPaid(
    invoiceId: string,
    payment: { method: string; reference?: string; amountLak?: number },
    actor: { platformAdminId?: string },
  ) {
    const invoice = await RequestContext.asPlatform(() =>
      this.prisma.billingInvoice.findUniqueOrThrow({
        where: { id: invoiceId },
        include: { plan: true, tenant: true },
      }),
    );
    if (
      payment.amountLak !== undefined &&
      !invoice.amountLak.equals(payment.amountLak)
    ) {
      throw new BadRequestException({
        message: `Amount does not match the invoice (${invoice.amountLak.toString()})`,
        code: 'AMOUNT_MISMATCH',
      });
    }
    return RequestContext.withTenant(invoice.tenantId, () =>
      this.prisma.$transaction(
        async (tx) => {
          const { count } = await tx.billingInvoice.updateMany({
            where: { id: invoiceId, status: 'PENDING' },
            data: {
              status: 'PAID',
              paidAt: new Date(),
              method: payment.method,
              reference: payment.reference,
            },
          });
          if (count === 0) throw notPending();
          const sub = await tx.subscription.findUniqueOrThrow({
            where: { tenantId: invoice.tenantId },
          });
          const now = new Date();
          const from =
            sub.currentPeriodEnd &&
            sub.currentPeriodEnd > now &&
            sub.status !== 'TRIAL'
              ? sub.currentPeriodEnd
              : now;
          const until = addMonths(from, invoice.months);
          await tx.subscription.update({
            where: { tenantId: invoice.tenantId },
            data: {
              planId: invoice.planId,
              status: 'ACTIVE',
              trialEndsAt: null,
              currentPeriodEnd: until,
            },
          });
          await this.audit.log(
            {
              userId: null,
              action: 'BILLING_PAID',
              entity: 'BillingInvoice',
              entityId: invoiceId,
              after: { ...payment, until, ...actor },
            },
            tx,
          );
          return {
            invoiceId,
            status: 'PAID' as const,
            currentPeriodEnd: until,
          };
        },
        { timeout: 30_000 },
      ),
    ).then(async (result) => {
      this.entitlements.invalidate(invoice.tenantId);
      if (invoice.tenant.email) {
        await this.mail
          .send(
            mailTemplates.invoicePaid(
              currentLang(),
              invoice.tenant.email,
              invoice.number,
              invoice.plan.name,
              result.currentPeriodEnd.toISOString().slice(0, 10),
            ),
          )
          .catch(() => undefined);
      }
      return result;
    });
  }

  /** Payment gateway callback, authenticated by an HMAC-SHA256 signature of the raw body. */
  async webhook(rawBody: Buffer | undefined, signature: string | undefined) {
    const secret = this.config.get('BILLING_WEBHOOK_SECRET', { infer: true });
    if (!secret) {
      throw new ForbiddenException({
        message: 'Online payment confirmation is not set up',
        code: 'WEBHOOK_DISABLED',
      });
    }
    const expected = `sha256=${createHmac('sha256', secret)
      .update(rawBody ?? '')
      .digest('hex')}`;
    if (
      !rawBody ||
      !signature ||
      signature.length !== expected.length ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    ) {
      throw new UnauthorizedException({
        message: 'Invalid signature',
        code: 'WEBHOOK_SIGNATURE_INVALID',
      });
    }
    let json: unknown;
    try {
      json = JSON.parse(rawBody.toString('utf8'));
    } catch {
      json = undefined;
    }
    const parsed = webhookBodySchema.safeParse(json);
    if (!parsed.success) throw new BadRequestException('Invalid webhook body');
    const body = parsed.data;
    try {
      return await this.markPaid(
        body.invoiceId,
        {
          method: 'ONLINE',
          reference: body.reference,
          amountLak: body.amountLak,
        },
        {},
      );
    } catch (error) {
      // Gateways retry: an already-paid invoice is a success.
      if (error instanceof ConflictException) {
        const inv = await RequestContext.asPlatform(() =>
          this.prisma.billingInvoice.findUnique({
            where: { id: body.invoiceId },
          }),
        );
        if (inv?.status === 'PAID')
          return { invoiceId: inv.id, status: 'PAID' as const };
      }
      throw error;
    }
  }
}
