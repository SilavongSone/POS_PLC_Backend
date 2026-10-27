import { z } from 'zod';
import { patchOf } from '../common/zod-validation.pipe.js';
import { pageQuerySchema, queryBoolean } from '../common/pagination.js';

const text = (max: number) => z.string().trim().max(max);
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase letters, digits and dashes');
const money = z.coerce.number().min(0).max(1e15).multipleOf(0.01);
export const currency = z.enum(['LAK', 'THB', 'USD']);

// ── Categories & brands ──
export const createCategorySchema = z.object({
  name: text(100).min(1),
  slug: slug.optional(),
  parentId: z.uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  isActive: z.boolean().default(true),
});
export const updateCategorySchema = patchOf(createCategorySchema);
export const listCategoriesSchema = z.object({ tree: queryBoolean.optional() });

export const createBrandSchema = z.object({
  name: text(100).min(1),
  logoUrl: text(500).nullable().optional(),
});
export const updateBrandSchema = patchOf(createBrandSchema);

// ── Products ──
const productFields = {
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9._-]{1,49}$/, 'SKU: letters, digits, . _ -'),
  barcode: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z-]{4,50}$/)
    .nullable()
    .optional(),
  name: text(200).min(1),
  description: text(5000).nullable().optional(),
  type: z.enum(['STANDARD', 'BUNDLE', 'SERVICE']).default('STANDARD'),
  categoryId: z.uuid().nullable().optional(),
  brandId: z.uuid().nullable().optional(),
  model: text(100).nullable().optional(),
  unit: text(20).min(1).default('pcs'),
  location: text(50).nullable().optional(),
  specs: z
    .record(z.string().max(100), z.string().max(500))
    .nullable()
    .optional(),
  priceCurrency: currency.default('LAK'),
  retailPrice: money,
  wholesalePrice: money.nullable().optional(),
  wholesaleMinQty: z.number().int().min(1).nullable().optional(),
  costCurrency: currency.default('LAK'),
  costPrice: money.default(0),
  trackStock: z.boolean().default(true),
  lowStockAlert: z.number().int().min(0).default(0),
  trackSerial: z.boolean().default(false),
  trackExpiry: z.boolean().default(false),
  warrantyMonths: z.number().int().min(0).max(120).default(0),
  taxRateId: z.uuid().nullable().optional(),
  isActive: z.boolean().default(true),
};

type ProductFlags = {
  type?: string;
  trackSerial?: boolean;
  trackExpiry?: boolean;
};

function productRules<T extends z.ZodType<ProductFlags>>(schema: T) {
  return schema.superRefine((p, ctx) => {
    if (p.type === 'SERVICE' && (p.trackSerial || p.trackExpiry)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Services have no serials or lots',
        path: ['type'],
      });
    }
    if (p.trackSerial && p.trackExpiry) {
      ctx.addIssue({
        code: 'custom',
        message: 'Use either serials or expiry lots, not both',
        path: ['trackExpiry'],
      });
    }
  });
}

export const createProductSchema = productRules(z.object(productFields));
export const updateProductSchema = productRules(
  patchOf(z.object(productFields)).omit({ sku: true }),
);

export const listProductsSchema = pageQuerySchema.extend({
  categoryId: z.uuid().optional(),
  brandId: z.uuid().optional(),
  type: z.enum(['STANDARD', 'BUNDLE', 'SERVICE']).optional(),
  isActive: queryBoolean.optional(),
  /** Only products at or below their low-stock alert. */
  lowStock: queryBoolean.optional(),
  inStock: queryBoolean.optional(),
  sort: z.enum(['name', 'sku', 'stockQty', 'updatedAt']).default('name'),
});

export const lookupSchema = z.object({
  code: z.string().trim().min(1).max(100),
});

export const bulkPriceSchema = z
  .object({
    productIds: z.array(z.uuid()).min(1).max(1000).optional(),
    categoryId: z.uuid().optional(),
    brandId: z.uuid().optional(),
    /** e.g. 5 = +5 %, -10 = −10 % */
    percent: z.number().min(-90).max(500),
    field: z.enum(['retail', 'wholesale', 'both']).default('retail'),
  })
  .refine((v) => v.productIds || v.categoryId || v.brandId, {
    message: 'Choose productIds, categoryId or brandId',
  });

export const setPricesSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.uuid(),
        retailPrice: money.optional(),
        wholesalePrice: money.nullable().optional(),
      }),
    )
    .min(1)
    .max(1000),
});

export const reorderImagesSchema = z.object({
  imageIds: z.array(z.uuid()).min(1),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type CreateBrandInput = z.infer<typeof createBrandSchema>;
export type UpdateBrandInput = z.infer<typeof updateBrandSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ListProductsQuery = z.infer<typeof listProductsSchema>;
export type BulkPriceInput = z.infer<typeof bulkPriceSchema>;
export type SetPricesInput = z.infer<typeof setPricesSchema>;

export const bundleItemsSchema = z.object({
  items: z
    .array(
      z.object({
        componentId: z.uuid(),
        quantity: z.number().int().min(1).max(1000),
      }),
    )
    .min(1)
    .max(50),
});
export type BundleItemsInput = z.infer<typeof bundleItemsSchema>;
