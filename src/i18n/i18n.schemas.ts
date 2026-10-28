import { z } from 'zod';

/** Translations of a name or description: `{ lo?, th?, en? }`. Send {} to remove them. */
export const i18nText = (max: number) =>
  z.strictObject({
    lo: z.string().trim().max(max).optional(),
    th: z.string().trim().max(max).optional(),
    en: z.string().trim().max(max).optional(),
  });
