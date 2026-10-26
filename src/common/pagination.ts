import { z } from 'zod';

/** Common list query: ?page=1&pageSize=20&q=search */
export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  q: z.string().trim().max(100).optional(),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

export type Page<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export function pageArgs({ page, pageSize }: PageQuery) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export function toPage<T>(
  items: T[],
  total: number,
  query: PageQuery,
): Page<T> {
  return { items, total, page: query.page, pageSize: query.pageSize };
}

/** `true`/`false` query strings → boolean. */
export const queryBoolean = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true');
