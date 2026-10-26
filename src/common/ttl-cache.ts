/**
 * Tiny in-process cache for hot, rarely-changing reference data (settings, current
 * exchange rates, default VAT). Entries expire after `ttlMs`, so with several API
 * instances a change made on one is visible on the others within that time; the
 * instance that made the change clears its own cache at once.
 */
export class TtlCache<T> {
  private readonly entries = new Map<
    string,
    { value: Promise<T>; expires: number }
  >();

  constructor(private readonly ttlMs: number) {}

  get(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    const value = load();
    this.entries.set(key, { value, expires: Date.now() + this.ttlMs });
    // A failed load must not be cached.
    value.catch(() => this.entries.delete(key));
    return value;
  }

  clear(): void {
    this.entries.clear();
  }
}
