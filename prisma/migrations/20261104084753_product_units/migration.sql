-- AlterTable
ALTER TABLE "QuotationItem" ADD COLUMN     "productUnitId" TEXT,
ADD COLUMN     "unitFactor" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "unitName" TEXT;

-- AlterTable
ALTER TABLE "SaleItem" ADD COLUMN     "productUnitId" TEXT,
ADD COLUMN     "unitFactor" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "unitName" TEXT;

-- AlterTable
ALTER TABLE "StockDocumentItem" ADD COLUMN     "productUnitId" TEXT,
ADD COLUMN     "unitFactor" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "unitName" TEXT;

-- CreateTable
CREATE TABLE "ProductUnit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text, true),
    "productId" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "factor" INTEGER NOT NULL,
    "barcode" TEXT,
    "retailPrice" DECIMAL(18,2) NOT NULL,
    "wholesalePrice" DECIMAL(18,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductUnit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductUnit_tenantId_idx" ON "ProductUnit"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductUnit_tenantId_barcode_key" ON "ProductUnit"("tenantId", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "ProductUnit_productId_unit_key" ON "ProductUnit"("productId", "unit");

-- AddForeignKey
ALTER TABLE "ProductUnit" ADD CONSTRAINT "ProductUnit_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductUnit" ADD CONSTRAINT "ProductUnit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A pack holds at least 2 base units (1 would be the base unit itself).
ALTER TABLE "ProductUnit" ADD CONSTRAINT "ProductUnit_factor_check" CHECK ("factor" >= 2);
