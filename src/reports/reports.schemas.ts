import { z } from 'zod';
import { pageQuerySchema } from '../common/pagination.js';

const isoDate = z.iso.date();

/** Local (Asia/Vientiane) date range; both ends inclusive. Defaults to today. */
export const dateRangeSchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    /** One branch; default = every branch the user may see. */
    branchId: z.uuid().optional(),
  })
  .refine((r) => !r.from || !r.to || r.from <= r.to, {
    message: '"from" must not be after "to"',
  });

export const salesSummarySchema = dateRangeSchema.and(
  z.object({
    groupBy: z
      .enum(['day', 'month', 'cashier', 'register', 'branch', 'paymentType'])
      .default('day'),
  }),
);

export const bestSellersSchema = dateRangeSchema.and(
  z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    categoryId: z.uuid().optional(),
    by: z.enum(['quantity', 'revenue', 'profit']).default('quantity'),
  }),
);

export const stockDocsReportSchema = dateRangeSchema.and(
  z.object({ type: z.enum(['RECEIVE', 'ISSUE', 'ADJUST']).default('RECEIVE') }),
);

export type DateRange = z.infer<typeof dateRangeSchema>;
export type SalesSummaryQuery = z.infer<typeof salesSummarySchema>;
export type BestSellersQuery = z.infer<typeof bestSellersSchema>;
export type StockDocsReportQuery = z.infer<typeof stockDocsReportSchema>;

/** Page + optional branch, for reports without a date range. */
export const branchPageSchema = pageQuerySchema.extend({
  branchId: z.uuid().optional(),
});

/** Date range + page (?page, pageSize ≤ 100). */
export const pagedRangeSchema = dateRangeSchema.and(pageQuerySchema);
