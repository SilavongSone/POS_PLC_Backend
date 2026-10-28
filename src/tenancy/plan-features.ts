/** Feature flags a plan can switch on. See docs/saas-design.md §5.1. */
export const FEATURES = [
  'multiCurrency',
  'creditSales',
  'promotions',
  'bundles',
  'quotations',
  'repairs',
  'taxInvoices',
  'expenses',
  'lots',
  'stockTransfers',
  'advancedReports',
  'auditLog',
] as const;
export type Feature = (typeof FEATURES)[number];

/** Countable resources a plan can cap; null = unlimited. */
export const LIMIT_KEYS = [
  'maxBranches',
  'maxRegisters',
  'maxUsers',
  'maxProducts',
  'maxSalesPerMonth',
] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];
export type PlanLimits = Record<LimitKey, number | null>;

type DefaultPlan = {
  code: string;
  name: string;
  nameI18n: Record<'lo' | 'th' | 'en', string>;
  priceMonthlyLak: number;
  priceYearlyLak: number;
  limits: PlanLimits;
  features: Feature[];
  trialDays: number;
  sortOrder: number;
};

const STARTER: Feature[] = [
  'multiCurrency',
  'creditSales',
  'expenses',
  'taxInvoices',
];
const BUSINESS: Feature[] = [
  ...STARTER,
  'promotions',
  'bundles',
  'quotations',
  'repairs',
  'lots',
  'stockTransfers',
  'advancedReports',
];

/**
 * Plans created by the seed when missing (the SaaS migration inserts the same rows).
 * Prices are examples; platform admins change plans through /platform/plans.
 */
export const DEFAULT_PLANS: DefaultPlan[] = [
  {
    code: 'FREE',
    name: 'Free',
    nameI18n: { lo: 'ຟຣີ', th: 'ฟรี', en: 'Free' },
    priceMonthlyLak: 0,
    priceYearlyLak: 0,
    limits: {
      maxBranches: 1,
      maxRegisters: 1,
      maxUsers: 2,
      maxProducts: 200,
      maxSalesPerMonth: 300,
    },
    features: [],
    trialDays: 0,
    sortOrder: 1,
  },
  {
    code: 'STARTER',
    name: 'Starter',
    nameI18n: { lo: 'ເລີ່ມຕົ້ນ', th: 'เริ่มต้น', en: 'Starter' },
    priceMonthlyLak: 199_000,
    priceYearlyLak: 1_990_000,
    limits: {
      maxBranches: 1,
      maxRegisters: 2,
      maxUsers: 5,
      maxProducts: 2_000,
      maxSalesPerMonth: null,
    },
    features: STARTER,
    trialDays: 14,
    sortOrder: 2,
  },
  {
    code: 'BUSINESS',
    name: 'Business',
    nameI18n: { lo: 'ທຸລະກິດ', th: 'ธุรกิจ', en: 'Business' },
    priceMonthlyLak: 499_000,
    priceYearlyLak: 4_990_000,
    limits: {
      maxBranches: 3,
      maxRegisters: 6,
      maxUsers: 20,
      maxProducts: 20_000,
      maxSalesPerMonth: null,
    },
    features: BUSINESS,
    trialDays: 14,
    sortOrder: 3,
  },
  {
    code: 'ENTERPRISE',
    name: 'Enterprise',
    nameI18n: { lo: 'ອົງກອນ', th: 'องค์กร', en: 'Enterprise' },
    priceMonthlyLak: 1_490_000,
    priceYearlyLak: 14_900_000,
    limits: {
      maxBranches: null,
      maxRegisters: null,
      maxUsers: null,
      maxProducts: null,
      maxSalesPerMonth: null,
    },
    features: [...FEATURES],
    trialDays: 14,
    sortOrder: 4,
  },
];
