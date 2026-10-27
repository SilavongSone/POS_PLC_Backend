import { AsyncLocalStorage } from 'node:async_hooks';

/** Per-request state, available anywhere below the HTTP layer without passing it around. */
export type RequestStore = {
  /** Tenant every Prisma query is scoped to. */
  tenantId?: string;
  /** Platform-admin code may read and write across tenants (it must set tenantId itself). */
  platform?: boolean;
  requestId?: string;
  /** Resolved response language. */
  lang?: string;
};

const storage = new AsyncLocalStorage<RequestStore>();

export class TenantContextMissingError extends Error {
  constructor(what: string) {
    super(`No tenant in context for ${what}`);
  }
}

export const RequestContext = {
  /** Runs `fn` with a fresh store; used per HTTP request, and by scripts and tests. */
  run<T>(store: RequestStore, fn: () => T): T {
    return storage.run(store, fn);
  },

  get(): RequestStore | undefined {
    return storage.getStore();
  },

  /** Scopes the rest of the current request to `tenantId` (after login or token check). */
  setTenant(tenantId: string): void {
    const store = storage.getStore();
    if (!store) throw new Error('setTenant called outside a request context');
    store.tenantId = tenantId;
  },

  tenantId(): string {
    const id = storage.getStore()?.tenantId;
    if (!id) throw new TenantContextMissingError('this operation');
    return id;
  },

  /** Runs `fn` as `tenantId`, keeping the rest of the store (language, request id). */
  withTenant<T>(tenantId: string, fn: () => T): T {
    return storage.run(
      { ...storage.getStore(), tenantId, platform: false },
      fn,
    );
  },

  /** Runs `fn` without tenant scoping — platform-admin code only. */
  asPlatform<T>(fn: () => T): T {
    return storage.run(
      { ...storage.getStore(), tenantId: undefined, platform: true },
      fn,
    );
  },
};
