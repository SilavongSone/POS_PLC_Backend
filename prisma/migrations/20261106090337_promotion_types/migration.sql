-- CreateEnum
CREATE TYPE "PromotionType" AS ENUM ('DISCOUNT', 'BUY_X_GET_Y', 'GIFT');

-- AlterTable
ALTER TABLE "Promotion" ADD COLUMN     "getQty" INTEGER,
ADD COLUMN     "type" "PromotionType" NOT NULL DEFAULT 'DISCOUNT';

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "giftRules" JSONB;

-- AlterTable
ALTER TABLE "SaleItem" ADD COLUMN     "isGift" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SaleReturn" ADD COLUMN     "giftChargeLak" DECIMAL(18,0) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PromotionGift" (
    "promotionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,

    CONSTRAINT "PromotionGift_pkey" PRIMARY KEY ("promotionId","productId")
);

-- AddForeignKey
ALTER TABLE "PromotionGift" ADD CONSTRAINT "PromotionGift_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionGift" ADD CONSTRAINT "PromotionGift_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
