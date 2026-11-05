-- Cost of one pack as entered on a receive line, so the total matches the supplier invoice exactly.
ALTER TABLE "StockDocumentItem" ADD COLUMN "packCost" DECIMAL(18,2);

-- Back-fill: lines already entered in a pack get pack cost = base cost × pack size; base-unit lines keep unitFactor 1 and no pack cost.
UPDATE "StockDocumentItem" SET "packCost" = "unitCost" * "unitFactor" WHERE "unitFactor" > 1;
