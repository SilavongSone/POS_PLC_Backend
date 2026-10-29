import { z } from 'zod';
import { apiSchema } from '../common/openapi.js';

/** The signed-in user (auth.types.ts AuthUser). */
export const authUserSchema = apiSchema(
  'AuthUser',
  z.strictObject({
    id: z.uuid(),
    tenantId: z.uuid(),
    username: z.string(),
    fullName: z.string(),
    groupId: z.uuid(),
    groupName: z.string(),
    /** Permission codes from common/permissions.ts. */
    permissions: z.array(z.string()),
    /** Branches the user may work in; null = every branch. */
    branchIds: z.array(z.uuid()).nullable(),
    email: z.string().nullable(),
    emailVerified: z.boolean(),
    googleLinked: z.boolean(),
    /** lo, th, en; null = company default. */
    language: z.enum(['lo', 'th', 'en']).nullable(),
  }),
);

/** Tokens returned by every sign-in (auth.types.ts AuthTokens). */
export const authTokensShape = {
  accessToken: z.string(),
  /** Opaque; send it to POST /auth/refresh to rotate. */
  refreshToken: z.string(),
  /** Access token lifetime in seconds. */
  expiresIn: z.int().positive(),
  user: authUserSchema,
};
export const authTokensSchema = apiSchema(
  'AuthTokens',
  z.strictObject(authTokensShape),
);

export const emailVerifiedSchema = apiSchema(
  'EmailVerified',
  z.strictObject({ email: z.string() }),
);
