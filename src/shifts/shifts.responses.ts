import { z } from 'zod';
import { apiSchema, dateTimeString, decimalString } from '../common/openapi.js';
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
