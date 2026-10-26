import { z } from 'zod';
import { pageQuerySchema } from '../common/pagination.js';

const text = (max: number) => z.string().trim().max(max);
const isoDate = z.iso.date().transform((d) => new Date(`${d}T00:00:00Z`));

export const createSupplierSchema = z.object({
  name: text(150).min(1),
  phone: text(50).nullable().optional(),
  email: z.email().nullable().optional(),
  address: text(300).nullable().optional(),
  taxId: text(30).nullable().optional(),
  isActive: z.boolean().default(true),
});
export const updateSupplierSchema = createSupplierSchema.partial();
export const listSuppliersSchema = pageQuerySchema;

const docItem = z.object({
  productId: z.uuid(),
  /** Positive for RECEIVE/ISSUE; signed (±) for ADJUST. */
  quantity: z
    .number()
    .int()
    .refine((n) => n !== 0, 'Quantity cannot be 0'),
  /** Unit cost in the document currency (RECEIVE). */
  unitCost: z.coerce.number().min(0).multipleOf(0.01).default(0),
  condition: z.enum(['NEW', 'DEMO']).default('NEW'),
  serials: z.array(text(100).min(1)).max(1000).optional(),
  lotNo: text(50).nullable().optional(),
  expiryDate: isoDate.nullable().optional(),
});

export const stockDocSchema = z
  .object({
    type: z.enum(['RECEIVE', 'ISSUE', 'ADJUST']),
    supplierId: z.uuid().nullable().optional(),
    /** Supplier invoice no. for RECEIVE, reason for ISSUE/ADJUST. */
    reference: text(100).nullable().optional(),
    note: text(1000).nullable().optional(),
    currency: z.enum(['LAK', 'THB', 'USD']).default('LAK'),
    /** Defaults to the current rate for the currency. */
    lakPerUnit: z.coerce.number().positive().optional(),
    items: z.array(docItem).min(1).max(500),
  })
  .superRefine((doc, ctx) => {
    if (doc.type !== 'RECEIVE' && doc.supplierId) {
      ctx.addIssue({
        code: 'custom',
        message: 'Only receipts have a supplier',
        path: ['supplierId'],
      });
    }
    if (doc.type !== 'ADJUST') {
      doc.items.forEach((item, i) => {
        if (item.quantity < 0) {
          ctx.addIssue({
            code: 'custom',
            message: 'Quantity must be positive',
            path: ['items', i, 'quantity'],
          });
        }
      });
    }
    if (doc.type !== 'ADJUST' && !doc.reference && doc.type === 'ISSUE') {
      ctx.addIssue({
        code: 'custom',
        message: 'Give a reason for the issue',
        path: ['reference'],
      });
    }
  });

export const listStockDocsSchema = pageQuerySchema.extend({
  type: z.enum(['RECEIVE', 'ISSUE', 'ADJUST']).optional(),
  status: z.enum(['DRAFT', 'POSTED', 'CANCELLED']).optional(),
  supplierId: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const cancelDocSchema = z.object({ reason: text(300).min(1) });

export const listMovementsSchema = pageQuerySchema.extend({
  productId: z.uuid().optional(),
  type: z
    .enum([
      'RECEIVE_IN',
      'ISSUE_OUT',
      'ADJUST_IN',
      'ADJUST_OUT',
      'SALE_OUT',
      'RETURN_IN',
      'VOID_IN',
    ])
    .optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const listSerialsSchema = pageQuerySchema.extend({
  productId: z.uuid().optional(),
  status: z
    .enum(['IN_STOCK', 'SOLD', 'RETURNED', 'IN_SERVICE', 'DEFECTIVE', 'ISSUED'])
    .optional(),
  condition: z.enum(['NEW', 'DEMO']).optional(),
});

export const updateSerialSchema = z.object({
  condition: z.enum(['NEW', 'DEMO']).optional(),
  /** Own selling price for this unit (e.g. a demo unit); null = product price. */
  priceLak: z.coerce.number().int().min(0).nullable().optional(),
  supplierWarrantyEndsAt: isoDate.nullable().optional(),
});

export const expiringLotsSchema = pageQuerySchema.extend({
  productId: z.uuid().optional(),
  withinDays: z.coerce.number().int().min(0).max(3650).default(30),
});

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
export type StockDocInput = z.infer<typeof stockDocSchema>;
export type ListStockDocsQuery = z.infer<typeof listStockDocsSchema>;
export type ListMovementsQuery = z.infer<typeof listMovementsSchema>;
export type ListSerialsQuery = z.infer<typeof listSerialsSchema>;
export type UpdateSerialInput = z.infer<typeof updateSerialSchema>;
