import { RequestContext } from './request-context.js';
import { TtlCache } from './ttl-cache.js';

describe('TtlCache', () => {
  afterEach(() => vi.useRealTimers());

  it('loads once within the TTL and again after it', async () => {
    vi.useFakeTimers();
    const cache = new TtlCache<number>(1000);
    let calls = 0;
    const load = () => Promise.resolve(++calls);
    expect(await cache.get('k', load)).toBe(1);
    expect(await cache.get('k', load)).toBe(1);
    vi.advanceTimersByTime(1001);
    expect(await cache.get('k', load)).toBe(2);
  });

  it('does not keep failed loads, and clear() forces a reload', async () => {
    const cache = new TtlCache<number>(60_000);
    await expect(
      cache.get('k', () => Promise.reject(new Error('db down'))),
    ).rejects.toThrow();
    expect(await cache.get('k', () => Promise.resolve(5))).toBe(5);
    cache.clear();
    expect(await cache.get('k', () => Promise.resolve(6))).toBe(6);
  });

  it('keeps tenants apart, and clear() only drops the current tenant', async () => {
    const cache = new TtlCache<string>(60_000);
    const inTenant = (t: string, fn: () => Promise<string>) =>
      RequestContext.run({ tenantId: t }, fn);
    expect(await inTenant('a', () => cache.get('k', async () => 'A'))).toBe(
      'A',
    );
    expect(await inTenant('b', () => cache.get('k', async () => 'B'))).toBe(
      'B',
    );
    await inTenant('a', async () => {
      cache.clear();
      return '';
    });
    expect(await inTenant('a', () => cache.get('k', async () => 'A2'))).toBe(
      'A2',
    );
    expect(await inTenant('b', () => cache.get('k', async () => 'B2'))).toBe(
      'B',
    );
  });
});
