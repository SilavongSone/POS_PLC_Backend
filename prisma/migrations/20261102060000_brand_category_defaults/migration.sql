-- Standard brands of existing companies get their default categories, as new companies do.
-- Ships with the brand-category feature, so there are no admin edits to keep yet.
INSERT INTO "BrandCategory" ("brandId", "categoryId")
SELECT b."id", c."id"
FROM (VALUES
  ('Sunmi', 'pos-terminal'),
  ('Sunmi', 'printer-receipt'),
  ('Sunmi', 'display-customer'),
  ('Sunmi', 'scanner'),
  ('iMin', 'pos-terminal'),
  ('iMin', 'printer-receipt'),
  ('iMin', 'display-customer'),
  ('Epson', 'printer'),
  ('Xprinter', 'printer-receipt'),
  ('Xprinter', 'printer-label'),
  ('Zebra', 'printer-label'),
  ('Zebra', 'scanner'),
  ('Honeywell', 'scanner'),
  ('Honeywell', 'printer-label'),
  ('MSI', 'display'),
  ('MSI', 'computer'),
  ('Samsung', 'display'),
  ('LG', 'display'),
  ('Dell', 'computer'),
  ('Dell', 'display-monitor'),
  ('HP', 'computer'),
  ('HP', 'printer-office'),
  ('Canon', 'printer-office'),
  ('Brother', 'printer-label'),
  ('Brother', 'printer-office'),
  ('Generic', 'cash-drawer'),
  ('Generic', 'accessory'),
  ('Generic', 'consumable')
) AS d("brand", "slug")
JOIN "Brand" b ON b."name" = d."brand"
JOIN "Category" c ON c."tenantId" = b."tenantId" AND c."slug" = d."slug"
ON CONFLICT DO NOTHING;
