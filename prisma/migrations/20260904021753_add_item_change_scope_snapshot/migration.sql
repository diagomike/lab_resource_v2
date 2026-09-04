-- AlterTable
ALTER TABLE "ItemChange" ADD COLUMN     "currentOrgNodeId" TEXT,
ADD COLUMN     "custodianId" TEXT,
ADD COLUMN     "ownerOrgNodeId" TEXT;

-- CreateIndex
CREATE INDEX "ItemChange_ownerOrgNodeId_idx" ON "ItemChange"("ownerOrgNodeId");

-- CreateIndex
CREATE INDEX "ItemChange_currentOrgNodeId_idx" ON "ItemChange"("currentOrgNodeId");

-- CreateIndex
CREATE INDEX "ItemChange_custodianId_idx" ON "ItemChange"("custodianId");
