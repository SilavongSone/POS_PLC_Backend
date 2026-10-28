import { RequestContext } from './request-context.js';

/**
 * Tiny in-process cache for hot, rarely-changing reference data (settings, current
 * exchange rates, default VAT). Entries are kept per tenant (the request's tenant is part
 * of the key) and expire after `ttlMs`, so with several API instances a change made on
 * one is visible on the others within that time; the instance that made the change
 * clears its own cache at once.
 */
export class TtlCache<T> {
  private readonly entries = new Map<
    string,
    { value: Promise<T>; expires: number }
  >();

  constructor(
    private readonly ttlMs: number,
    /** Expired entries are swept when the map grows past this many keys. */
    private readonly maxEntries = 5_000,
  ) {}

  private scoped(key: string): string {
    return `${RequestContext.get()?.tenantId ?? '-'}:${key}`;
  }

  get(key: string, load: () => Promise<T>): Promise<T> {
    const k = this.scoped(key);
    const hit = this.entries.get(k);
    if (hit && hit.expires > Date.now()) return hit.value;
    if (this.entries.size >= this.maxEntries) this.sweep();
    const value = load();
    this.entries.set(k, { value, expires: Date.now() + this.ttlMs });
    // A failed load must not be cached.
    value.catch(() => this.entries.delete(k));
    return value;
  }

  /** Drops the current tenant's entries. */
  clear(): void {
    const prefix = this.scoped('');
    for (const k of this.entries.keys()) {
      if (k.startsWith(prefix)) this.entries.delete(k);
    }
  }

  private sweep(): void {
    const now = Date.now();
    for (const [k, e] of this.entries)
      if (e.expires <= now) this.entries.delete(k);
  }
}
