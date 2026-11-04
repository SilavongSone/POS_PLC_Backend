-- "Carton" (ແກັດ) joins the standard units: shops sell paper and consumables by the carton.
INSERT INTO "Unit" ("id", "tenantId", "name", "nameI18n", "sortOrder")
SELECT gen_random_uuid()::text, t."id", 'carton', '{"lo":"ແກັດ","th":"ลัง","en":"carton"}'::jsonb, 5
FROM "Tenant" t
ON CONFLICT DO NOTHING;
