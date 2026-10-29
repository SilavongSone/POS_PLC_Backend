# POS_PLC_Backend

NestJS 12 + Prisma 7 + PostgreSQL REST API for the PLC POS (a shop selling POS equipment: terminals, printers, monitors, scanners, cash drawers, consumables).

## Design first

- System analysis and database design live in `docs/database-design.md`; scope, priorities and milestones are in `docs/product-plan.md`; the API map and till flows are in `docs/api-overview.md`; security, performance and production settings are in `docs/operations.md`. Read them before changing `prisma/schema.prisma` or adding modules, and update it when the design changes.
- Money: LAK = `Decimal(18, 0)`, THB/USD = `Decimal(18, 2)`, exchange rates = `Decimal(18, 4)`.
- Migrations that add required columns must back-fill existing rows (see `prisma/migrations/*_redesign_full_schema`); constraints Prisma can't express (partial unique indexes) go in the migration SQL.
- Permission codes live in `src/common/permissions.ts`; reference data comes from `prisma/seed.ts` (idempotent — never overwrite admin edits).
- Every stock change goes through one transaction: `Product.stockQty` + a `StockMovement` row (+ `SerialNumber` status).

## Multi-company (SaaS) rules — see `docs/saas-design.md`

- Every company table has `tenantId`; the Prisma extension (`src/prisma/tenant-extension.ts`) scopes all queries from the request context and throws without one. Scripts/tests run inside `RequestContext.run({ tenantId }, …)`; platform code uses `RequestContext.asPlatform()` and sets `tenantId` itself.
- Raw SQL is not scoped automatically: always filter `"tenantId" = ${RequestContext.tenantId()}` (and the branch scope for reports).
- Child tables without `tenantId` (items, payments, images …) are reached only through a parent loaded with a scoped query. Ids sent by clients must be looked up through a scoped query before being stored.
- Unique keys are per company: use `findFirst({ where: { sku } })`, not `findUnique`, for business keys.
- Stock changes go through `StockLedgerService` with `ref.branchId`: it keeps `BranchStock` (per branch) and `Product.stockQty` (total) in step.
- Gate plan features with `@RequireFeature()` / `EntitlementsService.assertFeature()`, and creations with `assertLimit()`.
- Errors: throw with `{ message, code }`; add the code to `src/i18n/messages/{lo,th,en}.ts`. Update schemas use `patchOf()` (zod 4 applies defaults inside `.partial()`).
- API contract: when a response changes, update its zod schema in `src/<module>/<module>.responses.ts` (checked by `test/contract.e2e-spec.ts`) and run `pnpm build && pnpm openapi:export` to regenerate `docs/openapi.json` (CI fails if it is stale).
