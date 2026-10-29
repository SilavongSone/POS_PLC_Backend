import { z } from 'zod';
import {
  apiSchema,
  currencySchema,
  dateTimeString,
  decimalString,
} from '../common/openapi.js';

const priceTier = z.enum(['RETAIL', 'WHOLESALE']);
const paymentKind = z.enum(['CASH', 'BANK_TRANSFER', 'QR', 'CARD', 'CREDIT']);
const paymentStatus = z.enum(['PAID', 'PARTIAL', 'UNPAID']);
const userRef = z.strictObject({ id: z.uuid(), fullName: z.string() });

// ── POST /sales/quote ──

/** A priced cart line (sale-pricing.service.ts PricedLine). Amounts in LAK. */
export const pricedLineSchema = apiSchema(
  'PricedLine',
  z.strictObject({
    productId: z.uuid(),
    /** Product name in the request language, or a service's own description. */
    productName: z.string(),
    sku: z.string(),
    /** Bundles: components and the serials scanned for each. */
    components: z.array(
      z.strictObject({
        productId: z.uuid(),
        quantity: z.int(),
        serials: z.array(z.string()),
        warrantyMonths: z.int(),
      }),
    ),
    quantity: z.int(),
    serials: z.array(z.string()),
    listPriceLak: decimalString,
    unitPriceLak: decimalString,
    /** The unit price was set by hand (needs price.override). */
    overridden: z.boolean(),
    promotionId: z.uuid().nullable(),
    promotionDiscountLak: decimalString,
    manualDiscountLak: decimalString,
    discountLak: decimalString,
    lineTotalLak: decimalString,
    warrantyMonths: z.int(),
    vatExempt: z.boolean(),
    countsStock: z.boolean(),
  }),
);

/** A checked payment (sale-pricing.service.ts PlannedPayment). */
export const plannedPaymentSchema = apiSchema(
  'PlannedPayment',
  z.strictObject({
    paymentTypeId: z.uuid(),
    name: z.string(),
    kind: paymentKind,
    currency: currencySchema,
    /** Tendered, in `currency`. */
    amount: decimalString,
    /** Exchange-rate snapshot (1 for LAK). */
    lakPerUnit: decimalString,
    amountLak: decimalString,
    reference: z.string().nullable(),
  }),
);

/** How the tendered payments cover the total (sale-pricing.service.ts PaymentPlan). */
export const paymentPlanSchema = apiSchema(
  'PaymentPlan',
  z.strictObject({
    payments: z.array(plannedPaymentSchema),
    tenderedLak: decimalString,
    creditLak: decimalString,
    paidLak: decimalString,
    /** Given back in LAK; only possible with a cash payment. */
    changeLak: decimalString,
    paymentStatus,
  }),
);

export const saleQuoteSchema = apiSchema(
  'SaleQuote',
  z.strictObject({
    customer: z
      .strictObject({
        id: z.uuid(),
        name: z.string(),
        creditLimitLak: decimalString,
      })
      .nullable(),
    priceTier,
    lines: z.array(pricedLineSchema),
    subtotalLak: decimalString,
    /** Whole-bill discount. */
    discountLak: decimalString,
    taxRateId: z.uuid().nullable(),
    vatPercent: decimalString,
    pricesIncludeVat: z.boolean(),
    vatLak: decimalString,
    totalLak: decimalString,
    /** Permissions the cart needs from the user or a manager approval. */
    needsApproval: z.array(z.enum(['price.override', 'sale.discount'])),
    /**
     * null without payments; `{ error }` when the payments do not cover the cart
     * (the message a sale would fail with).
     */
    payment: z
      .union([paymentPlanSchema, z.strictObject({ error: z.string() })])
      .nullable(),
  }),
);

// ── Sale (POST /sales, receipt) ──

