-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "StockDocType" ADD VALUE 'TRANSFER';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockMoveType" ADD VALUE 'TRANSFER_OUT';
ALTER TYPE "StockMoveType" ADD VALUE 'TRANSFER_IN';

-- DropIndex
DROP INDEX "Brand_name_key";

-- DropIndex
DROP INDEX "Category_parentId_name_key";

-- DropIndex
DROP INDEX "Category_slug_key";

-- DropIndex
DROP INDEX "Customer_code_key";

-- DropIndex
DROP INDEX "Customer_phone_key";

-- DropIndex
DROP INDEX "DebtPayment_receiptNo_key";

-- DropIndex
DROP INDEX "ExpenseCategory_name_key";

-- DropIndex
DROP INDEX "PaymentType_name_key";

-- DropIndex
DROP INDEX "Product_barcode_key";

-- DropIndex
DROP INDEX "Product_sku_key";

-- DropIndex
DROP INDEX "Quotation_quoteNo_key";

-- DropIndex
DROP INDEX "Register_code_key";

-- DropIndex
DROP INDEX "Sale_createdAt_idx";

-- DropIndex
DROP INDEX "Sale_receiptNo_key";

-- DropIndex
DROP INDEX "Sale_status_createdAt_idx";

-- DropIndex
DROP INDEX "SaleReturn_returnNo_key";

-- DropIndex
DROP INDEX "SerialNumber_serial_key";

-- DropIndex
DROP INDEX "ServiceTicket_ticketNo_key";

-- DropIndex
DROP INDEX "StockDocument_docNo_key";

-- DropIndex
DROP INDEX "TaxInvoice_invoiceNo_key";

-- DropIndex
DROP INDEX "TaxRate_name_key";

-- DropIndex
DROP INDEX "User_username_key";

-- DropIndex
DROP INDEX "UserGroup_name_key";

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "taxId" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "defaultLanguage" TEXT NOT NULL DEFAULT 'lo',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "receiptHeader" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchStock" (
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BranchStock_pkey" PRIMARY KEY ("branchId","productId")
);

-- CreateTable
CREATE TABLE "UserBranch" (
    "userId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,

    CONSTRAINT "UserBranch_pkey" PRIMARY KEY ("userId","branchId")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameI18n" JSONB,
    "descriptionI18n" JSONB,
    "priceMonthlyLak" DECIMAL(18,0) NOT NULL DEFAULT 0,
    "priceYearlyLak" DECIMAL(18,0) NOT NULL DEFAULT 0,
    "limits" JSONB NOT NULL,
    "features" TEXT[],
    "trialDays" INTEGER NOT NULL DEFAULT 14,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "overrides" JSONB,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformAdmin" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "statusCode" INTEGER,
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("tenantId","key")
);

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Brand" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "CashMovement" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "nameI18n" JSONB,
ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "DebtPayment" ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "DocSequence" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "ExchangeRate" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "ExpenseCategory" ADD COLUMN     "nameI18n" JSONB,
ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "HeldBill" ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "PaymentType" ADD COLUMN     "nameI18n" JSONB,
ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "descriptionI18n" JSONB,
ADD COLUMN     "nameI18n" JSONB,
ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Promotion" ADD COLUMN     "nameI18n" JSONB,
ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Quotation" ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Register" ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "SaleItem" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "SaleReturn" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "SerialNumber" ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "ServiceTicket" ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Setting" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Shift" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "StockDocument" ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "tenantId" TEXT,
ADD COLUMN     "toBranchId" TEXT;

-- AlterTable
ALTER TABLE "StockLot" ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "TaxInvoice" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "TaxRate" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "language" TEXT,
ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "UserGroup" ADD COLUMN     "tenantId" TEXT;

