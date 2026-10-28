import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthUser } from '../auth/auth.types.js';
import { RequestContext } from '../common/request-context.js';
import { isLang } from '../i18n/i18n.js';
import { EntitlementsService } from './entitlements.service.js';
import type { Feature } from './plan-features.js';
import { FEATURE_KEY } from './require-feature.decorator.js';

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global guard, after JwtAuthGuard: the company must be active, writes need a current
 * subscription (or grace period), and @RequireFeature routes need the feature in the plan.
 * Sign-out and session refresh stay available so users can always leave.
 */
@Injectable()
export class EntitlementsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: EntitlementsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>();
    // Public and platform routes have no signed-in company user.
    if (!request.user) return true;

    const e = await this.entitlements.get(request.user.tenantId);
    const store = RequestContext.get();
    if (store && isLang(e.defaultLanguage))
      store.tenantLang = e.defaultLanguage;
    this.entitlements.assertNotBlocked(e);
    // Signing in/out and paying the plan stay possible while read-only.
    const exempt = ['/api/auth/', '/api/billing/'].some((p) =>
      request.path.startsWith(p),
    );
    if (!READS.has(request.method) && !exempt) {
      this.entitlements.assertWritable(e);
    }
    const feature = this.reflector.getAllAndOverride<Feature | undefined>(
      FEATURE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (feature) await this.entitlements.assertFeature(feature);
    return true;
  }
}
