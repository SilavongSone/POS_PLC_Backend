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

/** What POST /platform/tenants/:id/stores created. */
export const createdStoreSchema = apiSchema(
  'CreatedStore',
  z.strictObject({
    id: z.uuid(),
    code: z.string(),
    name: z.string(),
    owner: z.strictObject({
      username: z.string(),
      email: z.string().nullable(),
    }),
    /** False when the owner's e-mail is not confirmed: no store switching until it is. */
    ownerCanSwitch: z.boolean(),
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
