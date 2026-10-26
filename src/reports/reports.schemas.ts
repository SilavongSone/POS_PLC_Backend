import { z } from 'zod';

const isoDate = z.iso.date();

/** Local (Asia/Vientiane) date range; both ends inclusive. Defaults to today. */
export const dateRangeSchema = z
  .object({ from: isoDate.optional(), to: isoDate.optional() })
  .refine((r) => !r.from || !r.to || r.from <= r.to, {
    message: '"from" must not be after "to"',
  });

export const salesSummarySchema = dateRangeSchema.and(
  z.object({
    groupBy: z
      .enum(['day', 'month', 'cashier', 'register', 'paymentType'])
      .default('day'),
  }),
);

export const bestSellersSchema = dateRangeSchema.and(
  z.object({
    limit: z.coerce.number().int().min(1).max(200).default(20),
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
