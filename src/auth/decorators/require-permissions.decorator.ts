import { SetMetadata } from '@nestjs/common';
import type { Permission } from '../../common/permissions.js';

export const PERMISSIONS_KEY = 'permissions';

/** The signed-in user must hold every listed permission. */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
