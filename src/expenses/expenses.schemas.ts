import { z } from 'zod';
import { patchOf } from '../common/zod-validation.pipe.js';
import { pageQuerySchema } from '../common/pagination.js';

export const expenseCategorySchema = z.object({
  name: z.string().trim().min(1).max(100),
  isActive: z.boolean().default(true),
});
export const updateExpenseCategorySchema = patchOf(expenseCategorySchema);

export const createExpenseSchema = z
  .object({
    categoryId: z.uuid(),
    description: z.string().trim().min(1).max(300),
    currency: z.enum(['LAK', 'THB', 'USD']).default('LAK'),
    amount: z.coerce.number().positive().max(1e15).multipleOf(0.01),
    paymentTypeId: z.uuid(),
    /** Paid from the till: recorded in the user's open shift so the drawer balances. */
    fromDrawer: z.boolean().default(false),
    spentAt: z.iso
      .datetime({ offset: true })
      .transform((d) => new Date(d))
      .optional(),
    attachmentUrl: z.string().trim().max(500).optional(),
  })
  .refine((e) => e.currency !== 'LAK' || Number.isInteger(e.amount), {
    message: 'LAK amounts are whole kip',
    path: ['amount'],
  });

export const listExpensesSchema = pageQuerySchema.extend({
  categoryId: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

export type ExpenseCategoryInput = z.infer<typeof expenseCategorySchema>;
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type ListExpensesQuery = z.infer<typeof listExpensesSchema>;
