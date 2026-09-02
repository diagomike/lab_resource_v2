-- CreateEnum
CREATE TYPE "CountingMode" AS ENUM ('SERIALIZED', 'BULK');

-- CreateEnum
CREATE TYPE "CategoryFieldType" AS ENUM ('TEXT', 'NUMBER', 'ENUM', 'BOOLEAN');

-- CreateEnum
CREATE TYPE "ImpairRule" AS ENUM ('ANY_CRITICAL', 'ALL_CRITICAL', 'NEVER');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('WORKING', 'BROKEN', 'UNDER_MAINTENANCE', 'LOST', 'CONSUMED');

-- AlterTable
ALTER TABLE "OrgNode" ADD COLUMN     "code" TEXT;

-- CreateTable
CREATE TABLE "CategoryGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CategoryGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourceCategory" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "iconKey" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "countingMode" "CountingMode" NOT NULL DEFAULT 'SERIALIZED',
    "unit" TEXT,
    "impairRule" "ImpairRule" NOT NULL DEFAULT 'ANY_CRITICAL',
    "defaultImageKey" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResourceCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryField" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "CategoryFieldType" NOT NULL,
    "options" TEXT[],
    "unit" TEXT,
    "summary" BOOLEAN NOT NULL DEFAULT false,
    "longText" BOOLEAN NOT NULL DEFAULT false,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CategoryField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "parentId" TEXT,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "countingMode" "CountingMode" NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "status" "ItemStatus" NOT NULL DEFAULT 'WORKING',
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "props" JSONB NOT NULL DEFAULT '{}',
    "ownerOrgNodeId" TEXT NOT NULL,
    "currentOrgNodeId" TEXT NOT NULL,
    "custodianId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "sourceSystem" TEXT,
    "sourceKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CategoryGroup_name_key" ON "CategoryGroup"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ResourceCategory_key_key" ON "ResourceCategory"("key");

-- CreateIndex
CREATE INDEX "ResourceCategory_groupId_idx" ON "ResourceCategory"("groupId");

-- CreateIndex
CREATE INDEX "ResourceCategory_active_idx" ON "ResourceCategory"("active");

-- CreateIndex
CREATE INDEX "CategoryField_categoryId_sortOrder_idx" ON "CategoryField"("categoryId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "CategoryField_categoryId_key_key" ON "CategoryField"("categoryId", "key");

-- CreateIndex
CREATE INDEX "Item_parentId_idx" ON "Item"("parentId");

-- CreateIndex
CREATE INDEX "Item_categoryId_idx" ON "Item"("categoryId");

-- CreateIndex
CREATE INDEX "Item_ownerOrgNodeId_idx" ON "Item"("ownerOrgNodeId");

-- CreateIndex
CREATE INDEX "Item_currentOrgNodeId_idx" ON "Item"("currentOrgNodeId");

-- CreateIndex
CREATE INDEX "Item_custodianId_idx" ON "Item"("custodianId");

-- CreateIndex
CREATE INDEX "Item_status_idx" ON "Item"("status");

-- CreateIndex
CREATE INDEX "Item_ownerOrgNodeId_categoryId_idx" ON "Item"("ownerOrgNodeId", "categoryId");

-- CreateIndex
CREATE INDEX "Item_currentOrgNodeId_categoryId_idx" ON "Item"("currentOrgNodeId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Item_sourceSystem_sourceKey_key" ON "Item"("sourceSystem", "sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "OrgNode_code_key" ON "OrgNode"("code");

-- AddForeignKey
ALTER TABLE "ResourceCategory" ADD CONSTRAINT "ResourceCategory_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CategoryGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryField" ADD CONSTRAINT "CategoryField_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ResourceCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ResourceCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_ownerOrgNodeId_fkey" FOREIGN KEY ("ownerOrgNodeId") REFERENCES "OrgNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_currentOrgNodeId_fkey" FOREIGN KEY ("currentOrgNodeId") REFERENCES "OrgNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_custodianId_fkey" FOREIGN KEY ("custodianId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-added: the bulk/serialized invariant, enforced where it cannot rot. A
-- SERIALIZED item is always exactly one physical unit; a BULK item is a quantity
-- at a place and may be zero (fully consumed) but never negative.
ALTER TABLE "Item" ADD CONSTRAINT "Item_qty_counting_mode_check"
  CHECK ( ("countingMode" = 'SERIALIZED' AND "qty" = 1)
       OR ("countingMode" = 'BULK'       AND "qty" >= 0) );

-- Hand-added: an item cannot contain itself. Deeper cycles are refused in the
-- service (item-cycle.ts), which also has to be cycle-SAFE on read regardless —
-- this catches the one case a single UPDATE can create.
ALTER TABLE "Item" ADD CONSTRAINT "Item_no_self_parent_check"
  CHECK ("parentId" IS NULL OR "parentId" <> "id");

-- Hand-added: containment-aware property search over the category-defined JSONB
-- properties every item carries.
CREATE INDEX "Item_props_gin" ON "Item" USING GIN ("props" jsonb_path_ops);
