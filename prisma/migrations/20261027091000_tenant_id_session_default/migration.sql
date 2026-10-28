-- tenantId falls back to the session setting app.tenant_id, which is normally unset (NULL):
-- a write that the application forgot to scope then fails the NOT NULL check instead of
-- landing in the wrong tenant. The Prisma tenant extension always sets tenantId explicitly.
-- AlterTable
ALTER TABLE "Branch" ALTER COLUMN "tenantId" SET DEFAULT current_setting('app.tenant_id'::text, true);

-- AlterTable
ALTER TABLE "BranchStock" ALTER COLUMN "tenantId" SET DEFAULT current_setting('app.tenant_id'::text, true);

-- AlterTable
ALTER TABLE "Brand" ALTER COLUMN "tenantId" SET DEFAULT current_setting('app.tenant_id'::text, true);

-- AlterTable
ALTER TABLE "CashMovement" ALTER COLUMN "tenantId" SET DEFAULT current_setting('app.tenant_id'::text, true);

-- AlterTable
ALTER TABLE "Category" ALTER COLUMN "tenantId" SET DEFAULT current_setting('app.tenant_id'::text, true);

-- AlterTable
ALTER TABLE "Customer" ALTER COLUMN "tenantId" SET DEFAULT current_setting('app.tenant_id'::text, true);

-- AlterTable
ALTER TABLE "DebtPayment" ALTER COLUMN "tenantId" SET DEFAULT current_setting('app.tenant_id'::text, true);

-- AlterTable
ALTER TABLE "DocSequence" ALTER COLUMN "tenantId" SET DEFAULT current_setting('app.tenant_id'::text, true);

-- AlterTable
ALTER TABLE "ExchangeRate" ALTER COLUMN "tenantId" SET DEFAULT current_setting('app.tenant_id'::text, true);

-- AlterTable
ALTER TABLE "Expense" ALTER COLUMN "tenantId" SET DEFAULT current_setting('app.tenant_id'::text, true);

-- AlterTable
ALTER TABLE "ExpenseCategory" ALTER COLUMN "tenantId" SET DEFAULT current_setting('app.tenant_id'::text, true);

-- AlterTable
ALTER TABLE "HeldBill" ALTER COLUMN "tenantId" SET DEFAULT current_setting('app.tenant_id'::text, true);

-- AlterTable
ALTER TABLE "IdempotencyKey" ALTER COLUMN "tenantId" SET DEFAULT current_setting('app.tenant_id'::text, true);

-- AlterTable
ALTER TABLE "PaymentType" ALTER COLUMN "tenantId" SET DEFAULT current_setting('app.tenant_id'::text, true);

-- AlterTable
ALTER TABLE "Product" ALTER COLUMN "tenantId" SET DEFAULT current_setting('app.tenant_id'::text, true);

-- AlterTable
ALTER TABLE "Promotion" ALTER COLUMN "tenantId" SET DEFAULT current_setting('app.tenant_id'::text, true);

-- AlterTable
ALTER TABLE "Quotation" ALTER COLUMN "tenantId" SET DEFAULT current_setting('app.tenant_id'::text, true);

-- AlterTable
ALTER TABLE "Register" ALTER COLUMN "tenantId" SET DEFAULT current_setting('app.tenant_id'::text, true);

-- AlterTable
ALTER TABLE "Sale" ALTER COLUMN "tenantId" SET DEFAULT current_setting('app.tenant_id'::text, true);

-- AlterTable
ALTER TABLE "SaleItem" ALTER COLUMN "tenantId" SET DEFAULT current_setting('app.tenant_id'::text, true);

-- AlterTable
ALTER TABLE "SaleReturn" ALTER COLUMN "tenantId" SET DEFAULT current_setting('app.tenant_id'::text, true);

-- AlterTable
ALTER TABLE "SerialNumber" ALTER COLUMN "tenantId" SET DEFAULT current_setting('app.tenant_id'::text, true);

-- AlterTable
ALTER TABLE "ServiceTicket" ALTER COLUMN "tenantId" SET DEFAULT current_setting('app.tenant_id'::text, true);

-- AlterTable
ALTER TABLE "Setting" ALTER COLUMN "tenantId" SET DEFAULT current_setting('app.tenant_id'::text, true);

-- AlterTable
ALTER TABLE "Shift" ALTER COLUMN "tenantId" SET DEFAULT current_setting('app.tenant_id'::text, true);

-- AlterTable
ALTER TABLE "StockDocument" ALTER COLUMN "tenantId" SET DEFAULT current_setting('app.tenant_id'::text, true);

-- AlterTable
ALTER TABLE "StockLot" ALTER COLUMN "tenantId" SET DEFAULT current_setting('app.tenant_id'::text, true);

-- AlterTable
ALTER TABLE "StockMovement" ALTER COLUMN "tenantId" SET DEFAULT current_setting('app.tenant_id'::text, true);

-- AlterTable
ALTER TABLE "Supplier" ALTER COLUMN "tenantId" SET DEFAULT current_setting('app.tenant_id'::text, true);

-- AlterTable
ALTER TABLE "TaxInvoice" ALTER COLUMN "tenantId" SET DEFAULT current_setting('app.tenant_id'::text, true);

-- AlterTable
ALTER TABLE "TaxRate" ALTER COLUMN "tenantId" SET DEFAULT current_setting('app.tenant_id'::text, true);

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "tenantId" SET DEFAULT current_setting('app.tenant_id'::text, true);

-- AlterTable
ALTER TABLE "UserGroup" ALTER COLUMN "tenantId" SET DEFAULT current_setting('app.tenant_id'::text, true);

