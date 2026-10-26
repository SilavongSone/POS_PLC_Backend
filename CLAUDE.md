# POS_PLC_Backend

NestJS 12 + Prisma 7 + PostgreSQL REST API for the PLC POS (a shop selling POS equipment: terminals, printers, monitors, scanners, cash drawers, consumables).

## Design first

- System analysis and database design live in `docs/database-design.md`; the proposed full schema is `docs/schema.draft.prisma`; scope, priorities and milestones are in `docs/product-plan.md`. Read it before changing `prisma/schema.prisma` or adding modules, and update it when the design changes.
- Money: LAK = `Decimal(18, 0)`, THB/USD = `Decimal(18, 2)`, exchange rates = `Decimal(18, 4)`.
- Every stock change goes through one transaction: `Product.stockQty` + a `StockMovement` row (+ `SerialNumber` status).
