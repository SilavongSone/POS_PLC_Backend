import { z } from 'zod';
import {
  apiSchema,
  currencySchema,
  dateTimeString,
  decimalString,
  i18nMap,
} from '../common/openapi.js';

export const paymentTypeSchema = apiSchema(
  'PaymentType',
  z.strictObject({
    id: z.uuid(),
    tenantId: z.uuid(),
    /** In the request language (nameI18n keeps every translation). */
    name: z.string(),
    nameI18n: i18nMap,
    kind: z.enum(['CASH', 'BANK_TRANSFER', 'QR', 'CARD', 'CREDIT']),
    requiresReference: z.boolean(),
    isActive: z.boolean(),
    sortOrder: z.int(),
  }),
);
export const paymentTypesSchema = z.array(paymentTypeSchema);

/** Latest LAK rate per currency code that has one; LAK is always 1 with no date. */
export const currentRatesSchema = apiSchema(
  'CurrentExchangeRates',
  z.record(
    currencySchema,
    z.strictObject({
      lakPerUnit: decimalString,
      effectiveFrom: dateTimeString.nullable(),
    }),
  ),
);

/** One of the company's currencies (Settings → Currencies). */
export const currencyRowSchema = apiSchema(
  'Currency',
  z.strictObject({
    id: z.uuid(),
    tenantId: z.uuid(),
    code: currencySchema,
    /** In the request language (nameI18n keeps every translation). */
    name: z.string(),
    nameI18n: i18nMap,
    symbol: z.string(),
    decimals: z.int().min(0).max(2),
    cashRounding: decimalString,
    isBase: z.boolean(),
    isActive: z.boolean(),
    sortOrder: z.int(),
    createdAt: dateTimeString,
    updatedAt: dateTimeString,
  }),
);
export const currenciesSchema = z.array(currencyRowSchema);

/** ESC/POS printer settings of a register (settings.schemas.ts printerConfigSchema). */
export const printerConfigSchema = apiSchema(
  'PrinterConfig',
  z.strictObject({
    connection: z.enum(['usb', 'lan', 'bluetooth', 'none']),
    host: z.string().optional(),
    port: z.int().optional(),
    paperWidth: z.union([z.literal(58), z.literal(80)]),
    openDrawer: z.boolean(),
    copies: z.int(),
  }),
);

/** Register columns. */
export const registerFields = {
  id: z.uuid(),
  branchId: z.uuid(),
  tenantId: z.uuid(),
  code: z.string(),
  name: z.string(),
  printer: printerConfigSchema.nullable(),
  isActive: z.boolean(),
};

export const registerSchema = apiSchema(
  'Register',
  z.strictObject({
    ...registerFields,
    branch: z.strictObject({
      id: z.uuid(),
      code: z.string(),
      name: z.string(),
    }),
    /** The shift open on this register, if any. */
    openShift: z
      .strictObject({
        id: z.uuid(),
        openedAt: dateTimeString,
        user: z.strictObject({ id: z.uuid(), fullName: z.string() }),
      })
      .nullable(),
  }),
);
export const registersSchema = z.array(registerSchema);
