import { execSync } from 'node:child_process';

/**
 * Brings the e2e database up to date and seeds reference data + demo products.
 * Non-destructive (no reset): tests create their own uniquely named rows.
 */
export default function setup() {
  const env = {
    ...process.env,
    SEED_DEMO: 'true',
    // Same as test.env in vitest.config.e2e.ts (global setup does not get those).
    PLATFORM_ADMIN_EMAIL: 'platform@test.local',
    PLATFORM_ADMIN_PASSWORD: 'platform-password-1',
  };
  const run = (cmd: string) => execSync(cmd, { env, stdio: 'pipe' });
  run('npx prisma migrate deploy');
  run('npx prisma db seed');
}
