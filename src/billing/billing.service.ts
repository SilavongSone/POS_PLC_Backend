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
@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly docNumbers: DocNumberService,
    private readonly entitlements: EntitlementsService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** How to pay an invoice: bank details and, if configured, an online payment link. */
  private payment(inv: {
    id: string;
    number: string;
    amountLak: Prisma.Decimal;
  }) {
    const url = this.config.get('BILLING_PAY_URL', { infer: true });
    return {
      bankInfo: this.config.get('BILLING_BANK_INFO', { infer: true }) ?? null,
      payUrl: url
        ? url
            .replaceAll('{invoiceId}', inv.id)
            .replaceAll('{number}', encodeURIComponent(inv.number))
            .replaceAll('{amount}', inv.amountLak.toString())
        : null,
      /** Put this in the transfer note so the payment can be matched. */
      reference: inv.number,
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
    return { ...invoice, payment: this.payment(invoice) };
  }

  async list(q: PageQuery & { status?: InvoiceStatus }) {
    const where = { status: q.status };
    const [items, total] = await Promise.all([
      this.prisma.billingInvoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { plan: { select: { code: true, name: true } } },
        ...pageArgs(q),
      }),
      this.prisma.billingInvoice.count({ where }),
    ]);
    return toPage(
      items.map((i) => ({
        ...i,
        payment: i.status === 'PENDING' ? this.payment(i) : null,
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
  listAll(q: PageQuery & { status?: InvoiceStatus; tenantId?: string }) {
    return RequestContext.asPlatform(async () => {
      const where = { status: q.status, tenantId: q.tenantId };
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
      return toPage(items, total, q);
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
