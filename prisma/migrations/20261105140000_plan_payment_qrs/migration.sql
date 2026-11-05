-- QR codes with the amount in them, one per plan, period and bank account (platform-wide).
CREATE TABLE "PlatformPlanQr" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "months" INTEGER NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "amountLak" DECIMAL(18,0) NOT NULL,
    "qrImageUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformPlanQr_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlatformPlanQr_planId_months_bankAccountId_key" ON "PlatformPlanQr"("planId", "months", "bankAccountId");
CREATE INDEX "PlatformPlanQr_bankAccountId_idx" ON "PlatformPlanQr"("bankAccountId");

ALTER TABLE "PlatformPlanQr" ADD CONSTRAINT "PlatformPlanQr_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlatformPlanQr" ADD CONSTRAINT "PlatformPlanQr_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "PlatformBankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
