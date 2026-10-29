import { z } from 'zod';
import { LANGUAGES } from '../users/users.schemas.js';

const RESERVED = new Set(['api', 'www', 'admin', 'platform', 'app', 'public']);

/** Company code used at login and in URLs: lower-case letters, digits and "-". */
export const tenantCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,30}$/, '2–31 letters, digits or "-"')
  .refine((c) => !RESERVED.has(c), 'This code is reserved');

export const ownerSchema = z.object({
  /** Owner's e-mail; for platform-created companies a confirmation link is sent. */
  email: z.email().trim().toLowerCase().optional(),
  username: z
    .string()
    .trim()
    .min(3)
    .max(50)
    .regex(/^[a-zA-Z0-9._-]+$/, 'Use letters, digits, dot, dash or underscore'),
  fullName: z.string().trim().min(1).max(100),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(200),
});

export const provisionTenantSchema = z.object({
  code: tenantCodeSchema,
  name: z.string().trim().min(1).max(150),
  legalName: z.string().trim().max(200).nullish(),
  taxId: z.string().trim().max(30).nullish(),
  phone: z.string().trim().max(50).nullish(),
  email: z.email().nullish(),
  defaultLanguage: z.enum(LANGUAGES).default('lo'),
  planCode: z.string().trim().toUpperCase().min(1).max(30),
  /** TRIAL uses the plan's trial days; ACTIVE needs currentPeriodEnd unless open-ended. */
  status: z.enum(['TRIAL', 'ACTIVE']).default('TRIAL'),
  currentPeriodEnd: z.coerce.date().nullish(),
  owner: ownerSchema,
  branch: z
    .object({
      code: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z0-9][A-Z0-9-]{0,19}$/),
      name: z.string().trim().min(1).max(100),
    })
    .optional(),
});
export type ProvisionTenantInput = z.infer<typeof provisionTenantSchema>;

/** Plan for a self-service sign-up; the first public plan with a trial when omitted. */
const signupPlanSchema = z.string().trim().toUpperCase().min(1).max(30);

/**
 * Self-service sign-up: only the shop name, e-mail and password are required. The company
 * code, owner username/name and plan are derived when omitted (see SignupService).
 */
export const signupSchema = provisionTenantSchema
  .pick({ name: true, phone: true, defaultLanguage: true })
  .extend({
    email: z.email().trim().toLowerCase(),
    code: tenantCodeSchema.optional(),
    planCode: signupPlanSchema.optional(),
    owner: z.object({
      username: ownerSchema.shape.username.optional(),
      fullName: ownerSchema.shape.fullName.optional(),
      password: ownerSchema.shape.password,
    }),
  });
export type SignupInput = z.infer<typeof signupSchema>;

export const verifySignupSchema = z.object({
  requestId: z.uuid(),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, '6 digits'),
});
export const resendSignupSchema = z.object({ requestId: z.uuid() });

/** Sign-up with Google: the owner is the Google account (no password). */
export const googleSignupSchema = provisionTenantSchema
  .pick({ name: true, phone: true, defaultLanguage: true })
  .extend({
    code: tenantCodeSchema.optional(),
    planCode: signupPlanSchema.optional(),
    idToken: z.string().min(20).max(5000),
  });
export type GoogleSignupInput = z.infer<typeof googleSignupSchema>;
