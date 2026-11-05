import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { z } from 'zod';
import { ImageStoreService } from '../common/image-store.service.js';
import { patchOf } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const bankAccountSchema = z.object({
  bankName: z.string().trim().min(1).max(80),
  accountName: z.string().trim().min(1).max(120),
  accountNumber: z.string().trim().min(1).max(60),
  /** URL from POST /platform/uploads/bank-qr. */
  qrImageUrl: z.string().trim().max(300).nullish(),
  note: z.string().trim().max(300).nullish(),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});
export const updateBankAccountSchema = patchOf(bankAccountSchema);
export type BankAccountInput = z.infer<typeof bankAccountSchema>;
export type UpdateBankAccountInput = z.infer<typeof updateBankAccountSchema>;

export const PLAN_MONTHS = [1, 3, 6, 12] as const;
export const planQrSchema = z.object({
  planId: z.uuid(),
  months: z.union(PLAN_MONTHS.map((m) => z.literal(m))),
  bankAccountId: z.uuid(),
  /** URL from POST /platform/uploads/bank-qr. */
  qrImageUrl: z.string().trim().min(1).max(300),
});
export type PlanQrInput = z.infer<typeof planQrSchema>;

/** Price of `months` of a plan: 12 months use the yearly price. */
export function planAmount(
  plan: { priceMonthlyLak: Prisma.Decimal; priceYearlyLak: Prisma.Decimal },
  months: number,
) {
  return months === 12
    ? plan.priceYearlyLak
    : plan.priceMonthlyLak.mul(months);
}

export type PayOptions = Awaited<ReturnType<BankAccountsService['payOptions']>>;

/**
 * Bank accounts companies pay their plan into, with the QR code their banking app scans.
 * Platform-wide (no company), managed by the Super Admin.
 */
@Injectable()
export class BankAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly images: ImageStoreService,
  ) {}

  list() {
    return this.prisma.platformBankAccount.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** What a company sees in its pay dialog. */
  listActive() {
    return this.prisma.platformBankAccount.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        bankName: true,
        accountName: true,
        accountNumber: true,
        qrImageUrl: true,
        note: true,
      },
    });
  }

  /** Everything a company's pay dialog needs: active accounts and their plan QR codes. */
  async payOptions() {
    const [accounts, planQrs] = await Promise.all([
      this.listActive(),
      this.prisma.platformPlanQr.findMany({
        where: { bankAccount: { isActive: true } },
        orderBy: { bankAccount: { sortOrder: 'asc' } },
        select: {
          id: true,
          planId: true,
          months: true,
          bankAccountId: true,
          amountLak: true,
          qrImageUrl: true,
        },
      }),
    ]);
    return { accounts, planQrs };
  }

  /**
   * Super Admin: every plan with its price per period and the QR codes saved for it.
   * `outdated` = the plan price changed after the QR was made (it is no longer shown).
   */
  async planQrs() {
    const [plans, qrs] = await Promise.all([
      this.prisma.plan.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          code: true,
          name: true,
          priceMonthlyLak: true,
          priceYearlyLak: true,
        },
      }),
      this.prisma.platformPlanQr.findMany(),
    ]);
    return plans.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      periods: PLAN_MONTHS.map((months) => {
        const amountLak = planAmount(p, months);
        return {
          months,
          amountLak,
          qrs: qrs
            .filter((q) => q.planId === p.id && q.months === months)
            .map((q) => ({
              id: q.id,
              bankAccountId: q.bankAccountId,
              qrImageUrl: q.qrImageUrl,
              amountLak: q.amountLak,
              outdated: !q.amountLak.equals(amountLak),
            })),
        };
      }),
    }));
  }

  /** Saves (or replaces) the QR of one plan, period and account at the current plan price. */
  async savePlanQr(input: PlanQrInput) {
    this.assertQr(input.qrImageUrl);
    const plan = await this.prisma.plan.findUnique({
      where: { id: input.planId },
    });
    const account = await this.prisma.platformBankAccount.findUnique({
      where: { id: input.bankAccountId },
    });
    if (!plan || !account) throw new NotFoundException('Plan or account not found');
    const amountLak = planAmount(plan, input.months);
    if (amountLak.lte(0))
      throw new BadRequestException({
        message: 'This plan is free; ask support to switch to it',
        code: 'PLAN_FREE',
      });
    const key = {
      planId: input.planId,
      months: input.months,
      bankAccountId: input.bankAccountId,
    };
    return this.prisma.platformPlanQr.upsert({
      where: { planId_months_bankAccountId: key },
      create: { ...key, amountLak, qrImageUrl: input.qrImageUrl },
      update: { amountLak, qrImageUrl: input.qrImageUrl },
    });
  }

  async removePlanQr(id: string) {
    await this.prisma.platformPlanQr.delete({ where: { id } });
  }

  private assertQr(url: string | null | undefined) {
    if (url && !this.images.isPlatform(url))
      throw new BadRequestException({
        message: 'Upload the image first',
        code: 'IMAGE_NOT_UPLOADED',
      });
  }

  create(input: BankAccountInput) {
    this.assertQr(input.qrImageUrl);
    return this.prisma.platformBankAccount.create({ data: input });
  }

  update(id: string, input: UpdateBankAccountInput) {
    this.assertQr(input.qrImageUrl);
    return this.prisma.platformBankAccount.update({
      where: { id },
      data: input,
    });
  }

  async remove(id: string) {
    await this.prisma.platformBankAccount.delete({ where: { id } });
  }
}
