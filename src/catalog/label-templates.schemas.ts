import { z } from 'zod';
import { patchOf } from '../common/zod-validation.pipe.js';

/** Millimetres, kept to 0.1 mm (finer than a 203 dpi printer dot is useless). */
const mm = (min: number, max: number) =>
  z
    .number()
    .min(min)
    .max(max)
    .transform((n) => Math.round(n * 10) / 10);

/** What a box on the label shows; the print page fills it from the product/serial. */
export const labelElementType = z.enum([
  'shop',
  'name',
  'brand',
  'model',
  'sku',
  'code',
  'barcode',
  'qr',
  'price',
  'serial',
  'unit',
  'condition',
  'text',
]);

export const labelElementSchema = z.strictObject({
  /** Client-made key, unique within the template. */
  id: z.string().min(1).max(40),
  type: labelElementType,
  x: mm(0, 150),
  y: mm(0, 150),
  w: mm(1, 150),
  h: mm(1, 150),
  /** Points; ignored by barcode/QR boxes. */
  fontSize: z.number().min(4).max(40).default(8),
  bold: z.boolean().default(false),
  align: z.enum(['left', 'center', 'right']).default('left'),
  /** Fixed text for `text` boxes; a prefix such as "S/N " for the others. */
  text: z.string().trim().max(100).default(''),
  /** Clockwise turn of the content inside the box (x/y/w/h stay the box on the label). */
  rotation: z
    .union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])
    .default(0),
});

export const createLabelTemplateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  widthMm: mm(10, 150),
  heightMm: mm(10, 150),
  columns: z.number().int().min(1).max(4).default(1),
  gapMm: mm(0, 20).default(2),
  marginMm: mm(0, 20).default(0),
  elements: z
    .array(labelElementSchema)
    .max(30)
    .refine(
      (els) => new Set(els.map((e) => e.id)).size === els.length,
      'Element ids must be unique',
    ),
  isDefault: z.boolean().default(false),
});
export const updateLabelTemplateSchema = patchOf(createLabelTemplateSchema);

export type CreateLabelTemplateInput = z.infer<
  typeof createLabelTemplateSchema
>;
export type UpdateLabelTemplateInput = z.infer<
  typeof updateLabelTemplateSchema
>;
