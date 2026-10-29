-- Each branch may charge its own VAT rate; null keeps the company's default rate.
ALTER TABLE "Branch" ADD COLUMN "taxRateId" TEXT;

ALTER TABLE "Branch" ADD CONSTRAINT "Branch_taxRateId_fkey" FOREIGN KEY ("taxRateId") REFERENCES "TaxRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
