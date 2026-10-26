import { z } from 'zod';
import { pageQuerySchema } from '../common/pagination.js';

const text = (max: number) => z.string().trim().max(max);
const lakAmount = z.coerce.number().int().min(0).max(1e15);
const isoDate = z.iso.date().transform((d) => new Date(`${d}T00:00:00Z`));

export const saleItemSchema = z.object({
  productId: z.uuid(),
  quantity: z.number().int().min(1).max(100_000),
  /** Required for serialized products: one per unit. */
  serials: z.array(text(100).min(1)).max(1000).optional(),
  /** Manual unit price (needs price.override). */
  unitPriceLak: lakAmount.optional(),
  /** Manual discount for the whole line (needs sale.discount). */
  discountLak: lakAmount.default(0),
});

export const paymentSchema = z.object({
  paymentTypeId: z.uuid(),
  currency: z.enum(['LAK', 'THB', 'USD']).default('LAK'),
  /** Amount tendered in `currency`. */
  amount: z.coerce.number().positive().max(1e15).multipleOf(0.01),
  reference: text(100).optional(),
});

export const createSaleSchema = z.object({
  registerId: z.uuid(),
  customerId: z.uuid().nullable().optional(),
  /** Defaults to the customer's tier (RETAIL without a customer). */
  priceTier: z.enum(['RETAIL', 'WHOLESALE']).optional(),
  items: z.array(saleItemSchema).min(1).max(200),
  /** Whole-bill discount (needs sale.discount). */
  discountLak: lakAmount.default(0),
  payments: z.array(paymentSchema).min(1).max(10),
  note: text(500).optional(),
  dueDate: isoDate.optional(),
  /** Manager approvals by permission, from POST /auth/approve. */
  approvals: z
    .partialRecord(z.enum(['price.override', 'sale.discount']), z.string())
    .default({}),
  /** Held bill to delete once the sale is saved. */
  heldBillId: z.uuid().optional(),
  quotationId: z.uuid().optional(),
});

export const quoteSaleSchema = createSaleSchema
  .omit({ payments: true, heldBillId: true })
  .extend({ payments: z.array(paymentSchema).max(10).default([]) });

export const listSalesSchema = pageQuerySchema.extend({
  from: isoDate.optional(),
  to: isoDate.optional(),
  status: z.enum(['COMPLETED', 'VOIDED']).optional(),
  paymentStatus: z.enum(['PAID', 'PARTIAL', 'UNPAID']).optional(),
  customerId: z.uuid().optional(),
  registerId: z.uuid().optional(),
  cashierId: z.uuid().optional(),
  shiftId: z.uuid().optional(),
});

export const voidSaleSchema = z.object({
  reason: text(300).min(1),
  approvalToken: z.string().optional(),
});

export const heldBillSchema = z.object({
  label: text(100).optional(),
  customerId: z.uuid().nullable().optional(),
  /** Cart snapshot from the till (items, discounts, note). */
  cart: z
    .object({
      items: z.array(saleItemSchema.partial({ discountLak: true })).min(1),
    })
    .loose(),
});

export const issueTaxInvoiceSchema = z.object({
  buyerName: text(150).min(1).optional(),
  buyerTaxId: text(30).optional(),
  buyerAddress: text(300).optional(),
  buyerPhone: text(30).optional(),
});

export const cancelTaxInvoiceSchema = z.object({ reason: text(300).min(1) });

export const listTaxInvoicesSchema = pageQuerySchema.extend({
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export type SaleItemInput = z.infer<typeof saleItemSchema>;
export type PaymentInput = z.infer<typeof paymentSchema>;
export type CreateSaleInput = z.infer<typeof createSaleSchema>;
export type QuoteSaleInput = z.infer<typeof quoteSaleSchema>;
export type ListSalesQuery = z.infer<typeof listSalesSchema>;
export type HeldBillInput = z.infer<typeof heldBillSchema>;
export type IssueTaxInvoiceInput = z.infer<typeof issueTaxInvoiceSchema>;
export type ListTaxInvoicesQuery = z.infer<typeof listTaxInvoicesSchema>;
