-- Lab states rework: drafts and ideals become whole-tree versions. Old per-change
-- drafts and category targets are not carried over (test data only; both databases are
-- reseeded with real data in the same round), and old commit requests pointed at them.
DELETE FROM "LabCommitRequest";

-- CreateEnum
CREATE TYPE "LabVersionKind" AS ENUM ('DRAFT', 'IDEAL', 'IDEAL_PROPOSAL');

-- CreateEnum
CREATE TYPE "LabVersionStatus" AS ENUM ('EDITING', 'SUBMITTED', 'APPROVED');

-- DropForeignKey
ALTER TABLE "ItemDraftChange" DROP CONSTRAINT "ItemDraftChange_labItemId_fkey";

-- DropForeignKey
ALTER TABLE "ItemDraftChange" DROP CONSTRAINT "ItemDraftChange_authorId_fkey";

-- DropForeignKey
ALTER TABLE "LabIdealTarget" DROP CONSTRAINT "LabIdealTarget_labItemId_fkey";

-- DropForeignKey
ALTER TABLE "LabIdealTarget" DROP CONSTRAINT "LabIdealTarget_categoryId_fkey";

-- DropIndex
DROP INDEX "LabCommitRequest_batchId_idx";

-- AlterTable
ALTER TABLE "LabCommitRequest" DROP COLUMN "baseVersions",
DROP COLUMN "batchId",
ADD COLUMN     "summary" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "versionId" TEXT;

-- DropTable
DROP TABLE "ItemDraftChange";

-- DropTable
DROP TABLE "LabIdealTarget";

-- DropEnum
DROP TYPE "DraftChangeStatus";

-- CreateTable
CREATE TABLE "LabVersion" (
    "id" TEXT NOT NULL,
    "labItemId" TEXT NOT NULL,
    "kind" "LabVersionKind" NOT NULL,
    "status" "LabVersionStatus" NOT NULL DEFAULT 'EDITING',
    "baseVersions" JSONB NOT NULL DEFAULT '{}',
    "rejectionNote" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LabVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VersionItem" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "parentId" TEXT,
    "sourceItemId" TEXT,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "status" "ItemStatus" NOT NULL DEFAULT 'WORKING',
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "props" JSONB NOT NULL DEFAULT '{}',
    "customProps" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "VersionItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LabVersion_labItemId_kind_key" ON "LabVersion"("labItemId", "kind");

-- CreateIndex
CREATE INDEX "VersionItem_versionId_idx" ON "VersionItem"("versionId");

-- CreateIndex
CREATE INDEX "VersionItem_sourceItemId_idx" ON "VersionItem"("sourceItemId");

-- AddForeignKey
ALTER TABLE "LabVersion" ADD CONSTRAINT "LabVersion_labItemId_fkey" FOREIGN KEY ("labItemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabVersion" ADD CONSTRAINT "LabVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VersionItem" ADD CONSTRAINT "VersionItem_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "LabVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

