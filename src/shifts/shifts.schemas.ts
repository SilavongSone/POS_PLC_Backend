import { z } from 'zod';
import { pageQuerySchema } from '../common/pagination.js';

const amount = z.coerce.number().min(0).max(1e13).multipleOf(0.01);

/** Cash counted per currency; missing currencies count as 0. */
export const cashCountSchema = z
  .object({ LAK: amount.int(), THB: amount, USD: amount })
  .partial()
  .transform((c) => ({ LAK: c.LAK ?? 0, THB: c.THB ?? 0, USD: c.USD ?? 0 }));

export const openShiftSchema = z.object({
  registerId: z.uuid(),
  openingCash: cashCountSchema,
});

export const closeShiftSchema = z.object({
  closingCash: cashCountSchema,
  note: z.string().trim().max(1000).optional(),
});

export const cashMovementSchema = z
  .object({
    type: z.enum(['PAY_IN', 'PAY_OUT']),
    currency: z.enum(['LAK', 'THB', 'USD']),
    amount: amount.positive(),
    reason: z.string().trim().min(1).max(300),
  })
  .refine((m) => m.currency !== 'LAK' || Number.isInteger(m.amount), {
    message: 'LAK amounts are whole kip',
    path: ['amount'],
  });

export const listShiftsSchema = pageQuerySchema.extend({
  registerId: z.uuid().optional(),
  branchId: z.uuid().optional(),
  userId: z.uuid().optional(),
  status: z.enum(['OPEN', 'CLOSED']).optional(),
});

export type CashCount = z.infer<typeof cashCountSchema>;
export type OpenShiftInput = z.infer<typeof openShiftSchema>;
export type CloseShiftInput = z.infer<typeof closeShiftSchema>;
export type CashMovementInput = z.infer<typeof cashMovementSchema>;
export type ListShiftsQuery = z.infer<typeof listShiftsSchema>;
