import { PERMISSIONS, SYSTEM_GROUPS, hasPermission } from './permissions.js';

describe('permissions', () => {
  it('grants everything to the "*" wildcard', () => {
    expect(
      PERMISSIONS.every((p) => hasPermission(SYSTEM_GROUPS.Admin, p)),
    ).toBe(true);
  });

  it('keeps settings and user management away from managers', () => {
    expect(hasPermission(SYSTEM_GROUPS.Manager, 'sale.void')).toBe(true);
    expect(hasPermission(SYSTEM_GROUPS.Manager, 'settings.manage')).toBe(false);
    expect(hasPermission(SYSTEM_GROUPS.Manager, 'users.manage')).toBe(false);
  });

  it('does not let cashiers void, override prices or see costs', () => {
    expect(hasPermission(SYSTEM_GROUPS.Cashier, 'sale.create')).toBe(true);
    expect(hasPermission(SYSTEM_GROUPS.Cashier, 'sale.void')).toBe(false);
    expect(hasPermission(SYSTEM_GROUPS.Cashier, 'price.override')).toBe(false);
    expect(hasPermission(SYSTEM_GROUPS.Cashier, 'product.viewCost')).toBe(
      false,
    );
  });

  it('only lets viewers browse the catalog', () => {
    expect(SYSTEM_GROUPS.Viewer).toEqual(['catalog.view']);
  });
});
