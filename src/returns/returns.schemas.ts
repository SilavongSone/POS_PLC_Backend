import { z } from 'zod';
import { pageQuerySchema } from '../common/pagination.js';

export const createReturnSchema = z.object({
  reason: z.string().trim().min(1).max(300),
  /** How the money goes back. A CREDIT type lowers the customer's debt instead. */
  paymentTypeId: z.uuid(),
  items: z
    .array(
      z.object({
        saleItemId: z.uuid(),
        quantity: z.number().int().min(1),
        serials: z.array(z.string().trim().min(1)).optional(),
        /** false = defective: recorded, not put back on sale. */
        restock: z.boolean().default(true),
      }),
    )
    .min(1),
  approvalToken: z.string().optional(),
});

export const listReturnsSchema = pageQuerySchema.extend({
  saleId: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

export type CreateReturnInput = z.infer<typeof createReturnSchema>;
export type ListReturnsQuery = z.infer<typeof listReturnsSchema>;
