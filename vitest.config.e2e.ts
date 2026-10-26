import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'vitest/config';

// e2e tests run against a separate database that test/global-setup.ts resets and seeds:
// TEST_DATABASE_URL, or DATABASE_URL with "_test" appended to the database name.
loadEnv({ quiet: true });
function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const url = new URL(process.env.DATABASE_URL ?? '');
  url.pathname = `${url.pathname}_test`;
  return url.toString();
}

// Also set here so global-setup and the Prisma CLI it runs use the test database.
process.env.DATABASE_URL = testDatabaseUrl();

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    env: { DATABASE_URL: process.env.DATABASE_URL, LOG_LEVEL: 'silent' },
    globalSetup: ['./test/global-setup.ts'],
    // Files share one database; run them one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
