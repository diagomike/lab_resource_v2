-- CreateEnum
CREATE TYPE "CategoryPlacement" AS ENUM ('ANYWHERE', 'ONLY_LISTED');

-- AlterTable
ALTER TABLE "ResourceCategory" ADD COLUMN     "canBeRoot" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "placement" "CategoryPlacement" NOT NULL DEFAULT 'ANYWHERE';

-- CreateTable
CREATE TABLE "CategoryPlacementRule" (
    "id" TEXT NOT NULL,
    "childCategoryId" TEXT NOT NULL,
    "parentCategoryId" TEXT NOT NULL,

    CONSTRAINT "CategoryPlacementRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CategoryPlacementRule_parentCategoryId_idx" ON "CategoryPlacementRule"("parentCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "CategoryPlacementRule_childCategoryId_parentCategoryId_key" ON "CategoryPlacementRule"("childCategoryId", "parentCategoryId");

-- AddForeignKey
ALTER TABLE "CategoryPlacementRule" ADD CONSTRAINT "CategoryPlacementRule_childCategoryId_fkey" FOREIGN KEY ("childCategoryId") REFERENCES "ResourceCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryPlacementRule" ADD CONSTRAINT "CategoryPlacementRule_parentCategoryId_fkey" FOREIGN KEY ("parentCategoryId") REFERENCES "ResourceCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
