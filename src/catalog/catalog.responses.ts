import { z } from 'zod';
import {
  apiSchema,
  currencySchema,
  dateTimeString,
  decimalString,
  i18nMap,
  pageOf,
} from '../common/openapi.js';

const productType = z.enum(['STANDARD', 'BUNDLE', 'SERVICE']);

/** A category row with its product count; `children` only with ?tree=true. */
export const categorySchema = apiSchema(
  'Category',
  z.strictObject({
    id: z.uuid(),
    tenantId: z.uuid(),
    /** In the request language (nameI18n keeps every translation). */
    name: z.string(),
    nameI18n: i18nMap,
    slug: z.string(),
    parentId: z.uuid().nullable(),
    sortOrder: z.int(),
    isActive: z.boolean(),
    productCount: z.int().min(0),
    get children(): z.ZodOptional<z.ZodArray<typeof categorySchema>> {
      return z.array(categorySchema).optional();
    },
  }),
);
export const categoriesSchema = z.array(categorySchema);

const productImage = z.strictObject({
  id: z.uuid(),
  productId: z.uuid(),
  url: z.string(),
  sortOrder: z.int(),
});

/** Product columns. Prices are in `priceCurrency`; *Lak fields are converted and rounded. */
const productFields = {
  id: z.uuid(),
  tenantId: z.uuid(),
  sku: z.string(),
  barcode: z.string().nullable(),
  /** In the request language (nameI18n keeps every translation). */
  name: z.string(),
  nameI18n: i18nMap,
  /** In the request language. */
  description: z.string().nullable(),
  descriptionI18n: i18nMap,
  type: productType,
  categoryId: z.uuid().nullable(),
  brandId: z.uuid().nullable(),
  model: z.string().nullable(),
  unit: z.string(),
  location: z.string().nullable(),
  specs: z.record(z.string(), z.string()).nullable(),
  priceCurrency: currencySchema,
  /** At the requested branch when `branchPrice` is true. */
  retailPrice: decimalString,
  wholesalePrice: decimalString.nullable(),
  wholesaleMinQty: z.int().nullable(),
  costCurrency: currencySchema
    .optional()
    .meta({ description: 'Only with the product.viewCost permission' }),
  costPrice: decimalString
    .optional()
    .meta({ description: 'Only with the product.viewCost permission' }),
  avgCostLak: decimalString
    .optional()
    .meta({ description: 'Only with the product.viewCost permission' }),
  trackStock: z.boolean(),
  /** Total on hand over all branches. */
  stockQty: z.int(),
  lowStockAlert: z.int(),
  trackSerial: z.boolean(),
  trackExpiry: z.boolean(),
  warrantyMonths: z.int(),
  taxRateId: z.uuid().nullable(),
  isActive: z.boolean(),
  createdAt: dateTimeString,
  updatedAt: dateTimeString,
  /** True when a branch price was applied (?branchId). */
  branchPrice: z.boolean(),
  retailPriceLak: decimalString,
  wholesalePriceLak: decimalString.nullable(),
};

export const productListItemSchema = apiSchema(
  'ProductListItem',
  z.strictObject({
    ...productFields,
    category: z
      .strictObject({ id: z.uuid(), name: z.string(), slug: z.string() })
      .nullable(),
    brand: z.strictObject({ id: z.uuid(), name: z.string() }).nullable(),
    /** The first image only. */
    images: z.array(productImage),
  }),
);
export const productPageSchema = apiSchema(
  'ProductPage',
  pageOf(productListItemSchema),
);

export const productDetailSchema = apiSchema(
  'ProductDetail',
  z.strictObject({
    ...productFields,
    category: z
      .strictObject({
        id: z.uuid(),
        name: z.string(),
        slug: z.string(),
        parentId: z.uuid().nullable(),
      })
      .nullable(),
    brand: z
      .strictObject({
        id: z.uuid(),
        name: z.string(),
        logoUrl: z.string().nullable(),
      })
      .nullable(),
    taxRate: z
      .strictObject({ id: z.uuid(), name: z.string(), percent: decimalString })
      .nullable(),
    images: z.array(productImage),
    /** Bundles only: the components. */
    bundleItems: z.array(
      z.strictObject({
        bundleId: z.uuid(),
        componentId: z.uuid(),
        quantity: z.int(),
        component: z.strictObject({
          id: z.uuid(),
          sku: z.string(),
          name: z.string(),
          stockQty: z.int(),
        }),
      }),
    ),
    /** Prices that differ by branch (in the product's price currency). */
    branchPrices: z.array(
      z.strictObject({
        branchId: z.uuid(),
        code: z.string(),
        name: z.string(),
        retailPrice: decimalString,
        wholesalePrice: decimalString.nullable(),
      }),
    ),
    /** On hand per branch; stockQty is the total. */
    branchStock: z.array(
      z.strictObject({
        id: z.uuid(),
        code: z.string(),
        name: z.string(),
        qty: z.int(),
      }),
    ),
    /** IN_STOCK serial numbers by condition (a key is present only when > 0). */
    serialsInStock: z.strictObject({
      NEW: z.int().optional(),
      DEMO: z.int().optional(),
    }),
    /** Demo units in stock, each with its own price (null = product price). */
    demoUnits: z.array(
      z.strictObject({
        id: z.uuid(),
        serial: z.string(),
        priceLak: decimalString.nullable(),
        branchId: z.uuid(),
      }),
    ),
  }),
);

export const productLookupSchema = apiSchema(
  'ProductLookup',
  z.strictObject({
    product: productDetailSchema,
    /** Set when the code matched a serial number rather than a barcode/SKU. */
    serial: z
      .strictObject({
        id: z.uuid(),
        serial: z.string(),
        status: z.enum([
          'IN_STOCK',
          'SOLD',
          'RETURNED',
          'IN_SERVICE',
          'DEFECTIVE',
          'ISSUED',
        ]),
        condition: z.enum(['NEW', 'DEMO']),
        priceLak: decimalString.nullable(),
        productId: z.uuid(),
        soldAt: dateTimeString.nullable(),
        warrantyEndsAt: dateTimeString.nullable(),
      })
      .nullable(),
  }),
);
