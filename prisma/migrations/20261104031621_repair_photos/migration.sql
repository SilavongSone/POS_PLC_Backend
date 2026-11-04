-- AlterTable
ALTER TABLE "ServiceTicket" ADD COLUMN     "photoUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];
