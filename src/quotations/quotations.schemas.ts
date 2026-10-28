import { z } from 'zod';
import { pageQuerySchema } from '../common/pagination.js';
import { paymentSchema } from '../sales/sales.schemas.js';

const lakAmount = z.coerce.number().int().min(0).max(1e15);
const isoDate = z.iso.date().transform((d) => new Date(`${d}T00:00:00Z`));

export const quotationSchema = z.object({
  customerId: z.uuid(),
  /** Branch quoting: its own prices apply. */
  branchId: z.uuid().optional(),
  validUntil: isoDate,
  priceTier: z.enum(['RETAIL', 'WHOLESALE']).optional(),
  items: z
    .array(
      z.object({
        productId: z.uuid(),
        quantity: z.number().int().min(1).max(100_000),
        /** Quoted unit price; defaults to the current price. */
        unitPriceLak: lakAmount.optional(),
        discountLak: lakAmount.default(0),
        description: z.string().trim().max(200).optional(),
      }),
    )
    .min(1)
    .max(200),
  discountLak: lakAmount.default(0),
  note: z.string().trim().max(2000).optional(),
});

export const quotationStatusSchema = z.object({
  status: z.enum(['SENT', 'ACCEPTED', 'REJECTED']),
});

export const convertQuotationSchema = z.object({
  registerId: z.uuid(),
  payments: z.array(paymentSchema).min(1).max(10),
  /** Serials scanned at hand-over, per quotation line. */
  lines: z
    .array(
      z.object({
        quotationItemId: z.uuid(),
        serials: z.array(z.string().trim().min(1)).optional(),
        componentSerials: z
          .record(z.uuid(), z.array(z.string().trim().min(1)))
          .optional(),
      }),
    )
    .default([]),
  dueDate: z.iso
    .date()
    .transform((d) => new Date(`${d}T00:00:00Z`))
    .optional(),
  note: z.string().trim().max(500).optional(),
});

export const listQuotationsSchema = pageQuerySchema.extend({
  customerId: z.uuid().optional(),
  status: z
    .enum(['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED'])
    .optional(),
});

export type QuotationInput = z.infer<typeof quotationSchema>;
export type ConvertQuotationInput = z.infer<typeof convertQuotationSchema>;
export type ListQuotationsQuery = z.infer<typeof listQuotationsSchema>;