-- ---------------------------------------------------------------------------
-- Back-fill: existing single-shop data becomes tenant "plc", branch "MAIN".
-- ---------------------------------------------------------------------------
INSERT INTO "Plan" ("id","code","name","nameI18n","priceMonthlyLak","priceYearlyLak","limits","features","trialDays","isPublic","isActive","sortOrder","updatedAt") VALUES
 ('plan_free','FREE','Free','{"lo":"ຟຣີ","th":"ฟรี","en":"Free"}',0,0,
  '{"maxBranches":1,"maxRegisters":1,"maxUsers":2,"maxProducts":200,"maxSalesPerMonth":300}',ARRAY[]::TEXT[],0,true,true,1,CURRENT_TIMESTAMP),
 ('plan_starter','STARTER','Starter','{"lo":"ເລີ່ມຕົ້ນ","th":"เริ่มต้น","en":"Starter"}',199000,1990000,
  '{"maxBranches":1,"maxRegisters":2,"maxUsers":5,"maxProducts":2000,"maxSalesPerMonth":null}',
  ARRAY['multiCurrency','creditSales','expenses','taxInvoices'],14,true,true,2,CURRENT_TIMESTAMP),
 ('plan_business','BUSINESS','Business','{"lo":"ທຸລະກິດ","th":"ธุรกิจ","en":"Business"}',499000,4990000,
  '{"maxBranches":3,"maxRegisters":6,"maxUsers":20,"maxProducts":20000,"maxSalesPerMonth":null}',
  ARRAY['multiCurrency','creditSales','expenses','taxInvoices','promotions','bundles','quotations','repairs','lots','stockTransfers','advancedReports'],14,true,true,3,CURRENT_TIMESTAMP),
 ('plan_enterprise','ENTERPRISE','Enterprise','{"lo":"ອົງກອນ","th":"องค์กร","en":"Enterprise"}',1490000,14900000,
  '{"maxBranches":null,"maxRegisters":null,"maxUsers":null,"maxProducts":null,"maxSalesPerMonth":null}',
  ARRAY['multiCurrency','creditSales','expenses','taxInvoices','promotions','bundles','quotations','repairs','lots','stockTransfers','advancedReports','auditLog'],14,true,true,4,CURRENT_TIMESTAMP);

