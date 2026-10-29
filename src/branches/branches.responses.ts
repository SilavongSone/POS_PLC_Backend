import { z } from 'zod';
import { apiSchema, dateTimeString } from '../common/openapi.js';

/** Branch columns. */
const branchFields = {
  id: z.uuid(),
  tenantId: z.uuid(),
  code: z.string(),
  name: z.string(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  receiptHeader: z.string().nullable(),
  /** VAT rate of this branch; null = the company's default rate. */
  taxRateId: z.uuid().nullable(),
  isActive: z.boolean(),
  createdAt: dateTimeString,
  updatedAt: dateTimeString,
};

export const branchSchema = apiSchema('Branch', z.strictObject(branchFields));

export const branchListItemSchema = apiSchema(
  'BranchListItem',
  z.strictObject({
    ...branchFields,
    _count: z.strictObject({ registers: z.int() }),
  }),
);
export const branchesSchema = z.array(branchListItemSchema);
