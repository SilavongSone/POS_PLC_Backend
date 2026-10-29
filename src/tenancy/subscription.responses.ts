import { z } from 'zod';
import { apiSchema, dateTimeString } from '../common/openapi.js';
import { FEATURES, LIMIT_KEYS } from './plan-features.js';

const limitsShape = Object.fromEntries(
  LIMIT_KEYS.map((k) => [k, z.int().nullable()]),
) as Record<(typeof LIMIT_KEYS)[number], z.ZodNullable<z.ZodInt>>;
const usageShape = Object.fromEntries(
  LIMIT_KEYS.map((k) => [k, z.int()]),
) as Record<(typeof LIMIT_KEYS)[number], z.ZodInt>;

/** GET /subscription: plan, status, features, limits (null = unlimited) and usage. */
export const subscriptionSchema = apiSchema(
  'Subscription',
  z.strictObject({
    company: z.strictObject({
      code: z.string(),
      name: z.string(),
      defaultLanguage: z.string(),
    }),
    tenantId: z.uuid(),
    defaultLanguage: z.string(),
    plan: z
      .strictObject({ id: z.uuid(), code: z.string(), name: z.string() })
      .nullable(),
    status: z
      .enum(['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED'])
      .nullable(),
    trialEndsAt: dateTimeString.nullable(),
    currentPeriodEnd: dateTimeString.nullable(),
    graceEndsAt: dateTimeString.nullable(),
    features: z.array(z.enum(FEATURES)),
    limits: z.strictObject(limitsShape),
    /** No sign-in or use at all (suspended, cancelled, company disabled). */
    blocked: z.boolean(),
    /** Grace period over: reads only. */
    readOnly: z.boolean(),
    usage: z.strictObject(usageShape),
  }),
);
