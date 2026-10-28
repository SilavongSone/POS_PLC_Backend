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
  discountType: z.enum(['PERCENT', 'AMOUNT']),
  /** Percent (0–100) or LAK per unit. */
  value: z.coerce.number().positive().max(1e12),
  minQty: z.number().int().min(1).default(1),
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
