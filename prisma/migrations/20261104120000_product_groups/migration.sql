-- Versions of one model (USB+WiFi / USB+LAN): a group above ordinary products.
CREATE TABLE "ProductGroup" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text, true),
    "name" TEXT NOT NULL,
    "nameI18n" JSONB,
    "optionName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductGroup_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductGroup_tenantId_idx" ON "ProductGroup"("tenantId");

ALTER TABLE "ProductGroup" ADD CONSTRAINT "ProductGroup_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Product" ADD COLUMN "groupId" TEXT,
ADD COLUMN "variantValue" TEXT,
ADD COLUMN "variantOrder" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "Product_groupId_variantValue_key" ON "Product"("groupId", "variantValue");

CREATE INDEX "Product_groupId_idx" ON "Product"("groupId");

ALTER TABLE "Product" ADD CONSTRAINT "Product_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ProductGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
