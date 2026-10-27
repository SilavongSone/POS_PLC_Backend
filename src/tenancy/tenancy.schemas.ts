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

export const signupSchema = provisionTenantSchema
  .pick({
    code: true,
    name: true,
    phone: true,
    email: true,
    defaultLanguage: true,
    planCode: true,
    owner: true,
  })
  .extend({ email: z.email() });
export type SignupInput = z.infer<typeof signupSchema>;
