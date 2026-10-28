import { z } from 'zod';
import { i18nText } from '../i18n/i18n.schemas.js';
import { patchOf } from '../common/zod-validation.pipe.js';

const text = (max: number) => z.string().trim().max(max);

/** Every editable setting with its type. Unknown keys are rejected. */
export const settingsShape = {
  'store.name': text(100),
  'store.companyName': text(150),
  'store.taxId': text(30),
  'store.phone': text(50),
  'store.address': text(300),
  'store.logoUrl': text(500),
  'receipt.defaultSize': z.enum(['58mm', '80mm', 'A5', 'A4']),
  'receipt.footer': text(500),
  'repair.warrantyTerms': text(2000),
  'tax.pricesIncludeVat': z.boolean(),
  /** LAK prices converted from THB/USD are rounded up to a multiple of this. */
  'pricing.lakRounding': z.number().int().min(1).max(100_000),
  'app.timezone': z.literal('Asia/Vientiane'),
};

export const updateSettingsSchema = z.strictObject(settingsShape).partial();
export type Settings = z.infer<z.ZodObject<typeof settingsShape>>;
export type SettingKey = keyof Settings;

export const SETTING_DEFAULTS: Settings = {
  'store.name': 'PLC POS',
  'store.companyName': '',
  'store.taxId': '',
  'store.phone': '',
  'store.address': '',
  'store.logoUrl': '',
  'receipt.defaultSize': '80mm',
  'receipt.footer': '',
  'repair.warrantyTerms': '',
  'tax.pricesIncludeVat': true,
  'pricing.lakRounding': 1000,
  'app.timezone': 'Asia/Vientiane',
};

const percent = z.coerce
  .number()
  .min(0)
  .max(100)
  .refine((n) => Number.isInteger(n * 100), 'At most 2 decimals');

export const createTaxRateSchema = z.object({
  name: text(50).min(1),
  percent,
  isActive: z.boolean().default(true),
});
export const updateTaxRateSchema = z
  .object({ name: text(50).min(1), percent, isActive: z.boolean() })
  .partial();

export const foreignCurrency = z.enum(['THB', 'USD']);

export const createExchangeRateSchema = z.object({
  currency: foreignCurrency,
  /** LAK per 1 unit of currency, e.g. 21800 for USD. */
  lakPerUnit: z.coerce
    .number()
    .positive()
    .max(1_000_000)
    .refine((n) => Number.isInteger(n * 10_000), 'At most 4 decimals'),
});
export const listExchangeRatesSchema = z.object({
  currency: foreignCurrency.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const paymentKind = z.enum([
  'CASH',
  'BANK_TRANSFER',
  'QR',
  'CARD',
  'CREDIT',
]);
export const createPaymentTypeSchema = z.object({
  name: text(50).min(1),
  nameI18n: i18nText(50).optional(),
  kind: paymentKind,
  requiresReference: z.boolean().default(false),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(999).default(0),
});
export const updatePaymentTypeSchema = patchOf(
  createPaymentTypeSchema.omit({ kind: true }),
);

export const printerConfigSchema = z.object({
  connection: z.enum(['usb', 'lan', 'bluetooth', 'none']),
  /** Printer IP/host for LAN printers. */
  host: text(255).optional(),
  port: z.number().int().min(1).max(65_535).optional(),
  paperWidth: z.union([z.literal(58), z.literal(80)]).default(80),
  /** Kick the cash drawer after cash payments. */
  openDrawer: z.boolean().default(true),
  copies: z.number().int().min(1).max(5).default(1),
});
export const createRegisterSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{1,6}$/, '1–6 letters or digits, e.g. R2'),
  name: text(50).min(1),
  /** Branch the till stands in; may be omitted when the company has one branch. */
  branchId: z.uuid().optional(),
  printer: printerConfigSchema.nullable().optional(),
  isActive: z.boolean().default(true),
});
export const updateRegisterSchema = patchOf(
  createRegisterSchema.omit({ code: true }),
);

export type CreateTaxRateInput = z.infer<typeof createTaxRateSchema>;
export type UpdateTaxRateInput = z.infer<typeof updateTaxRateSchema>;
export type CreateExchangeRateInput = z.infer<typeof createExchangeRateSchema>;
export type ListExchangeRatesQuery = z.infer<typeof listExchangeRatesSchema>;
export type CreatePaymentTypeInput = z.infer<typeof createPaymentTypeSchema>;
export type UpdatePaymentTypeInput = z.infer<typeof updatePaymentTypeSchema>;
export type CreateRegisterInput = z.infer<typeof createRegisterSchema>;
export type UpdateRegisterInput = z.infer<typeof updateRegisterSchema>;
