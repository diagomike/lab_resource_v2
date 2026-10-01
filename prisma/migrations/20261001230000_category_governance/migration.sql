-- Categories that can't be broken, and who looks after them (2026-10-01).
-- A Date detail type and a format hint per detail; each category records the
-- department that looks after it (null: university-wide, Property Administration),
-- who made it and what it is for; an edit that changes data waits for approval as a
-- CategoryChange (head, then admin and Property Administration when it reaches other
-- departments' items).

-- A new enum value is added outside the transaction (it can't be used in the one that adds it).
ALTER TYPE "CategoryFieldType" ADD VALUE IF NOT EXISTS 'DATE';

BEGIN;

-- CreateEnum
CREATE TYPE "CategoryChangeStage" AS ENUM ('HEAD', 'ADMIN', 'PROPERTY_ADMIN');

-- CreateEnum
CREATE TYPE "CategoryChangeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'STALE');

-- AlterTable
ALTER TABLE "CategoryField" ADD COLUMN     "hint" TEXT;

-- AlterTable
ALTER TABLE "ResourceCategory" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "stewardNodeId" TEXT;

-- CreateTable
CREATE TABLE "CategoryChange" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "proposedById" TEXT NOT NULL,
    "unitId" TEXT,
    "payload" JSONB NOT NULL,
    "baseVersion" INTEGER NOT NULL,
    "summary" TEXT[],
    "reaches" TEXT[],
    "stages" "CategoryChangeStage"[],
    "stage" "CategoryChangeStage" NOT NULL,
    "status" "CategoryChangeStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "trail" JSONB NOT NULL DEFAULT '[]',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoryChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CategoryChange_status_stage_idx" ON "CategoryChange"("status", "stage");

-- CreateIndex
CREATE INDEX "CategoryChange_categoryId_status_idx" ON "CategoryChange"("categoryId", "status");

-- CreateIndex
CREATE INDEX "CategoryChange_proposedById_status_idx" ON "CategoryChange"("proposedById", "status");

-- CreateIndex
CREATE INDEX "ResourceCategory_stewardNodeId_idx" ON "ResourceCategory"("stewardNodeId");

-- AddForeignKey
ALTER TABLE "ResourceCategory" ADD CONSTRAINT "ResourceCategory_stewardNodeId_fkey" FOREIGN KEY ("stewardNodeId") REFERENCES "OrgNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceCategory" ADD CONSTRAINT "ResourceCategory_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryChange" ADD CONSTRAINT "CategoryChange_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ResourceCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryChange" ADD CONSTRAINT "CategoryChange_proposedById_fkey" FOREIGN KEY ("proposedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryChange" ADD CONSTRAINT "CategoryChange_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryChange" ADD CONSTRAINT "CategoryChange_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "OrgNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Who made each existing category, from its "created" history line.
UPDATE "ResourceCategory" c SET "createdById" = h."actorId"
FROM (
  SELECT DISTINCT ON ("categoryId") "categoryId", "actorId"
  FROM "ItemChange" WHERE "targetKind" = 'CATEGORY' AND field = 'created' AND "categoryId" IS NOT NULL
  ORDER BY "categoryId", "at" ASC
) h
WHERE h."categoryId" = c.id AND EXISTS (SELECT 1 FROM "User" u WHERE u.id = h."actorId");

COMMIT;
