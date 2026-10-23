# POS_PLC_Backend

REST API for the PLC POS system — NestJS 12 + Prisma 7 + PostgreSQL.

## Setup

```bash
pnpm install
cp .env.example .env
docker compose up -d          # PostgreSQL 17
npx prisma migrate dev
pnpm start:dev                # http://localhost:4000/api  ·  Swagger: /api/docs
```

## Scripts

- `pnpm build` / `pnpm start:prod`
- `pnpm test` / `pnpm test:e2e`
- `pnpm lint`
- `npx prisma generate` — regenerate the client after editing `prisma/schema.prisma`
