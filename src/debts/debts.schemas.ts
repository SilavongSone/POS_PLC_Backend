import { z } from 'zod';
import { pageQuerySchema } from '../common/pagination.js';

const isoDate = z.iso.date();

export const receiveDebtSchema = z.object({
  customerId: z.uuid(),
  /** Pay one sale; without it the oldest debts are paid first. */
  saleId: z.uuid().optional(),
  paymentTypeId: z.uuid(),
  currency: z.enum(['LAK', 'THB', 'USD']).default('LAK'),
  amount: z.coerce.number().positive().max(1e15).multipleOf(0.01),
  reference: z.string().trim().max(100).optional(),
});

export const listDebtPaymentsSchema = pageQuerySchema.extend({
  customerId: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export type ReceiveDebtInput = z.infer<typeof receiveDebtSchema>;
export type ListDebtPaymentsQuery = z.infer<typeof listDebtPaymentsSchema>;
