import { BadRequestException, PipeTransform } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import { z } from 'zod';
import { t } from '../i18n/i18n.js';

/** Validates and parses a request part with a zod schema: `@Body(new ZodValidationPipe(schema))`. */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: result.error.issues.map((i) => ({
          path: i.path.join('.'),
          code: i.code,
          // Built-in checks are translated; custom rules keep their own (English) text.
          message:
            (i.code !== 'custom' &&
              t(`zod.${i.code}`, i as unknown as Record<string, unknown>)) ||
            i.message,
        })),
      });
    }
    return result.data;
  }
}

/** JSON schema for Swagger's @ApiBody({ schema }) from a zod schema. */
export function openApiSchema(schema: z.ZodType) {
  return z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    io: 'input',
    unrepresentable: 'any',
  }) as Record<string, unknown>;
}

/** Shorthand: `@Body(zod(schema))`, `@Query(zod(schema))`. */
export const zod = <T extends z.ZodType>(schema: T) =>
  new ZodValidationPipe(schema);

/** Documents a zod request body in Swagger. */
export const ApiZodBody = (schema: z.ZodType) =>
  ApiBody({ schema: openApiSchema(schema) });

type NoDefault<T> = T extends z.ZodDefault<infer Inner> ? Inner : T;
type PatchShape<S extends z.ZodRawShape> = {
  [K in keyof S]: z.ZodOptional<NoDefault<S[K]>>;
};

/**
 * Update (PATCH) version of a create schema: every field optional and **without its
 * default**. zod 4 applies defaults even inside `.partial()`, which would silently reset
 * omitted fields (e.g. isActive) on every update.
 */
export function patchOf<S extends z.ZodRawShape>(
  schema: z.ZodObject<S>,
): z.ZodObject<PatchShape<S>> {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([key, field]) => [
      key,
      (
        (field instanceof z.ZodDefault ? field.unwrap() : field) as z.ZodType
      ).optional(),
    ]),
  );
  return schema.extend(shape) as unknown as z.ZodObject<PatchShape<S>>;
}
