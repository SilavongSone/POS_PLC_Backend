import { BadRequestException, PipeTransform } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import { z } from 'zod';

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
          message: i.message,
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
