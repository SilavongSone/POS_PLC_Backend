import { z } from 'zod';
import { patchOf } from '../common/zod-validation.pipe.js';

const text = (max: number) => z.string().trim().max(max);

export const createBranchSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9-]{0,19}$/, 'Code: letters, digits and "-"'),
  name: text(100).min(1),
  address: text(300).nullish(),
  phone: text(50).nullish(),
  /** Printed under the shop name on receipts of this branch. */
  receiptHeader: text(500).nullish(),
  isActive: z.boolean().default(true),
});
export type CreateBranchInput = z.infer<typeof createBranchSchema>;

export const updateBranchSchema = patchOf(createBranchSchema);
export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;
