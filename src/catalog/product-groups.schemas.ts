import { z } from 'zod';
import { i18nText } from '../i18n/i18n.schemas.js';

const text = (max: number) => z.string().trim().max(max);
const money = z.coerce.number().min(0).max(1e15).multipleOf(0.01);
/** "USB+LAN", "80×80", "ສີດຳ": what tells one version from the others. */
const value = text(50).min(1);

const uniqueValues = <T extends { value: string }>(items: T[]) =>
  new Set(items.map((i) => i.value.toLowerCase())).size === items.length;

export const newVariantSchema = z.object({
  value,
  /** Leave out: the copied product's SKU + "-" + the value. */
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9._-]{1,49}$/)
    .optional(),
  barcode: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z-]{4,50}$/)
    .nullable()
    .optional(),
  /** Leave out: the copied product's price. */
  retailPrice: money.optional(),
  /** Product the new version copies (default: the group's first version). */
  copyFrom: z.uuid().optional(),
});
export type NewVariantInput = z.infer<typeof newVariantSchema>;

/**
 * POST /product-groups: existing products become versions of one model (the first gives
 * the shared category, brand, description and warranty), plus new versions copied from it.
 */
export const createProductGroupSchema = z
  .object({
    name: text(150).min(1),
    nameI18n: i18nText(150).optional(),
    optionName: text(30).min(1),
    products: z
      .array(z.object({ productId: z.uuid(), value }))
      .min(1)
      .max(50)
      .refine(
        (p) => new Set(p.map((x) => x.productId)).size === p.length,
        'A product is listed twice',
      ),
    newVariants: z.array(newVariantSchema).max(50).default([]),
  })
  .refine((g) => uniqueValues([...g.products, ...g.newVariants]), {
    message: 'Each version needs a different value',
    path: ['products'],
  });
export type CreateProductGroupInput = z.infer<typeof createProductGroupSchema>;

export const updateProductGroupSchema = z.object({
  name: text(150).min(1).optional(),
  nameI18n: i18nText(150).optional(),
  optionName: text(30).min(1).optional(),
  /** Rename versions and set their order (first to last). */
  variants: z
    .array(z.object({ productId: z.uuid(), value }))
    .max(50)
    .refine(uniqueValues, 'Each version needs a different value')
    .optional(),
});
export type UpdateProductGroupInput = z.infer<typeof updateProductGroupSchema>;
