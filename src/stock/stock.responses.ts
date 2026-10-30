import { z } from 'zod';
import {
  apiSchema,
  currencySchema,
  dateTimeString,
  decimalString,
  pageOf,
} from '../common/openapi.js';

const branchRef = z.strictObject({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
});
const userRef = z.strictObject({ id: z.uuid(), fullName: z.string() });
const productRef = z.strictObject({
  id: z.uuid(),
  sku: z.string(),
  name: z.string(),
});
const condition = z.enum(['NEW', 'DEMO']);
const serialStatus = z.enum([
  'IN_STOCK',
  'SOLD',
  'RETURNED',
  'IN_SERVICE',
  'DEFECTIVE',
  'ISSUED',
]);

// ── Suppliers & brands ──

export const supplierSchema = apiSchema(
  'Supplier',
  z.strictObject({
    id: z.uuid(),
    tenantId: z.uuid(),
    name: z.string(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    address: z.string().nullable(),
    taxId: z.string().nullable(),
    isActive: z.boolean(),
    createdAt: dateTimeString,
  }),
);
export const supplierPageSchema = apiSchema(
  'SupplierPage',
  pageOf(supplierSchema),
);

export const brandSchema = apiSchema(
  'Brand',
  z.strictObject({
    id: z.uuid(),
    tenantId: z.uuid(),
    name: z.string(),
    logoUrl: z.string().nullable(),
    productCount: z.int(),
  }),
);
export const brandsSchema = z.array(brandSchema);

// ── Stock documents ──

const docFields = {
  id: z.uuid(),
  branchId: z.uuid(),
  toBranchId: z.uuid().nullable(),
  tenantId: z.uuid(),
  docNo: z.string(),
  type: z.enum(['RECEIVE', 'ISSUE', 'ADJUST', 'TRANSFER']),
  status: z.enum(['DRAFT', 'POSTED', 'CANCELLED']),
  supplierId: z.uuid().nullable(),
  /** Supplier invoice no. (receipts) or reason (issues, adjustments). */
  reference: z.string().nullable(),
  note: z.string().nullable(),
  currency: currencySchema,
  lakPerUnit: decimalString,
  totalLak: decimalString,
  createdById: z.uuid(),
  postedAt: dateTimeString.nullable(),
  createdAt: dateTimeString,
  branch: branchRef,
  toBranch: branchRef.nullable(),
  supplier: z.strictObject({ id: z.uuid(), name: z.string() }).nullable(),
  createdBy: userRef,
};

export const stockDocListItemSchema = apiSchema(
  'StockDocumentListItem',
  z.strictObject({
    ...docFields,
    _count: z.strictObject({ items: z.int() }),
  }),
);
export const stockDocPageSchema = apiSchema(
  'StockDocumentPage',
  pageOf(stockDocListItemSchema),
);

export const stockDocDetailSchema = apiSchema(
  'StockDocument',
  z.strictObject({
    ...docFields,
    items: z.array(
      z.strictObject({
        id: z.uuid(),
        documentId: z.uuid(),
        productId: z.uuid(),
        /** Signed for adjustments. */
        quantity: z.int(),
        /** In the document currency. */
        unitCost: decimalString,
        unitCostLak: decimalString,
        condition,
        lotNo: z.string().nullable(),
        expiryDate: dateTimeString.nullable(),
        /** Serials typed on a draft, created when it is posted. */
        draftSerials: z.array(z.string()),
        product: z.strictObject({
          id: z.uuid(),
          sku: z.string(),
          name: z.string(),
          trackSerial: z.boolean(),
          trackExpiry: z.boolean(),
          unit: z.string(),
        }),
        serials: z.array(
          z.strictObject({
            id: z.uuid(),
            serial: z.string(),
            status: serialStatus,
            condition,
          }),
        ),
      }),
    ),
  }),
);

// ── Stock card and serials ──

export const stockMovementSchema = apiSchema(
  'StockMovement',
  z.strictObject({
    id: z.uuid(),
    branchId: z.uuid(),
    tenantId: z.uuid(),
    productId: z.uuid(),
    type: z.enum([
      'RECEIVE_IN',
      'ISSUE_OUT',
      'ADJUST_IN',
      'ADJUST_OUT',
      'SALE_OUT',
      'RETURN_IN',
      'VOID_IN',
      'TRANSFER_OUT',
      'TRANSFER_IN',
    ]),
    /** Signed: + in, − out. */
    quantity: z.int(),
    /** Branch stock after this movement. */
    balanceAfter: z.int(),
    unitCostLak: decimalString
      .nullable()
      .optional()
      .meta({ description: 'Only with the product.viewCost permission' }),
    serialId: z.uuid().nullable(),
    lotId: z.uuid().nullable(),
    /** What caused it, e.g. "Sale" or "StockDocument", and its id. */
    refType: z.string(),
    refId: z.string(),
    userId: z.uuid(),
    createdAt: dateTimeString,
    product: productRef,
    serial: z.strictObject({ serial: z.string() }).nullable(),
    lot: z
      .strictObject({
        lotNo: z.string().nullable(),
        expiryDate: dateTimeString.nullable(),
      })
      .nullable(),
    user: userRef,
  }),
);
export const stockMovementPageSchema = apiSchema(
  'StockMovementPage',
  pageOf(stockMovementSchema),
);

export const serialNumberSchema = apiSchema(
  'SerialNumber',
  z.strictObject({
    id: z.uuid(),
    branchId: z.uuid(),
    tenantId: z.uuid(),
    serial: z.string(),
    productId: z.uuid(),
    status: serialStatus,
    condition,
    /** Own price for this unit (demo units); null = product price. */
    priceLak: decimalString.nullable(),
    costLak: decimalString
      .nullable()
      .optional()
      .meta({ description: 'Only with the product.viewCost permission' }),
    receivedItemId: z.uuid().nullable(),
    saleItemId: z.uuid().nullable(),
    soldAt: dateTimeString.nullable(),
    warrantyEndsAt: dateTimeString.nullable(),
    supplierWarrantyEndsAt: dateTimeString.nullable(),
    createdAt: dateTimeString,
    product: productRef,
  }),
);
export const serialPageSchema = apiSchema(
  'SerialNumberPage',
  pageOf(serialNumberSchema),
);
