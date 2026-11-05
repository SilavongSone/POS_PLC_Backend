import { z } from 'zod';
import { currencyCode } from '../common/currency.js';
import { pageQuerySchema } from '../common/pagination.js';

const amount = z.coerce.number().min(0).max(1e13).multipleOf(0.01);

/**
 * Cash counted per currency code, e.g. {"LAK": 500000, "CNY": 120}; missing currencies
 * count as 0. Codes and decimals are checked against the company's currencies.
 */
export const cashCountSchema = z
  .record(currencyCode, amount)
  .refine((c) => Object.keys(c).length <= 30, 'At most 30 currencies')
  .refine((c) => Number.isInteger(c.LAK ?? 0), {
    message: 'LAK amounts are whole kip',
    path: ['LAK'],
  });

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
    currency: currencyCode,
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
