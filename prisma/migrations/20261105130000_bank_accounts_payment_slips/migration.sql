-- Plan invoices: the company sends a screenshot of its transfer; a platform admin checks it.
ALTER TABLE "BillingInvoice" ADD COLUMN "slipUrl" TEXT,
ADD COLUMN "slipAt" TIMESTAMP(3),
ADD COLUMN "rejectReason" TEXT,
ADD COLUMN "rejectedAt" TIMESTAMP(3);

-- Bank accounts (with QR code) companies pay into; platform-wide, no tenantId.
CREATE TABLE "PlatformBankAccount" (
    "id" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "qrImageUrl" TEXT,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformBankAccount_pkey" PRIMARY KEY ("id")
);
