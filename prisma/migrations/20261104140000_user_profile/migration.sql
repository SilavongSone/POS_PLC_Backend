-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "lastName" TEXT;

-- Existing names stay whole in firstName until the person splits them.
UPDATE "User" SET "firstName" = "fullName" WHERE "firstName" IS NULL;
