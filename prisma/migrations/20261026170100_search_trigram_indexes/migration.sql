-- Fast "contains" search (ILIKE '%…%') on product and customer names, SKUs and phones.
-- pg_trgm is a trusted extension (PostgreSQL 13+): the database owner can create it.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex
CREATE INDEX "Product_name_trgm_idx" ON "Product" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Product_sku_trgm_idx" ON "Product" USING GIN ("sku" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Customer_name_trgm_idx" ON "Customer" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Customer_phone_trgm_idx" ON "Customer" USING GIN ("phone" gin_trgm_ops);
