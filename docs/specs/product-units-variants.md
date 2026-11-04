# Selling units and product variants (spec, 2026-11-04)

## Problem

Today one `Product` row = one SKU = one barcode = one price = one stock count, and
`Product.unit` is only a label. Two common shop situations do not fit:

1. **Same item, different packs.** Thermal paper 80×80 is sold per roll, per pack of 10
   and per carton of 50. Today the shop must create 3 products ("Paper 80×80 roll",
   "… pack", "… carton") with 3 separate stocks that never add up: selling a carton does
   not reduce the rolls, receiving cartons does not create rolls, and search returns three
   near-identical rows.
2. **Same model, different versions.** Paper 80×80 vs 57×40, XP-T80Q USB+WiFi vs USB+LAN.
   These really are different stock (different barcode, price, serials), but name, brand,
   category, specs, photos and warranty are shared. Today: separate products created with
   the "duplicate" button (decision 2026-11-04); shared details drift apart and the list
   shows them as unrelated rows.

These are two different problems and need two different tools. Mixing them (e.g. making
"carton" a variant) would break stock: a carton is 50 rolls of the same stock, a size is
not.

## Solution overview

| | Selling units (packs) | Variants |
|---|---|---|
| Example | roll / pack ×10 / carton ×50 | 80×80 / 57×40; WiFi / LAN |
| Stock | **one** stock, kept in the base unit | **own** stock per variant |
| Barcode, price | own per unit | own per variant |
| Serial numbers | not allowed (serials are per piece) | per variant |
| Data | `ProductUnit` rows under a product | `ProductGroup` above products |

Phase 1 = selling units (the paper-roll case, biggest daily pain). Phase 2 = variants.

## Phase 1 — selling units

### Data

```prisma
model ProductUnit {            // a pack the product is also sold/bought in
  id             String   @id @default(uuid())
  tenantId       String   // scoped like other company tables
  productId      String
  unit           String   // Unit.name (code), e.g. "pack", "carton"
  factor         Int      // base units per pack, ≥ 2 (pack = 10 rolls)
  barcode        String?  // own barcode; unique per company across Product.barcode/sku too
  retailPrice    Decimal  @db.Decimal(18, 2)   // in Product.priceCurrency
  wholesalePrice Decimal? @db.Decimal(18, 2)
  isActive       Boolean  @default(true)
  sortOrder      Int      @default(0)
  @@unique([tenantId, barcode])
  @@unique([productId, unit])
}
```

- The product itself stays the **base unit** (roll): its `unit`, `barcode`, prices,
  `stockQty`, `lowStockAlert`, `avgCostLak` are per base unit, so nothing existing changes.
- Line tables get a snapshot: `SaleItem`, `QuotationItem`, `StockDocumentItem`,
  `ServiceTicketLine`: `productUnitId String?`, `unitName String?`, `unitFactor Int @default(1)`.
  `quantity` stays the number of the chosen unit (2 cartons); stock moves
  `quantity × unitFactor` base units; `unitCostLak` on the sale line = average cost × factor.
- Returns use the sale line's unit and factor (return 1 carton = +50 rolls).
- Branch prices: `BranchPrice` gets an optional `productUnitId` later; phase 1 uses the
  unit's own price everywhere.

### Rules

- Not allowed on serial-tracked products (400 `UNIT_NOT_FOR_SERIAL`).
- Barcode of a unit must not equal any product barcode/SKU or another unit's barcode
  (409 `PRODUCT_BARCODE_EXISTS` with `field`, same message as products).
- The suggested price of a new unit = base price × factor (shop edits it to give the pack
  discount).
- Deleting a unit that appears on documents switches it off instead (history keeps the
  snapshot anyway).
- Stock shows in the base unit with a breakdown: "120 ມ້ວນ (2 ແກັດ + 20 ມ້ວນ)".

### API

- `GET/POST/PATCH /products` accept and return `units: ProductUnit[]` (replace the whole
  list on update, like branch prices).
- `GET /products/lookup?code=` also matches unit barcodes and returns `{ product, unit }`.
- `POST /sales`, `/quotations`, stock documents: items take optional `productUnitId`.

### Screens

- **Product form**: section "Selling units" under prices: rows of
  [unit ▾] [= factor × base unit] [barcode] [retail] [wholesale]; "add pack" button;
  hidden for serial products.
- **Till**: scanning a pack barcode adds that pack. Tapping a product with packs opens a
  small picker (roll ₭25,000 / pack ₭240,000 / carton ₭1,150,000); the cart line shows the
  unit and can be switched. Receipt prints "2 ແກັດ (×50)".
- **Stock receive**: choose the unit per line (buy 4 cartons at ₭1,000,000 → +200 rolls,
  cost ₭20,000/roll).
- **Labels**: print labels per unit (the carton label carries the carton barcode/price).
- **Products list / search**: one row per product; unit barcodes are searchable.

## Phase 2 — variants

### Data

```prisma
model ProductGroup {           // the shared "parent": what the variants have in common
  id, tenantId, name, nameI18n, descriptionI18n, categoryId, brandId, model,
  specs Json?, warrantyMonths, images (moved here or shared), options Json
  // options = [{ "name": "Size", "values": ["80×80", "57×40"] }]
}
Product.groupId      String?   // a variant = a normal product in a group
Product.optionValues Json?     // { "Size": "80×80" }
```

- A variant stays a full `Product` (own SKU, barcode, price, stock, serials, packs), so the
  till, stock, reports and serial logic need no change.
- Display name = group name + option values ("Thermal paper — 80×80").
- Editing shared fields on the group writes them to every variant in one transaction.
- Products list groups variants under their parent (expand row); filters and reports can
  roll up by group.
- Product form: "This product has versions" → options editor → variant grid (SKU, barcode,
  price, cost, stock alert per combination), generated from the option values.
- Existing look-alike products can be joined into a group (pick products → "make variants").

## Order of work

1. Phase 1 backend: schema + migration, product CRUD with units, lookup, sale/quotation/
   stock document/return quantity × factor, tests (stock and money math).
2. Phase 1 frontend: product form section, till picker + scan, receive unit, labels,
   receipt/quotation text.
3. Phase 2 backend + frontend (groups, variant grid, grouped list).
