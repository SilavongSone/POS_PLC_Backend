import { z } from 'zod';
import {
  apiSchema,
  dateTimeString,
  decimalString,
  pageOf,
} from '../common/openapi.js';

const customerFields = {
  id: z.uuid(),
  tenantId: z.uuid(),
  code: z.string(),
  name: z.string(),
  type: z.enum(['INDIVIDUAL', 'BUSINESS']),
  companyName: z.string().nullable(),
  taxId: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  priceTier: z.enum(['RETAIL', 'WHOLESALE']),
  /** 0 = no credit sales. */
  creditLimitLak: decimalString,
  note: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: dateTimeString,
  /** Unpaid credit sales. */
  outstandingLak: decimalString,
};

export const customerListItemSchema = apiSchema(
  'CustomerListItem',
  z.strictObject(customerFields),
);
export const customerPageSchema = apiSchema(
  'CustomerPage',
  pageOf(customerListItemSchema),
);

export const customerDetailSchema = apiSchema(
  'CustomerDetail',
  z.strictObject({
    ...customerFields,
    purchases: z.strictObject({
      count: z.int(),
      totalLak: decimalString,
      lastAt: dateTimeString.nullable(),
    }),
  }),
);

/** GET /customers/:id/debts: unpaid credit sales, oldest first. */
export const openDebtsSchema = z.array(
  apiSchema(
    'OpenDebt',
    z.strictObject({
      id: z.uuid(),
      receiptNo: z.string(),
      createdAt: dateTimeString,
      dueDate: dateTimeString.nullable(),
      totalLak: decimalString,
      paidLak: decimalString,
      paymentStatus: z.enum(['PAID', 'PARTIAL', 'UNPAID']),
      dueLak: decimalString,
      overdue: z.boolean(),
    }),
  ),
);
