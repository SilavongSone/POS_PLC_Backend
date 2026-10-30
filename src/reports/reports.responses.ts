import { z } from 'zod';
import { apiSchema, dateTimeString, decimalString } from '../common/openapi.js';

/** Sales totals (reports.service.ts withProfit); cost and profit only with product.viewCost. */
const summaryFields = {
  count: z.int(),
  totalLak: decimalString,
  vatLak: decimalString,
  discountLak: decimalString,
  /** Total without VAT. */
  netLak: decimalString,
  costLak: decimalString.optional(),
  profitLak: decimalString.optional(),
  /** Profit / net × 100; null when net is 0. */
  marginPercent: decimalString.nullable().optional(),
};

export const salesTotalsSchema = apiSchema(
  'SalesTotals',
  z.strictObject(summaryFields),
);

export const salesGroupSchema = apiSchema(
  'SalesGroup',
  z.strictObject({
    /** Day (YYYY-MM-DD), month (YYYY-MM) or an id, by groupBy. */
    key: z.string(),
    label: z.string().nullable(),
    ...summaryFields,
  }),
);

export const bestSellerSchema = apiSchema(
  'BestSeller',
  z.strictObject({
    productId: z.uuid(),
    sku: z.string(),
    name: z.string(),
    quantity: z.int(),
    revenueLak: decimalString,
    costLak: decimalString.optional(),
    profitLak: decimalString.optional(),
  }),
);

/** GET /reports/dashboard: today, the last 7 days (days with sales only), alerts and open shifts. */
export const dashboardSchema = apiSchema(
  'Dashboard',
  z.strictObject({
    /** Today in the shop's time zone (YYYY-MM-DD). */
    date: z.string(),
    today: salesTotalsSchema,
    last7Days: z.array(salesGroupSchema),
    topProductsToday: z.array(bestSellerSchema),
    alerts: z.strictObject({
      lowStockProducts: z.int(),
      lotsExpiringIn30Days: z.int(),
      repairsReadyForPickup: z.int(),
    }),
    debts: z.strictObject({
      openSales: z.int(),
      outstandingLak: decimalString,
      overdueLak: decimalString,
    }),
    openShifts: z.array(
      z.strictObject({
        id: z.uuid(),
        openedAt: dateTimeString,
        register: z.strictObject({ code: z.string() }),
        user: z.strictObject({ fullName: z.string() }),
      }),
    ),
  }),
);

/** groupBy=paymentType rows: money received per type and currency. */
export const paymentGroupSchema = apiSchema(
  'PaymentGroup',
  z.strictObject({
    key: z.uuid(),
    label: z.string(),
    kind: z.enum(['CASH', 'BANK_TRANSFER', 'QR', 'CARD', 'CREDIT']),
    currency: z.enum(['LAK', 'THB', 'USD']),
    count: z.int(),
    amount: decimalString,
    amountLak: decimalString,
  }),
);

export const salesSummarySchema = apiSchema(
  'SalesSummary',
  z.strictObject({
    from: z.string(),
    to: z.string(),
    groupBy: z.enum([
      'day',
      'month',
      'cashier',
      'register',
      'branch',
      'paymentType',
    ]),
    totals: salesTotalsSchema,
    /** Refunds in the period (any sale date); not deducted from totals. */
    returns: z.strictObject({ count: z.int(), refundLak: decimalString }),
    groups: z.array(z.union([salesGroupSchema, paymentGroupSchema])),
  }),
);

export const bestSellersReportSchema = apiSchema(
  'BestSellers',
  z.strictObject({
    from: z.string(),
    to: z.string(),
    items: z.array(bestSellerSchema),
  }),
);
