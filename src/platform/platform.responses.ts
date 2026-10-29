import { z } from 'zod';
import { authTokensShape } from '../auth/auth.responses.js';
import {
  apiSchema,
  dateTimeString,
  decimalString,
  i18nMap,
} from '../common/openapi.js';
import { FEATURES, LIMIT_KEYS } from '../tenancy/plan-features.js';

/** GET /public/plans item. `name` is in the request language. */
export const publicPlanSchema = apiSchema(
  'PublicPlan',
  z.strictObject({
    id: z.uuid(),
    code: z.string(),
    name: z.string(),
    nameI18n: i18nMap,
    descriptionI18n: i18nMap,
    priceMonthlyLak: decimalString,
    priceYearlyLak: decimalString,
    /** null = unlimited. */
    limits: z.strictObject(
      Object.fromEntries(
        LIMIT_KEYS.map((k) => [k, z.int().min(0).nullable()]),
      ) as Record<(typeof LIMIT_KEYS)[number], z.ZodNullable<z.ZodInt>>,
    ),
    features: z.array(z.enum(FEATURES)),
    trialDays: z.int().min(0),
  }),
);
export const publicPlansSchema = z.array(publicPlanSchema);

/** POST /public/signup and /public/signup/resend: the code was e-mailed. */
export const signupPendingSchema = apiSchema(
  'SignupPending',
  z.strictObject({
    requestId: z.uuid(),
    email: z.string(),
    /** The e-mailed code stops working at this time. */
    expiresAt: dateTimeString,
  }),
);

/** The company was created and its owner is signed in. */
export const signupCompletedSchema = apiSchema(
  'SignupCompleted',
  z.strictObject({
    tenant: z.strictObject({
      id: z.uuid(),
      code: z.string(),
      name: z.string(),
    }),
    ...authTokensShape,
  }),
);
