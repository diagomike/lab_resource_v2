-- CreateEnum
CREATE TYPE "DraftTargetKind" AS ENUM ('VISIBLE', 'IDEAL');

-- CreateEnum
CREATE TYPE "DraftChangeStatus" AS ENUM ('OPEN', 'SUBMITTED', 'APPLIED');

-- AlterTable
ALTER TABLE "OrgNode" ADD COLUMN     "draftWorkflowEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ItemDraftChange" (
    "id" TEXT NOT NULL,
    "labItemId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "targetKind" "DraftTargetKind" NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "DraftChangeStatus" NOT NULL DEFAULT 'OPEN',
    "batchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemDraftChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabCommitRequest" (
    "id" TEXT NOT NULL,
    "labItemId" TEXT NOT NULL,
    "targetKind" "DraftTargetKind" NOT NULL,
    "requesterId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "baseVersions" JSONB NOT NULL,
    "note" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabCommitRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabIdealTarget" (
    "id" TEXT NOT NULL,
    "labItemId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "idealQty" INTEGER NOT NULL,

    CONSTRAINT "LabIdealTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ItemDraftChange_labItemId_status_idx" ON "ItemDraftChange"("labItemId", "status");

-- CreateIndex
CREATE INDEX "ItemDraftChange_batchId_idx" ON "ItemDraftChange"("batchId");

-- CreateIndex
CREATE INDEX "LabCommitRequest_labItemId_status_idx" ON "LabCommitRequest"("labItemId", "status");

-- CreateIndex
CREATE INDEX "LabCommitRequest_requesterId_idx" ON "LabCommitRequest"("requesterId");

-- CreateIndex
CREATE INDEX "LabCommitRequest_batchId_idx" ON "LabCommitRequest"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "LabIdealTarget_labItemId_categoryId_key" ON "LabIdealTarget"("labItemId", "categoryId");

-- AddForeignKey
ALTER TABLE "ItemDraftChange" ADD CONSTRAINT "ItemDraftChange_labItemId_fkey" FOREIGN KEY ("labItemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemDraftChange" ADD CONSTRAINT "ItemDraftChange_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabCommitRequest" ADD CONSTRAINT "LabCommitRequest_labItemId_fkey" FOREIGN KEY ("labItemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabCommitRequest" ADD CONSTRAINT "LabCommitRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabCommitRequest" ADD CONSTRAINT "LabCommitRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabIdealTarget" ADD CONSTRAINT "LabIdealTarget_labItemId_fkey" FOREIGN KEY ("labItemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabIdealTarget" ADD CONSTRAINT "LabIdealTarget_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ResourceCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
