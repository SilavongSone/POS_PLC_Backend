import { z } from 'zod';
import { patchOf } from '../common/zod-validation.pipe.js';
import { pageQuerySchema } from '../common/pagination.js';
import { FEATURES, LIMIT_KEYS } from '../tenancy/plan-features.js';

const limit = z.number().int().min(0).nullable();
const limitsSchema = z.strictObject(
  Object.fromEntries(LIMIT_KEYS.map((k) => [k, limit])) as Record<
    (typeof LIMIT_KEYS)[number],
    typeof limit
  >,
);
const features = z
  .array(z.enum(FEATURES))
  .transform((list) => [...new Set(list)]);
const i18n = z
  .object({
    lo: z.string().trim().max(200),
    th: z.string().trim().max(200),
    en: z.string().trim().max(200),
  })
  .partial();
const lak = z.coerce.number().int().min(0).max(1e12);

export const platformLoginSchema = z.object({
  email: z.email().trim().toLowerCase(),
  password: z.string().min(1).max(200),
});
export type PlatformLoginInput = z.infer<typeof platformLoginSchema>;

export const createPlanSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]{2,30}$/),
  name: z.string().trim().min(1).max(100),
  nameI18n: i18n.nullish(),
  descriptionI18n: i18n.nullish(),
  priceMonthlyLak: lak.default(0),
  priceYearlyLak: lak.default(0),
  limits: limitsSchema,
  features: features.default([]),
  trialDays: z.number().int().min(0).max(365).default(14),
  isPublic: z.boolean().default(true),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});
export type CreatePlanInput = z.infer<typeof createPlanSchema>;
export const updatePlanSchema = patchOf(createPlanSchema.omit({ code: true }));
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;

export const listTenantsSchema = pageQuerySchema.extend({
  status: z
    .enum(['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED'])
    .optional(),
  planId: z.uuid().optional(),
});
export type ListTenantsQuery = z.infer<typeof listTenantsSchema>;

export const updateTenantSchema = z
  .object({
    name: z.string().trim().min(1).max(150),
    legalName: z.string().trim().max(200).nullable(),
    taxId: z.string().trim().max(30).nullable(),
    phone: z.string().trim().max(50).nullable(),
    email: z.email().nullable(),
    defaultLanguage: z.enum(['lo', 'th', 'en']),
    isActive: z.boolean(),
  })
  .partial();
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;

export const updateSubscriptionSchema = z
  .object({
    planId: z.uuid(),
    status: z.enum(['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED']),
    trialEndsAt: z.coerce.date().nullable(),
    currentPeriodEnd: z.coerce.date().nullable(),
    /** Per-company exceptions to the plan; null removes them. */
    overrides: z
      .strictObject({
        limits: limitsSchema.partial().optional(),
        featuresAdd: features.optional(),
        featuresRemove: features.optional(),
      })
      .nullable(),
    note: z.string().trim().max(1000).nullable(),
  })
  .partial();
export type UpdateSubscriptionInput = z.infer<typeof updateSubscriptionSchema>;
