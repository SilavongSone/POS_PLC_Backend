import { z } from 'zod';
import { pageQuerySchema, queryBoolean } from '../common/pagination.js';

const text = (max: number) => z.string().trim().max(max);

export const createCustomerSchema = z.object({
  name: text(150).min(1),
  type: z.enum(['INDIVIDUAL', 'BUSINESS']).default('INDIVIDUAL'),
  companyName: text(150).nullable().optional(),
  taxId: text(30).nullable().optional(),
  phone: text(30).nullable().optional(),
  email: z.email().nullable().optional(),
  address: text(300).nullable().optional(),
  priceTier: z.enum(['RETAIL', 'WHOLESALE']).default('RETAIL'),
  /** 0 = no credit sales allowed. */
  creditLimitLak: z.coerce.number().int().min(0).default(0),
  note: text(1000).nullable().optional(),
  isActive: z.boolean().default(true),
});
export const updateCustomerSchema = createCustomerSchema.partial();

export const listCustomersSchema = pageQuerySchema.extend({
  type: z.enum(['INDIVIDUAL', 'BUSINESS']).optional(),
  isActive: queryBoolean.optional(),
  /** Only customers with unpaid credit sales. */
  withDebt: queryBoolean.optional(),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type ListCustomersQuery = z.infer<typeof listCustomersSchema>;
