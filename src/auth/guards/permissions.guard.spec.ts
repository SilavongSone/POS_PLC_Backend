import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '../../common/permissions.js';
import { PermissionsGuard } from './permissions.guard.js';

function contextFor(permissions: string[] | undefined): ExecutionContext {
  const user = permissions && { permissions };
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  function guardRequiring(required: Permission[] | undefined) {
    const reflector = {
      getAllAndOverride: () => required,
    } as unknown as Reflector;
    return new PermissionsGuard(reflector);
  }

  it('allows routes without @RequirePermissions', () => {
    expect(guardRequiring(undefined).canActivate(contextFor([]))).toBe(true);
  });

  it('allows a user holding every required permission', () => {
    const guard = guardRequiring(['sale.create', 'sale.hold']);
    expect(guard.canActivate(contextFor(['sale.create', 'sale.hold']))).toBe(
      true,
    );
  });

  it('allows the "*" wildcard', () => {
    expect(
      guardRequiring(['users.manage']).canActivate(contextFor(['*'])),
    ).toBe(true);
  });

  it('rejects a user missing any required permission', () => {
    const guard = guardRequiring(['sale.create', 'sale.void']);
    expect(() => guard.canActivate(contextFor(['sale.create']))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects when there is no user', () => {
    expect(() =>
      guardRequiring(['sale.create']).canActivate(contextFor(undefined)),
    ).toThrow(ForbiddenException);
  });
});
