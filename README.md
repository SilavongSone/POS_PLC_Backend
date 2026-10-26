# POS_PLC_Backend

REST API for the PLC POS system — NestJS 12 + Prisma 7 + PostgreSQL.

## Setup

```bash
pnpm install
cp .env.example .env
docker compose up -d          # PostgreSQL 17 on localhost:5433 (or use a native PostgreSQL on 5432)
npx prisma migrate dev        # on Windows with Smart App Control: .\scripts\prisma.ps1 migrate dev
npx prisma db seed            # reference data + user admin / admin1234 (set SEED_ADMIN_PASSWORD to override)
                              # SEED_DEMO=true npx prisma db seed  → also demo products with stock
pnpm start:dev                # http://localhost:4000/api  ·  Swagger: /api/docs
```

## Scripts

- `pnpm build` / `pnpm start:prod`
- `pnpm test` / `pnpm test:e2e`
- `pnpm lint`
- `npx prisma generate` — regenerate the client after editing `prisma/schema.prisma`

Design docs: `docs/database-design.md` (schema, business rules) and `docs/product-plan.md` (scope, milestones).
