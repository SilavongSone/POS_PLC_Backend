# POS_PLC_Backend

REST API for the PLC POS system — NestJS 12 + Prisma 7 + PostgreSQL.

POS for a shop selling POS equipment (LAK with THB/USD, VAT 12%): auth with PIN and manager approval,
catalog with serials/lots/bundles, stock documents and ledger, multi-register shifts, sales with
promotions, credit and tax invoices, returns, debts, expenses, quotations, repairs and reports.
See `docs/api-overview.md` for the API map and till flows, and `docs/operations.md` for
production settings, security and benchmark results.

## Setup

```bash
pnpm install
cp .env.example .env           # set JWT_SECRET (openssl rand -base64 48)
docker compose up -d          # PostgreSQL 17 on localhost:5433 (or use a native PostgreSQL on 5432)
npx prisma migrate dev        # on Windows with Smart App Control: .\scripts\prisma.ps1 migrate dev
npx prisma db seed            # reference data + user admin / admin1234 (set SEED_ADMIN_PASSWORD to override)
                              # SEED_DEMO=true npx prisma db seed  → also demo products with stock
pnpm start:dev                # http://localhost:4000/api  ·  Swagger: /api/docs
```

## Scripts

- `pnpm build` / `pnpm start:prod`
- `pnpm test` / `pnpm test:e2e` — e2e runs against `<DATABASE_URL db>_test` (or `TEST_DATABASE_URL`), migrated and seeded automatically; it is never reset, so tests use unique data
- `pnpm lint`
- `npx prisma generate` — regenerate the client after editing `prisma/schema.prisma`

Design docs: `docs/database-design.md` (schema, business rules) and `docs/product-plan.md` (scope, milestones).
