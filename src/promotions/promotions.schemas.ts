import { z } from 'zod';
import { i18nText } from '../i18n/i18n.schemas.js';
import { patchOf } from '../common/zod-validation.pipe.js';
import { queryBoolean } from '../common/pagination.js';

const target = z.union([
  z.strictObject({ productId: z.uuid() }),
  z.strictObject({ categoryId: z.uuid() }),
]);

const fields = {
  name: z.string().trim().min(1).max(100),
  nameI18n: i18nText(100).optional(),
  /**
   * DISCOUNT: buy ≥ minQty, every unit off by value · BUY_X_GET_Y: buy minQty, get getQty
   * (same product) off by value % (100 = free) · GIFT: buy minQty of the targets, get getQty
   * of the gift products off by value % (100 = free).
   */
  type: z.enum(['DISCOUNT', 'BUY_X_GET_Y', 'GIFT']).default('DISCOUNT'),
  discountType: z.enum(['PERCENT', 'AMOUNT']),
  /** Percent (0–100) or LAK per unit. */
  value: z.coerce.number().positive().max(1e12),
  minQty: z.number().int().min(1).default(1),
  getQty: z.number().int().min(1).max(1000).nullable().optional(),
  /** GIFT: products given (any mix, getQty per set). */
  gifts: z.array(z.uuid()).max(50).optional(),
  startsAt: z.iso.datetime({ offset: true }).transform((d) => new Date(d)),
  endsAt: z.iso
    .datetime({ offset: true })
    .transform((d) => new Date(d))
    .nullable()
    .optional(),
  isActive: z.boolean().default(true),
  /** Products or categories (incl. subcategories); empty = every product. */
  targets: z.array(target).max(500).default([]),
};

function rules<
  T extends z.ZodType<{
    type?: string;
    getQty?: number | null;
    gifts?: string[];
    discountType?: string;
    value?: number;
    startsAt?: Date;
    endsAt?: Date | null;
  }>,
>(schema: T) {
  return schema.superRefine((p, ctx) => {
    if (
      p.discountType === 'PERCENT' &&
      p.value !== undefined &&
      p.value > 100
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'A percentage cannot exceed 100',
        path: ['value'],
      });
    }
    if (p.type && p.type !== 'DISCOUNT') {
      if (p.discountType !== undefined && p.discountType !== 'PERCENT')
        ctx.addIssue({
          code: 'custom',
          message: 'Free units are a percentage off',
          path: ['discountType'],
        });
      if (!p.getQty)
        ctx.addIssue({
          code: 'custom',
          message: 'How many are given',
          path: ['getQty'],
        });
    }
    if (p.type === 'GIFT' && p.gifts !== undefined && !p.gifts.length)
      ctx.addIssue({
        code: 'custom',
        message: 'Choose the gift product',
        path: ['gifts'],
      });
    if (p.startsAt && p.endsAt && p.endsAt <= p.startsAt) {
      ctx.addIssue({
        code: 'custom',
        message: 'Must end after it starts',
        path: ['endsAt'],
      });
    }
  });
}

export const createPromotionSchema = rules(z.object(fields));
export const updatePromotionSchema = rules(patchOf(z.object(fields)));
export const listPromotionsSchema = z.object({
  /** Running now (active and within dates). */
  current: queryBoolean.optional(),
});

export type CreatePromotionInput = z.infer<typeof createPromotionSchema>;
export type UpdatePromotionInput = z.infer<typeof updatePromotionSchema>;
