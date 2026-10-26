# POS_PLC_Backend

NestJS 12 + Prisma 7 + PostgreSQL REST API for the PLC POS (a shop selling POS equipment: terminals, printers, monitors, scanners, cash drawers, consumables).

## Design first

- System analysis and database design live in `docs/database-design.md`; scope, priorities and milestones are in `docs/product-plan.md`. Read them before changing `prisma/schema.prisma` or adding modules, and update it when the design changes.
- Money: LAK = `Decimal(18, 0)`, THB/USD = `Decimal(18, 2)`, exchange rates = `Decimal(18, 4)`.
- Migrations that add required columns must back-fill existing rows (see `prisma/migrations/*_redesign_full_schema`); constraints Prisma can't express (partial unique indexes) go in the migration SQL.
- Permission codes live in `src/common/permissions.ts`; reference data comes from `prisma/seed.ts` (idempotent — never overwrite admin edits).
- Every stock change goes through one transaction: `Product.stockQty` + a `StockMovement` row (+ `SerialNumber` status).
