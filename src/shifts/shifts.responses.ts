import { z } from 'zod';
import {
  apiSchema,
  dateTimeString,
  decimalString,
  pageOf,
} from '../common/openapi.js';
import { registerFields } from '../settings/settings.responses.js';

/** Cash per currency as decimal strings, e.g. { LAK: "500000", THB: "0", USD: "20" }. */
export const cashCountSchema = apiSchema(
  'CashCount',
  z.strictObject({
    LAK: decimalString,
    THB: decimalString,
    USD: decimalString,
  }),
);

/** A shift with its register (POST /shifts/open, GET /shifts/current). */
export const shiftSchema = apiSchema(
  'Shift',
  z.strictObject({
    id: z.uuid(),
    tenantId: z.uuid(),
    registerId: z.uuid(),
    userId: z.uuid(),
    status: z.enum(['OPEN', 'CLOSED']),
    openedAt: dateTimeString,
    closedAt: dateTimeString.nullable(),
    openingCash: cashCountSchema,
    closingCash: cashCountSchema.nullable(),
    /** System-calculated cash at close. */
    expectedCash: cashCountSchema.nullable(),
    note: z.string().nullable(),
    register: z.strictObject(registerFields),
  }),
);

const shiftColumns = {
  id: z.uuid(),
  tenantId: z.uuid(),
  registerId: z.uuid(),
  userId: z.uuid(),
  status: z.enum(['OPEN', 'CLOSED']),
  openedAt: dateTimeString,
  closedAt: dateTimeString.nullable(),
  openingCash: cashCountSchema,
  closingCash: cashCountSchema.nullable(),
  expectedCash: cashCountSchema.nullable(),
  note: z.string().nullable(),
  user: z.strictObject({ id: z.uuid(), fullName: z.string() }),
};

export const shiftListItemSchema = apiSchema(
  'ShiftListItem',
  z.strictObject({
    ...shiftColumns,
    register: z.strictObject({
      id: z.uuid(),
      code: z.string(),
      name: z.string(),
    }),
  }),
);
export const shiftPageSchema = apiSchema(
  'ShiftPage',
  pageOf(shiftListItemSchema),
);

const byPaymentType = z.strictObject({
  paymentTypeId: z.uuid(),
  name: z.string().optional(),
  kind: z.enum(['CASH', 'BANK_TRANSFER', 'QR', 'CARD', 'CREDIT']).optional(),
  currency: z.enum(['LAK', 'THB', 'USD']),
  /** In `currency`. */
  amount: decimalString,
  amountLak: decimalString,
});

/** Z-report: sales, payments by type and currency, expected vs counted cash per currency. */
export const shiftReportSchema = apiSchema(
  'ShiftReport',
  z.strictObject({
    shift: z.strictObject({
      ...shiftColumns,
      register: z.strictObject({
        id: z.uuid(),
        code: z.string(),
        name: z.string(),
        branchId: z.uuid(),
      }),
    }),
    sales: z.strictObject({
      count: z.int(),
      totalLak: decimalString,
      vatLak: decimalString,
      billDiscountLak: decimalString,
      /** Sold on credit (customer debt), not cash in the drawer. */
      creditLak: decimalString,
    }),
    voided: z.strictObject({ count: z.int(), totalLak: decimalString }),
    payments: z.array(byPaymentType),
    debtPayments: z.array(byPaymentType),
    cashMovements: z.array(
      z.strictObject({
        type: z.enum(['PAY_IN', 'PAY_OUT']),
        currency: z.enum(['LAK', 'THB', 'USD']),
        amount: decimalString.nullable(),
      }),
    ),
    expenses: z.array(byPaymentType),
    returns: z.array(
      z.strictObject({
        paymentTypeId: z.uuid(),
        name: z.string().optional(),
        count: z.int(),
        refundLak: decimalString.nullable(),
      }),
    ),
    cash: z.strictObject({
      opening: cashCountSchema,
      expected: cashCountSchema,
      counted: cashCountSchema.nullable(),
      /** counted − expected; null while open. */
      difference: cashCountSchema.nullable(),
    }),
  }),
);

export const shiftClosedSchema = apiSchema(
  'ShiftClosed',
  shiftReportSchema.extend({
    /** The cashier still has bills on hold. */
    heldBillsLeft: z.int(),
  }),
);
