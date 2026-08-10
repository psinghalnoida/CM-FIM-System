-- AlterEnum
ALTER TYPE "LinkedEntityType" ADD VALUE 'SETTLEMENT';

-- AlterEnum
BEGIN;
CREATE TYPE "SettlementStatus_new" AS ENUM ('PENDING', 'ACCEPTED', 'DISPUTED', 'REVIEW_REQUESTED');
ALTER TABLE "public"."settlements" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "settlements" ALTER COLUMN "status" TYPE "SettlementStatus_new" USING ("status"::text::"SettlementStatus_new");
ALTER TYPE "SettlementStatus" RENAME TO "SettlementStatus_old";
ALTER TYPE "SettlementStatus_new" RENAME TO "SettlementStatus";
DROP TYPE "public"."SettlementStatus_old";
ALTER TABLE "settlements" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;

-- DropForeignKey
ALTER TABLE "settlements" DROP CONSTRAINT "settlements_approvedById_fkey";

-- AlterTable
ALTER TABLE "settlements" DROP COLUMN "approvedAt",
DROP COLUMN "approvedById",
ADD COLUMN     "respondedAt" TIMESTAMP(3),
ADD COLUMN     "respondedById" TEXT;

-- CreateTable
CREATE TABLE "repair_parts" (
    "id" TEXT NOT NULL,
    "repairJobId" TEXT NOT NULL,
    "partName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repair_parts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "repair_parts_repairJobId_idx" ON "repair_parts"("repairJobId");

-- AddForeignKey
ALTER TABLE "repair_parts" ADD CONSTRAINT "repair_parts_repairJobId_fkey" FOREIGN KEY ("repairJobId") REFERENCES "repair_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_respondedById_fkey" FOREIGN KEY ("respondedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

