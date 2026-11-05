import { BadRequestException, Injectable } from '@nestjs/common';
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
