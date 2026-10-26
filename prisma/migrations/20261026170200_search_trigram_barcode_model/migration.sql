-- CreateIndex
CREATE INDEX "Product_barcode_trgm_idx" ON "Product" USING GIN ("barcode" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Product_model_trgm_idx" ON "Product" USING GIN ("model" gin_trgm_ops);