export const saleItemSchema = apiSchema(
  'SaleItem',
  z.strictObject({
    id: z.uuid(),
    tenantId: z.uuid(),
    saleId: z.uuid(),
    productId: z.uuid(),
    /** Product name at the time of sale. */
    productName: z.string(),
    quantity: z.int(),
    listPriceLak: decimalString,
    unitPriceLak: decimalString,
    priceOverriddenById: z.uuid().nullable(),
    promotionId: z.uuid().nullable(),
    discountLak: decimalString,
    lineTotalLak: decimalString,
    /** Cost snapshot (average cost at sale time). */
    unitCostLak: decimalString
      .optional()
      .meta({ description: 'Only with the product.viewCost permission' }),
    warrantyMonths: z.int(),
    serialNumbers: z.array(
      z.strictObject({
        id: z.uuid(),
        serial: z.string(),
        warrantyEndsAt: dateTimeString.nullable(),
        condition: z.enum(['NEW', 'DEMO']),
      }),
    ),
    promotion: z.strictObject({ id: z.uuid(), name: z.string() }).nullable(),
  }),
);

export const salePaymentSchema = apiSchema(
  'SalePayment',
  z.strictObject({
    id: z.uuid(),
    saleId: z.uuid(),
    paymentTypeId: z.uuid(),
    currency: currencySchema,
    /** Tendered, in `currency`. */
    amount: decimalString,
    /** Exchange-rate snapshot used for this payment (1 for LAK). */
    lakPerUnit: decimalString,
    amountLak: decimalString,
    reference: z.string().nullable(),
    createdAt: dateTimeString,
    paymentType: z.strictObject({
      id: z.uuid(),
      name: z.string(),
      kind: paymentKind,
    }),
  }),
);

export const saleSchema = apiSchema(
  'Sale',
  z.strictObject({
    id: z.uuid(),
    branchId: z.uuid(),
    tenantId: z.uuid(),
    receiptNo: z.string(),
    status: z.enum(['COMPLETED', 'VOIDED']),
    paymentStatus,
    cashierId: z.uuid(),
    registerId: z.uuid().nullable(),
    shiftId: z.uuid().nullable(),
    customerId: z.uuid().nullable(),
    quotationId: z.uuid().nullable(),
    priceTier,
    subtotalLak: decimalString,
    discountLak: decimalString,
    taxRateId: z.uuid().nullable(),
    vatPercent: decimalString,
    pricesIncludeVat: z.boolean(),
    vatLak: decimalString,
    totalLak: decimalString,
    /** Non-credit payments (+ later debt payments); totalLak − paidLak is still owed. */
    paidLak: decimalString,
    changeLak: decimalString,
    dueDate: dateTimeString.nullable(),
    note: z.string().nullable(),
    printCount: z.int().min(0),
    voidedById: z.uuid().nullable(),
    voidedAt: dateTimeString.nullable(),
    voidReason: z.string().nullable(),
    createdAt: dateTimeString,
    items: z.array(saleItemSchema),
    payments: z.array(salePaymentSchema),
    customer: z
      .strictObject({
        id: z.uuid(),
        code: z.string(),
        name: z.string(),
        companyName: z.string().nullable(),
        phone: z.string().nullable(),
        taxId: z.string().nullable(),
      })
      .nullable(),
    cashier: userRef,
    voidedBy: userRef.nullable(),
    register: z
      .strictObject({ id: z.uuid(), code: z.string(), name: z.string() })
      .nullable(),
    /** Tax invoices issued for the sale and not cancelled. */
    taxInvoices: z.array(
      z.strictObject({ id: z.uuid(), invoiceNo: z.string() }),
    ),
  }),
);

export const saleReceiptSchema = apiSchema(
  'SaleReceipt',
  z.strictObject({
    /** Store details from settings ("" when not set). */
    store: z.strictObject({
      name: z.string(),
      companyName: z.string(),
      taxId: z.string(),
      phone: z.string(),
      address: z.string(),
      logoUrl: z.string(),
      footer: z.string(),
    }),
    paperSize: z.enum(['58mm', '80mm', 'A5', 'A4']),
    sale: saleSchema,
    /** Total in words in the request language. */
    totalInWords: z.string(),
    totalInWordsAll: z.strictObject({
      lo: z.string(),
      th: z.string(),
      en: z.string(),
    }),
    /** The receipt was printed before (record the print with POST /sales/:id/printed). */
    isReprint: z.boolean(),
  }),
);

export const printCountSchema = apiSchema(
  'PrintCount',
  z.strictObject({ printCount: z.int().min(1) }),
);
