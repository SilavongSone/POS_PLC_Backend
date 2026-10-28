import { DocNumberService } from '../src/common/doc-number.service.js';
import { createTestApp, type TestApp } from './helpers.js';

describe('Common infrastructure (e2e)', () => {
  let t: TestApp;
  // The e2e database is not reset between runs, so prefixes must be unique per run.
  const run = Date.now().toString(36).toUpperCase();
  beforeAll(async () => (t = await createTestApp()));
  afterAll(() => t.close());

  it('issues gap-free document numbers per scope', async () => {
    const docs = t.app.get(DocNumberService);
    const at = new Date('2026-10-26T03:00:00Z');
    const [a, b] = await t.prisma.$transaction(async (tx) => [
      await docs.daily(tx, `T${run}`, at),
      await docs.daily(tx, `T${run}`, at),
    ]);
    expect([a, b]).toEqual([`T${run}-261026-0001`, `T${run}-261026-0002`]);
    expect(
      await t.prisma.$transaction((tx) => docs.yearly(tx, `I${run}`, at)),
    ).toBe(`I${run}-2026-000001`);
  });

  it('rolls the counter back with the transaction', async () => {
    const docs = t.app.get(DocNumberService);
    await expect(
      t.prisma.$transaction(async (tx) => {
        await docs.sequential(tx, `R${run}`);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(
      await t.prisma.$transaction((tx) => docs.sequential(tx, `R${run}`, 3)),
    ).toBe(`R${run}001`);
  });
});
