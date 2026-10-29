import { applyDecorators, RequestMethod } from '@nestjs/common';
import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
} from '@nestjs/common/constants.js';
import { ApiQuery, ApiResponse } from '@nestjs/swagger';
import { z } from 'zod';
import { openApiSchema } from './zod-validation.pipe.js';

/**
 * OpenAPI documentation from zod schemas. Response schemas describe what the API returns
 * (after JSON serialisation: Decimal → string, Date → ISO string) and are checked against
 * real responses by test/contract.e2e-spec.ts, so keep them in step with the services.
 */

type JsonSchema = Record<string, unknown>;

/** Named response schemas: each becomes `#/components/schemas/<id>`. */
export const openApiRegistry = z.registry<{ id: string }>();

const COMPONENTS = '#/components/schemas/';

/** Registers `schema` as the reusable component `id` and returns it. */
export function apiSchema<T extends z.ZodType>(id: string, schema: T): T {
  openApiRegistry.add(schema, { id });
  return schema;
}

/** Drops regex patterns that only restate a `format` (uuid, date-time, e-mail …). */
function tidy(ctx: { jsonSchema: JsonSchema }) {
  if (ctx.jsonSchema.format && ctx.jsonSchema.pattern)
    delete ctx.jsonSchema.pattern;
}

const outputOptions = {
  target: 'openapi-3.0',
  io: 'output',
  unrepresentable: 'any',
  override: tidy,
} as const;

/** Every registered schema as `components.schemas`, referencing each other by `$ref`. */
export function componentSchemas(): Record<string, JsonSchema> {
  const { schemas } = z.toJSONSchema(openApiRegistry, {
    ...outputOptions,
    uri: (id) => `${COMPONENTS}${id}`,
  }) as { schemas: Record<string, JsonSchema> };
  for (const s of Object.values(schemas)) delete s.$id;
  return schemas;
}

/** JSON schema of a response: a `$ref` for registered schemas, else inline with refs. */
export function responseSchema(schema: z.ZodType): JsonSchema {
  const id = openApiRegistry.get(schema)?.id;
  if (id) return { $ref: `${COMPONENTS}${id}` };
  const json = z.toJSONSchema(schema, {
    ...outputOptions,
    metadata: openApiRegistry,
  }) as JsonSchema;
  // Registered sub-schemas come back as local definitions; point them at the components.
  delete json.definitions;
  return JSON.parse(
    JSON.stringify(json).replaceAll('"#/definitions/', `"${COMPONENTS}`),
  ) as JsonSchema;
}

// ── Shared output types ──

/** Prisma Decimal, serialised as a string (LAK amounts are whole kip). */
export const decimalString = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/)
  .meta({ description: 'Decimal number as a string' });
export const dateTimeString = z.iso.datetime();
export const currencySchema = z.enum(['LAK', 'THB', 'USD']);
/** Stored translations `{ lo?, th?, en? }`, or null. */
export const i18nMap = z
  .strictObject({
    lo: z.string().optional(),
    th: z.string().optional(),
    en: z.string().optional(),
  })
  .nullable();

/** `{ items, total, page, pageSize }` from common/pagination.ts. */
export const pageOf = <T extends z.ZodType>(item: T) =>
  z.strictObject({
    items: z.array(item),
    total: z.int().min(0),
    page: z.int().min(1),
    pageSize: z.int().min(1).max(100),
  });

/** Body of every error response (i18n/exception.filter.ts). */
export const errorResponseSchema = apiSchema(
  'ErrorResponse',
  z
    .looseObject({
      statusCode: z.int(),
      /** Stable, language-independent; clients branch on it. */
      code: z.string(),
      /** In the request's language. */
      message: z.string(),
      /** The original English text when it says more than `message`. */
      detail: z.string().optional(),
      requestId: z.string(),
      /** VALIDATION_FAILED only: one entry per invalid field. */
      errors: z
        .array(
          z.strictObject({
            path: z.string(),
            code: z.string(),
            message: z.string(),
          }),
        )
        .optional(),
    })
    .meta({
      description:
        'Error body. Extra fields depend on `code` (e.g. lockedUntil, companies, permission, feature, limit).',
    }),
);

// ── Decorators ──

/** The status Nest answers with when the route succeeds (@HttpCode, else 201 for POST, 200). */
function successStatus(handler: object): number {
  const code = Reflect.getMetadata(HTTP_CODE_METADATA, handler) as
    number | undefined;
  if (code) return code;
  return Reflect.getMetadata(METHOD_METADATA, handler) === RequestMethod.POST
    ? 201
    : 200;
}

