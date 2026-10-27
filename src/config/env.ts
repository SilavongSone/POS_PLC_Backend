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
  /** Where uploaded product images are stored; served at /api/uploads. */
  UPLOAD_DIR: z.string().default('uploads'),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  /** Comma-separated list of allowed browser origins. */
  CORS_ORIGINS: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(',')
            .map((o) => o.trim())
            .filter(Boolean)
        : undefined,
    ),
  /** Swagger UI at /api/docs; off by default in production. */
  SWAGGER_ENABLED: z.enum(['true', 'false']).optional(),
  /** Number of reverse-proxy hops in front of the API (for client IPs in rate limits and logs). */
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
  /** Requests per minute per client IP. */
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(600),
  /** Login / PIN / approval / refresh attempts per minute per client IP. */
  THROTTLE_AUTH_LIMIT: z.coerce.number().int().positive().default(10),
  /** Max JSON body size, e.g. "1mb". */
  BODY_LIMIT: z.string().default('1mb'),
  /**
   * Company code used when a login omits tenantCode — for single-company installs and
   * deployments that serve one company per domain. Unset: tenantCode is required.
   */
  DEFAULT_TENANT_CODE: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || undefined),
  /** Self-service sign-up at POST /public/signup. */
  SIGNUP_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Database connections per API instance. */
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(200).default(10),
  /** Any SQL statement running longer than this is cancelled (ms). */
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .default(30_000),
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