INSERT INTO "Tenant" ("id","code","name","updatedAt")
SELECT 'tenant_plc','plc',COALESCE((SELECT "value" #>> '{}' FROM "Setting" WHERE "key" = 'store.name'),'PLC POS'),CURRENT_TIMESTAMP;

INSERT INTO "Subscription" ("id","tenantId","planId","status","note","updatedAt")
VALUES ('sub_plc','tenant_plc','plan_enterprise','ACTIVE','Migrated from single-shop install',CURRENT_TIMESTAMP);

INSERT INTO "Branch" ("id","tenantId","code","name","updatedAt")
VALUES ('branch_plc_main','tenant_plc','MAIN','Main',CURRENT_TIMESTAMP);

UPDATE "AuditLog" SET "tenantId" = 'tenant_plc';
UPDATE "Brand" SET "tenantId" = 'tenant_plc';
UPDATE "CashMovement" SET "tenantId" = 'tenant_plc';
UPDATE "Category" SET "tenantId" = 'tenant_plc';
UPDATE "Customer" SET "tenantId" = 'tenant_plc';
UPDATE "DebtPayment" SET "tenantId" = 'tenant_plc';
UPDATE "DocSequence" SET "tenantId" = 'tenant_plc';
UPDATE "ExchangeRate" SET "tenantId" = 'tenant_plc';
UPDATE "Expense" SET "tenantId" = 'tenant_plc';
UPDATE "ExpenseCategory" SET "tenantId" = 'tenant_plc';
UPDATE "HeldBill" SET "tenantId" = 'tenant_plc';
UPDATE "PaymentType" SET "tenantId" = 'tenant_plc';
UPDATE "Product" SET "tenantId" = 'tenant_plc';
UPDATE "Promotion" SET "tenantId" = 'tenant_plc';
UPDATE "Quotation" SET "tenantId" = 'tenant_plc';
UPDATE "Register" SET "tenantId" = 'tenant_plc';
UPDATE "Sale" SET "tenantId" = 'tenant_plc';
UPDATE "SaleItem" SET "tenantId" = 'tenant_plc';
UPDATE "SaleReturn" SET "tenantId" = 'tenant_plc';
UPDATE "SerialNumber" SET "tenantId" = 'tenant_plc';
UPDATE "ServiceTicket" SET "tenantId" = 'tenant_plc';
UPDATE "Setting" SET "tenantId" = 'tenant_plc';
UPDATE "Shift" SET "tenantId" = 'tenant_plc';
UPDATE "StockDocument" SET "tenantId" = 'tenant_plc';
UPDATE "StockLot" SET "tenantId" = 'tenant_plc';
UPDATE "StockMovement" SET "tenantId" = 'tenant_plc';
UPDATE "Supplier" SET "tenantId" = 'tenant_plc';
UPDATE "TaxInvoice" SET "tenantId" = 'tenant_plc';
UPDATE "TaxRate" SET "tenantId" = 'tenant_plc';
UPDATE "User" SET "tenantId" = 'tenant_plc';
UPDATE "UserGroup" SET "tenantId" = 'tenant_plc';
UPDATE "Register" SET "branchId" = 'branch_plc_main';
UPDATE "Sale" SET "branchId" = 'branch_plc_main';
UPDATE "SerialNumber" SET "branchId" = 'branch_plc_main';
UPDATE "ServiceTicket" SET "branchId" = 'branch_plc_main';
UPDATE "StockDocument" SET "branchId" = 'branch_plc_main';
UPDATE "StockLot" SET "branchId" = 'branch_plc_main';
UPDATE "StockMovement" SET "branchId" = 'branch_plc_main';

UPDATE "DebtPayment" SET "branchId" = 'branch_plc_main';
UPDATE "Expense" SET "branchId" = 'branch_plc_main';
UPDATE "HeldBill" SET "branchId" = 'branch_plc_main';
UPDATE "Quotation" SET "branchId" = 'branch_plc_main';

INSERT INTO "BranchStock" ("tenantId","branchId","productId","qty","updatedAt")
SELECT 'tenant_plc','branch_plc_main',"id","stockQty",CURRENT_TIMESTAMP FROM "Product" WHERE "stockQty" <> 0;

ALTER TABLE "Brand" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "CashMovement" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Category" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Customer" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "DebtPayment" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "DocSequence" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "ExchangeRate" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Expense" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "ExpenseCategory" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "HeldBill" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "PaymentType" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Product" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Promotion" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Quotation" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Register" ALTER COLUMN "branchId" SET NOT NULL;
ALTER TABLE "Register" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Sale" ALTER COLUMN "branchId" SET NOT NULL;
ALTER TABLE "Sale" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "SaleItem" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "SaleReturn" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "SerialNumber" ALTER COLUMN "branchId" SET NOT NULL;
ALTER TABLE "SerialNumber" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "ServiceTicket" ALTER COLUMN "branchId" SET NOT NULL;
ALTER TABLE "ServiceTicket" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Setting" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Shift" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "StockDocument" ALTER COLUMN "branchId" SET NOT NULL;
ALTER TABLE "StockDocument" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "StockLot" ALTER COLUMN "branchId" SET NOT NULL;
ALTER TABLE "StockLot" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "StockMovement" ALTER COLUMN "branchId" SET NOT NULL;
ALTER TABLE "StockMovement" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Supplier" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "TaxInvoice" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "TaxRate" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "User" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "UserGroup" ALTER COLUMN "tenantId" SET NOT NULL;

ALTER TABLE "Setting" DROP CONSTRAINT "Setting_pkey", ADD CONSTRAINT "Setting_pkey" PRIMARY KEY ("tenantId", "key");
ALTER TABLE "DocSequence" DROP CONSTRAINT "DocSequence_pkey", ADD CONSTRAINT "DocSequence_pkey" PRIMARY KEY ("tenantId", "key");

-- One default VAT rate per tenant (partial unique index, not expressible in Prisma).
DROP INDEX "TaxRate_one_default";
CREATE UNIQUE INDEX "TaxRate_one_default" ON "TaxRate" ("tenantId") WHERE "isDefault";


-- CreateIndex
CREATE UNIQUE INDEX "Tenant_code_key" ON "Tenant"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_tenantId_code_key" ON "Branch"("tenantId", "code");

-- CreateIndex
CREATE INDEX "BranchStock_tenantId_idx" ON "BranchStock"("tenantId");

-- CreateIndex
CREATE INDEX "BranchStock_productId_idx" ON "BranchStock"("productId");

-- CreateIndex
CREATE INDEX "UserBranch_branchId_idx" ON "UserBranch"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_code_key" ON "Plan"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_tenantId_key" ON "Subscription"("tenantId");

-- CreateIndex
CREATE INDEX "Subscription_planId_idx" ON "Subscription"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformAdmin_email_key" ON "PlatformAdmin"("email");

-- CreateIndex
CREATE INDEX "IdempotencyKey_createdAt_idx" ON "IdempotencyKey"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_idx" ON "AuditLog"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_tenantId_name_key" ON "Brand"("tenantId", "name");

-- CreateIndex
CREATE INDEX "CashMovement_tenantId_idx" ON "CashMovement"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Category_tenantId_parentId_name_key" ON "Category"("tenantId", "parentId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Category_tenantId_slug_key" ON "Category"("tenantId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_tenantId_code_key" ON "Customer"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_tenantId_phone_key" ON "Customer"("tenantId", "phone");

-- CreateIndex
CREATE INDEX "DebtPayment_branchId_idx" ON "DebtPayment"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "DebtPayment_tenantId_receiptNo_key" ON "DebtPayment"("tenantId", "receiptNo");

-- CreateIndex
CREATE INDEX "ExchangeRate_tenantId_idx" ON "ExchangeRate"("tenantId");

-- CreateIndex
CREATE INDEX "Expense_tenantId_idx" ON "Expense"("tenantId");

-- CreateIndex
CREATE INDEX "Expense_branchId_idx" ON "Expense"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_tenantId_name_key" ON "ExpenseCategory"("tenantId", "name");

-- CreateIndex
CREATE INDEX "HeldBill_tenantId_idx" ON "HeldBill"("tenantId");

-- CreateIndex
CREATE INDEX "HeldBill_branchId_idx" ON "HeldBill"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentType_tenantId_name_key" ON "PaymentType"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Product_tenantId_sku_key" ON "Product"("tenantId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "Product_tenantId_barcode_key" ON "Product"("tenantId", "barcode");

-- CreateIndex
CREATE INDEX "Promotion_tenantId_idx" ON "Promotion"("tenantId");

-- CreateIndex
CREATE INDEX "Quotation_branchId_idx" ON "Quotation"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "Quotation_tenantId_quoteNo_key" ON "Quotation"("tenantId", "quoteNo");

-- CreateIndex
CREATE INDEX "Register_branchId_idx" ON "Register"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "Register_tenantId_code_key" ON "Register"("tenantId", "code");

-- CreateIndex
CREATE INDEX "Sale_tenantId_createdAt_idx" ON "Sale"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "Sale_tenantId_status_createdAt_idx" ON "Sale"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Sale_branchId_idx" ON "Sale"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_tenantId_receiptNo_key" ON "Sale"("tenantId", "receiptNo");

-- CreateIndex
CREATE INDEX "SaleItem_tenantId_idx" ON "SaleItem"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "SaleReturn_tenantId_returnNo_key" ON "SaleReturn"("tenantId", "returnNo");

-- CreateIndex
CREATE INDEX "SerialNumber_branchId_idx" ON "SerialNumber"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "SerialNumber_tenantId_serial_key" ON "SerialNumber"("tenantId", "serial");

-- CreateIndex
CREATE INDEX "ServiceTicket_branchId_idx" ON "ServiceTicket"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceTicket_tenantId_ticketNo_key" ON "ServiceTicket"("tenantId", "ticketNo");

-- CreateIndex
CREATE INDEX "Shift_tenantId_idx" ON "Shift"("tenantId");

-- CreateIndex
CREATE INDEX "StockDocument_branchId_idx" ON "StockDocument"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "StockDocument_tenantId_docNo_key" ON "StockDocument"("tenantId", "docNo");

-- CreateIndex
CREATE INDEX "StockLot_tenantId_idx" ON "StockLot"("tenantId");

-- CreateIndex
CREATE INDEX "StockLot_branchId_idx" ON "StockLot"("branchId");

-- CreateIndex
CREATE INDEX "StockMovement_tenantId_idx" ON "StockMovement"("tenantId");

-- CreateIndex
CREATE INDEX "StockMovement_branchId_idx" ON "StockMovement"("branchId");

-- CreateIndex
CREATE INDEX "Supplier_tenantId_idx" ON "Supplier"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "TaxInvoice_tenantId_invoiceNo_key" ON "TaxInvoice"("tenantId", "invoiceNo");

-- CreateIndex
CREATE UNIQUE INDEX "TaxRate_tenantId_name_key" ON "TaxRate"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_username_key" ON "User"("tenantId", "username");

-- CreateIndex
CREATE UNIQUE INDEX "UserGroup_tenantId_name_key" ON "UserGroup"("tenantId", "name");

-- AddForeignKey
ALTER TABLE "UserGroup" ADD CONSTRAINT "UserGroup_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocSequence" ADD CONSTRAINT "DocSequence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentType" ADD CONSTRAINT "PaymentType_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxRate" ADD CONSTRAINT "TaxRate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SerialNumber" ADD CONSTRAINT "SerialNumber_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SerialNumber" ADD CONSTRAINT "SerialNumber_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDocument" ADD CONSTRAINT "StockDocument_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDocument" ADD CONSTRAINT "StockDocument_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDocument" ADD CONSTRAINT "StockDocument_toBranchId_fkey" FOREIGN KEY ("toBranchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeldBill" ADD CONSTRAINT "HeldBill_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeldBill" ADD CONSTRAINT "HeldBill_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxInvoice" ADD CONSTRAINT "TaxInvoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtPayment" ADD CONSTRAINT "DebtPayment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtPayment" ADD CONSTRAINT "DebtPayment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Register" ADD CONSTRAINT "Register_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Register" ADD CONSTRAINT "Register_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseCategory" ADD CONSTRAINT "ExpenseCategory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceTicket" ADD CONSTRAINT "ServiceTicket_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceTicket" ADD CONSTRAINT "ServiceTicket_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchStock" ADD CONSTRAINT "BranchStock_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchStock" ADD CONSTRAINT "BranchStock_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchStock" ADD CONSTRAINT "BranchStock_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBranch" ADD CONSTRAINT "UserBranch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBranch" ADD CONSTRAINT "UserBranch_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