/**
 * Method decorators run bottom-up, so @Get/@Post/@HttpCode above this one have not run yet.
 * The status is read once the class is fully decorated (a microtask later, long before
 * any document is built), unless `status` is given.
 */
function onSuccessStatus(
  status: number | undefined,
  apply: (status: number) => MethodDecorator,
): MethodDecorator {
  return (target, key, descriptor) => {
    const run = () =>
      apply(status ?? successStatus(descriptor.value as object))(
        target,
        key,
        descriptor,
      );
    if (status) run();
    else queueMicrotask(run);
  };
}

/** Documents the success response with a zod schema (output shape). */
export const ApiZodResponse = (
  schema: z.ZodType,
  opts: { status?: number; description?: string } = {},
) =>
  onSuccessStatus(opts.status, (status) =>
    ApiResponse({
      status,
      description: opts.description ?? 'Success',
      schema: responseSchema(schema),
    }),
  );

/** Documents a success response without a body (202/204). */
export const ApiEmptyResponse = (
  opts: { status?: number; description?: string } = {},
) =>
  onSuccessStatus(opts.status, (status) =>
    ApiResponse({ status, description: opts.description ?? 'No content' }),
  );

/** One query parameter per key of a zod object (type, required, enum, default, description). */
export function ApiZodQuery(schema: z.ZodObject) {
  const json = openApiSchema(schema) as {
    properties?: Record<string, JsonSchema>;
    required?: string[];
  };
  const required = new Set(json.required ?? []);
  return applyDecorators(
    ...Object.entries(json.properties ?? {}).map(([name, property]) => {
      const { description, ...rest } = property;
      tidy({ jsonSchema: rest });
      return ApiQuery({
        name,
        // Defaults make a key optional for the client even if zod lists it as required.
        required: required.has(name) && rest.default === undefined,
        description: description as string | undefined,
        schema: rest,
      });
    }),
  );
}

const ERROR_DESCRIPTIONS = {
  400: 'Invalid input',
  401: 'Not signed in, or the credentials/token are invalid',
  402: 'Subscription expired: the company is read-only',
  403: 'Not allowed',
  404: 'Not found',
  409: 'Conflict with the current state',
  423: 'Account temporarily locked',
  429: 'Too many requests',
} as const;
export type ErrorStatus = keyof typeof ERROR_DESCRIPTIONS;

/**
 * Documents error responses with the shared ErrorResponse body. Values list the `code`s
 * the endpoint can return for that status (true: only the generic one).
 */
export function ApiErrors(
  spec: Partial<Record<ErrorStatus, readonly string[] | true>>,
) {
  return applyDecorators(
    ...Object.entries(spec).map(([status, codes]) => {
      const base = ERROR_DESCRIPTIONS[Number(status) as ErrorStatus];
      return ApiResponse({
        status: Number(status),
        description:
          codes === true ? base : `${base}. Codes: ${codes.join(', ')}`,
        schema: { $ref: `${COMPONENTS}ErrorResponse` },
      });
    }),
  );
}

type ErrorSpec = Partial<Record<ErrorStatus, readonly string[]>>;

/** Merges error specs, keeping each code once per status. */
export function errors(...specs: ErrorSpec[]): ErrorSpec {
  const out: Partial<Record<ErrorStatus, string[]>> = {};
  for (const spec of specs) {
    for (const [status, codes] of Object.entries(spec)) {
      const key = Number(status) as ErrorStatus;
      out[key] = [...new Set([...(out[key] ?? []), ...codes])];
    }
  }
  return out;
}

/** Every route: the global rate limit. */
export const THROTTLED: ErrorSpec = { 429: ['TOO_MANY_REQUESTS'] };
/** Every signed-in route: bad/missing token, suspended company, rate limit. */
export const SIGNED_IN: ErrorSpec = errors(THROTTLED, {
  401: ['UNAUTHORIZED'],
  403: ['TENANT_SUSPENDED'],
});
/** Signed-in writes (non-GET outside /auth and /billing) also need a current subscription. */
export const SIGNED_IN_WRITE: ErrorSpec = errors(SIGNED_IN, {
  402: ['SUBSCRIPTION_INACTIVE'],
});
/** Body/query/path validation failed (zod or ParseUUIDPipe). */
export const VALIDATION: ErrorSpec = { 400: ['VALIDATION_FAILED'] };
/** Route guarded by @RequirePermissions. */
export const PERMISSION: ErrorSpec = { 403: ['MISSING_PERMISSION'] };
