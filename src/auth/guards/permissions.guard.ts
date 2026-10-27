import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { hasPermission, type Permission } from '../../common/permissions.js';
import type { AuthUser } from '../auth.types.js';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator.js';

/** Global guard that enforces @RequirePermissions(); runs after JwtAuthGuard. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;

    const { user } = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>();
    const missing = required.filter(
      (p) => !user || !hasPermission(user.permissions, p),
    );
    if (missing.length) {
      throw new ForbiddenException({
        message: `Missing permission: ${missing.join(', ')}`,
        code: 'MISSING_PERMISSION',
        permission: missing.join(', '),
      });
    }
    return true;
  }
}
