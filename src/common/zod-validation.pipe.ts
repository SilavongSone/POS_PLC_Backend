import { BadRequestException, PipeTransform } from '@nestjs/common';
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
  return z.toJSONSchema(schema, { target: 'openapi-3.0' }) as Record<
    string,
    unknown
  >;
}
