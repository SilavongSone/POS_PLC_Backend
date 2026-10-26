-- AlterTable
ALTER TABLE "SaleReturn" ADD COLUMN     "shiftId" TEXT;

-- AddForeignKey
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Customer codes (C00001 …) continue after the codes the redesign migration back-filled.
INSERT INTO "DocSequence" ("key", "value")
SELECT 'C', count(*)::int FROM "Customer"
ON CONFLICT ("key") DO NOTHING;
