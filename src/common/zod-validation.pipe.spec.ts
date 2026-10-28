import { z } from 'zod';
import { patchOf } from './zod-validation.pipe.js';

describe('patchOf', () => {
  const create = z.strictObject({
    name: z.string(),
    isActive: z.boolean().default(true),
    sortOrder: z.number().default(0),
  });

  it('makes fields optional without applying defaults', () => {
    expect(patchOf(create).parse({ name: 'x' })).toEqual({ name: 'x' });
    expect(patchOf(create).parse({ isActive: false })).toEqual({
      isActive: false,
    });
  });

  it('keeps the schema strict', () => {
    expect(patchOf(create).safeParse({ other: 1 }).success).toBe(false);
  });
});
