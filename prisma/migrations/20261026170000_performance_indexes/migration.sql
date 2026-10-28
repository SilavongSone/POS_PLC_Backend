-- CreateIndex
CREATE INDEX "CashMovement_shiftId_idx" ON "CashMovement"("shiftId");

-- CreateIndex
CREATE INDEX "DebtPayment_saleId_idx" ON "DebtPayment"("saleId");

-- CreateIndex
CREATE INDEX "DebtPayment_shiftId_idx" ON "DebtPayment"("shiftId");

-- CreateIndex
CREATE INDEX "Expense_shiftId_idx" ON "Expense"("shiftId");

-- CreateIndex
CREATE INDEX "Expense_categoryId_idx" ON "Expense"("categoryId");

-- CreateIndex
CREATE INDEX "HeldBill_cashierId_idx" ON "HeldBill"("cashierId");

-- CreateIndex
CREATE INDEX "Payment_saleId_idx" ON "Payment"("saleId");

-- CreateIndex
CREATE INDEX "ProductImage_productId_idx" ON "ProductImage"("productId");

-- CreateIndex
CREATE INDEX "PromotionItem_promotionId_idx" ON "PromotionItem"("promotionId");

-- CreateIndex
CREATE INDEX "Quotation_customerId_idx" ON "Quotation"("customerId");

-- CreateIndex
CREATE INDEX "QuotationItem_quotationId_idx" ON "QuotationItem"("quotationId");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "Sale_shiftId_idx" ON "Sale"("shiftId");

-- CreateIndex
CREATE INDEX "Sale_status_createdAt_idx" ON "Sale"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Sale_cashierId_createdAt_idx" ON "Sale"("cashierId", "createdAt");

-- CreateIndex
CREATE INDEX "SaleItem_saleId_idx" ON "SaleItem"("saleId");

-- CreateIndex
CREATE INDEX "SaleItem_productId_idx" ON "SaleItem"("productId");

-- CreateIndex
CREATE INDEX "SaleReturn_saleId_idx" ON "SaleReturn"("saleId");

-- CreateIndex
CREATE INDEX "SaleReturn_shiftId_idx" ON "SaleReturn"("shiftId");

-- CreateIndex
CREATE INDEX "SaleReturn_createdAt_idx" ON "SaleReturn"("createdAt");

-- CreateIndex
CREATE INDEX "SaleReturnItem_returnId_idx" ON "SaleReturnItem"("returnId");

-- CreateIndex
CREATE INDEX "SaleReturnItem_saleItemId_idx" ON "SaleReturnItem"("saleItemId");

-- CreateIndex
CREATE INDEX "SerialNumber_saleItemId_idx" ON "SerialNumber"("saleItemId");

-- CreateIndex
CREATE INDEX "SerialNumber_receivedItemId_idx" ON "SerialNumber"("receivedItemId");

-- CreateIndex
CREATE INDEX "ServiceTicket_customerId_idx" ON "ServiceTicket"("customerId");

-- CreateIndex
CREATE INDEX "ServiceTicketLine_ticketId_idx" ON "ServiceTicketLine"("ticketId");

-- CreateIndex
CREATE INDEX "ServiceTicketLog_ticketId_idx" ON "ServiceTicketLog"("ticketId");

-- CreateIndex
CREATE INDEX "Shift_registerId_status_idx" ON "Shift"("registerId", "status");

-- CreateIndex
CREATE INDEX "StockDocumentItem_documentId_idx" ON "StockDocumentItem"("documentId");

-- CreateIndex
CREATE INDEX "StockDocumentItem_productId_idx" ON "StockDocumentItem"("productId");

-- CreateIndex
CREATE INDEX "StockLot_productId_expiryDate_idx" ON "StockLot"("productId", "expiryDate");

-- CreateIndex
CREATE INDEX "TaxInvoice_issuedAt_idx" ON "TaxInvoice"("issuedAt");

