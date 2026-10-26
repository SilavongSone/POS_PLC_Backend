/**
 * Permission codes stored in UserGroup.permissions. "*" grants everything.
 * See docs/database-design.md §6 for the default groups.
 */
export const PERMISSIONS = [
  'catalog.view',
  'product.manage',
  'product.viewCost',
  'sale.create',
  'sale.hold',
  'sale.reprint',
  'sale.discount',
  'sale.void',
  'price.override',
  'taxInvoice.issue',
  'customer.manage',
  'debt.receive',
  'shift.operate',
  'cash.move',
  'return.create',
  'stock.receive',
  'stock.issue',
  'stock.adjust',
  'expense.manage',
  'quotation.manage',
  'repair.receive',
  'repair.manage',
  'report.view',
  'settings.manage',
  'users.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ALL_PERMISSIONS = '*';

const MANAGER: Permission[] = PERMISSIONS.filter(
  (p) => p !== 'settings.manage' && p !== 'users.manage',
);

const CASHIER: Permission[] = [
  'catalog.view',
  'sale.create',
  'sale.hold',
  'sale.reprint',
  'taxInvoice.issue',
  'customer.manage',
  'debt.receive',
  'shift.operate',
  'cash.move',
  'repair.receive',
];

/** Built-in groups created by the migration and kept in sync by the seed. */
export const SYSTEM_GROUPS: Record<
  'Admin' | 'Manager' | 'Cashier' | 'Viewer',
  string[]
> = {
  Admin: [ALL_PERMISSIONS],
  Manager: MANAGER,
  Cashier: CASHIER,
  Viewer: ['catalog.view'],
};

export function hasPermission(
  granted: readonly string[],
  required: Permission,
): boolean {
  return granted.includes(ALL_PERMISSIONS) || granted.includes(required);
}
