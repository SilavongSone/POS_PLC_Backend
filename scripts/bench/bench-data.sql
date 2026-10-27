-- Benchmark data (run on an empty, migrated and seeded database): 10k products, 5k customers, 50k sales with 2 lines and 1 payment each.
\set ON_ERROR_STOP on
-- Rows go to the seeded company "plc": tenantId columns default to this session setting.
SELECT set_config('app.tenant_id', (SELECT id FROM "Tenant" WHERE code = 'plc'), false);
INSERT INTO "Product" (id, sku, barcode, name, "retailPrice", "avgCostLak", "stockQty", "lowStockAlert", "categoryId", "brandId", "updatedAt")
SELECT gen_random_uuid()::text, 'BENCH-' || g, '99' || lpad(g::text, 11, '0'),
       (ARRAY['Thermal printer','POS terminal','Barcode scanner','Monitor','Cash drawer','Label paper'])[1 + g % 6] || ' model ' || g,
       100000 + (g % 500) * 1000, 60000, 1000, 5,
       (SELECT id FROM "Category" WHERE "tenantId" = current_setting('app.tenant_id') ORDER BY slug LIMIT 1 OFFSET (g % 10)),
       (SELECT id FROM "Brand" WHERE "tenantId" = current_setting('app.tenant_id') ORDER BY name LIMIT 1 OFFSET (g % 14)),
       now()
FROM generate_series(1, 10000) g;

INSERT INTO "Customer" (id, code, name, phone)
SELECT gen_random_uuid()::text, 'B' || lpad(g::text, 6, '0'), 'Bench customer ' || g, '020' || lpad(g::text, 8, '0')
FROM generate_series(1, 5000) g;

CREATE TEMP TABLE p AS SELECT id, row_number() OVER () AS n, "retailPrice" FROM "Product" WHERE sku LIKE 'BENCH-%';
INSERT INTO "BranchStock" ("tenantId", "branchId", "productId", qty, "updatedAt")
SELECT current_setting('app.tenant_id'), (SELECT id FROM "Branch" WHERE code = 'MAIN' AND "tenantId" = current_setting('app.tenant_id')), id, 1000, now() FROM p;
CREATE TEMP TABLE c AS SELECT id, row_number() OVER () AS n FROM "Customer" WHERE code LIKE 'B%';

INSERT INTO "Sale" (id, "receiptNo", "cashierId", "branchId", "registerId", "customerId", "subtotalLak", "totalLak", "paidLak", "vatPercent", "vatLak", "createdAt", "paymentStatus")
SELECT 'bench-sale-' || g, 'BENCH-' || g,
       (SELECT id FROM "User" WHERE username = 'admin' AND "tenantId" = current_setting('app.tenant_id')),
       (SELECT "branchId" FROM "Register" WHERE code = 'R1' AND "tenantId" = current_setting('app.tenant_id')),
       (SELECT id FROM "Register" WHERE code = 'R1' AND "tenantId" = current_setting('app.tenant_id')),
       CASE WHEN g % 3 = 0 THEN (SELECT id FROM c WHERE n = 1 + g % 5000) END,
       400000, 400000, CASE WHEN g % 50 = 0 THEN 0 ELSE 400000 END, 12, 42857,
       now() - (g % 365) * interval '1 day' - (g % 600) * interval '1 minute',
       (CASE WHEN g % 50 = 0 THEN 'UNPAID' ELSE 'PAID' END)::"PaymentStatus"
FROM generate_series(1, 50000) g;

INSERT INTO "SaleItem" (id, "saleId", "productId", "productName", quantity, "listPriceLak", "unitPriceLak", "lineTotalLak", "unitCostLak")
SELECT gen_random_uuid()::text, 'bench-sale-' || g, p.id, 'Bench item', 2, 100000, 100000, 200000, 60000
FROM generate_series(1, 50000) g CROSS JOIN LATERAL (VALUES (0), (1)) k(i)
JOIN p ON p.n = 1 + (g * 7 + k.i * 13) % 10000;

INSERT INTO "Payment" (id, "saleId", "paymentTypeId", currency, amount, "lakPerUnit", "amountLak")
SELECT gen_random_uuid()::text, 'bench-sale-' || g, (SELECT id FROM "PaymentType" WHERE kind = 'CASH' AND "tenantId" = current_setting('app.tenant_id') LIMIT 1), 'LAK', 400000, 1, 400000
FROM generate_series(1, 50000) g;
ANALYZE;
