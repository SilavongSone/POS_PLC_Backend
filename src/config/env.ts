import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  /** HMAC secret for access tokens; at least 32 characters. */
  JWT_SECRET: z.string().min(32),
  /** Access token lifetime in seconds. */
  ACCESS_TOKEN_TTL: z.coerce.number().int().positive().default(900),
  /** Refresh token lifetime for password logins, in days. */
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  /** Refresh token lifetime for PIN logins at a till, in hours. */
  PIN_SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
});

export type Env = z.infer<typeof envSchema>;

/** Used by ConfigModule.forRoot({ validate }) so the app fails fast on bad config. */
export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
