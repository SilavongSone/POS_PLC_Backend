-- CreateTable
CREATE TABLE "BrandCategory" (
    "brandId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "BrandCategory_pkey" PRIMARY KEY ("brandId","categoryId")
);

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text, true),
    "name" TEXT NOT NULL,
    "nameI18n" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BrandCategory_categoryId_idx" ON "BrandCategory"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Unit_tenantId_name_key" ON "Unit"("tenantId", "name");

-- AddForeignKey
ALTER TABLE "BrandCategory" ADD CONSTRAINT "BrandCategory_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandCategory" ADD CONSTRAINT "BrandCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Back-fill: every brand belongs to the categories its products are already in.
INSERT INTO "BrandCategory" ("brandId", "categoryId")
SELECT DISTINCT p."brandId", p."categoryId"
FROM "Product" p
WHERE p."brandId" IS NOT NULL AND p."categoryId" IS NOT NULL
ON CONFLICT DO NOTHING;

-- Back-fill: standard units for every company (names are stored on products) …
INSERT INTO "Unit" ("id", "tenantId", "name", "nameI18n", "sortOrder")
SELECT gen_random_uuid()::text, t."id", d.name, d.i18n::jsonb, d.ord
FROM "Tenant" t
CROSS JOIN (VALUES
  ('pcs',  '{"lo":"ອັນ","th":"ชิ้น","en":"pcs"}', 1),
  ('unit', '{"lo":"ເຄື່ອງ","th":"เครื่อง","en":"unit"}', 2),
  ('set',  '{"lo":"ຊຸດ","th":"ชุด","en":"set"}', 3),
  ('box',  '{"lo":"ກ່ອງ","th":"กล่อง","en":"box"}', 4),
  ('pack', '{"lo":"ແພັກ","th":"แพ็ก","en":"pack"}', 5),
  ('roll', '{"lo":"ມ້ວນ","th":"ม้วน","en":"roll"}', 6),
  ('m',    '{"lo":"ແມັດ","th":"เมตร","en":"m"}', 7),
  ('hour', '{"lo":"ຊົ່ວໂມງ","th":"ชั่วโมง","en":"hour"}', 8)
) AS d(name, i18n, ord)
ON CONFLICT DO NOTHING;

-- … plus any other unit products already use, so every product's unit is in the list.
INSERT INTO "Unit" ("id", "tenantId", "name", "sortOrder")
SELECT gen_random_uuid()::text, p."tenantId", p."unit", 100
FROM (SELECT DISTINCT "tenantId", "unit" FROM "Product" WHERE "unit" <> '') p
ON CONFLICT DO NOTHING;
