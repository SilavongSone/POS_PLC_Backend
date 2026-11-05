import { z } from 'zod';
import { apiSchema } from '../common/openapi.js';

/** A store (company) the signed-in owner has an account in. */
export const myStoreSchema = z.strictObject({
  code: z.string(),
  name: z.string(),
  logoUrl: z.string().nullable(),
  /** The store this session is signed in to. */
  current: z.boolean(),
});

export const myStoresSchema = apiSchema('MyStores', z.array(myStoreSchema));

/** What POST /stores created; sign in to it with POST /stores/switch. */
export const createdStoreSchema = apiSchema(
  'CreatedStore',
  z.strictObject({
    code: z.string(),
    name: z.string(),
    copied: z.strictObject({
      categories: z.int(),
      brands: z.int(),
      units: z.int(),
      products: z.int(),
      images: z.int(),
      customers: z.int(),
      suppliers: z.int(),
    }),
  }),
);
