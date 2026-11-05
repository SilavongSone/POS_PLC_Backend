-- Paper and labels are bought by the carton, sold by the ream/pack and counted by the sheet:
-- add "sheet" and "ream" (and "carton" for companies created before it existed) at the end
-- of every company's unit list. Existing units and their order are left alone.
INSERT INTO "Unit" ("id", "tenantId", "name", "nameI18n", "sortOrder")
SELECT gen_random_uuid()::text, t."id", d.name, d.i18n::jsonb,
       COALESCE((SELECT MAX(u."sortOrder") FROM "Unit" u WHERE u."tenantId" = t."id"), 0) + d.ord
FROM "Tenant" t
CROSS JOIN (VALUES
  ('carton', '{"lo":"ແກັດ","th":"ลัง","en":"carton"}', 1),
  ('sheet',  '{"lo":"ແຜ່ນ","th":"แผ่น","en":"sheet"}', 2),
  ('ream',   '{"lo":"ລີມ","th":"รีม","en":"ream"}', 3)
) AS d(name, i18n, ord)
ON CONFLICT DO NOTHING;
