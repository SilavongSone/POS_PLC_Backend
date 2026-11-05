import { z } from 'zod';
import { tenantCodeSchema } from '../tenancy/tenancy.schemas.js';

/**
 * A new store separate from this one (its own company): what to copy from the current
 * store. Copies are made once; afterwards the stores never change each other.
 */
export const createStoreSchema = z.object({
  name: z.string().trim().min(1).max(150),
  /** First branch name; default "Main". */
  branchName: z.string().trim().min(1).max(100).optional(),
  copy: z
    .object({
      /** Categories, brands, units, products (specs, packs, versions, bundles), label layouts. */
      catalog: z.boolean().default(true),
      /** Product photos and brand logos (needs catalog). */
      images: z.boolean().default(true),
      /** Receipt, tax and shop settings (not the shop name or tax ID), shop logo. */
      settings: z.boolean().default(true),
      customers: z.boolean().default(false),
      suppliers: z.boolean().default(false),
    })
    .prefault({}),
});
export type CreateStoreInput = z.infer<typeof createStoreSchema>;

export const switchStoreSchema = z.object({ tenantCode: tenantCodeSchema });
export type SwitchStoreInput = z.infer<typeof switchStoreSchema>;
