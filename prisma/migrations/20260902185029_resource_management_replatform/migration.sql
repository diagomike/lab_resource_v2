-- CreateEnum
CREATE TYPE "CountingMode" AS ENUM ('SERIALIZED', 'BULK');

-- CreateEnum
CREATE TYPE "CategoryFieldType" AS ENUM ('TEXT', 'NUMBER', 'ENUM', 'BOOLEAN');

-- CreateEnum
CREATE TYPE "ImpairRule" AS ENUM ('ANY_CRITICAL', 'ALL_CRITICAL', 'NEVER');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('WORKING', 'BROKEN', 'UNDER_MAINTENANCE', 'LOST', 'CONSUMED');

-- CreateEnum
CREATE TYPE "ItemChangeKind" AS ENUM ('createItem', 'deleteItem', 'setName', 'setStatus', 'setProperty', 'setQuantity', 'setCustodian', 'setOwnerOrg', 'setCurrentOrg', 'moveInTree', 'transferItem', 'addImage', 'removeImage', 'editCategory');

-- CreateEnum
CREATE TYPE "ItemChangeTarget" AS ENUM ('ITEM', 'CATEGORY');

-- CreateEnum
CREATE TYPE "ScopeMode" AS ENUM ('UNIVERSITY', 'ORG_SUBTREE', 'MY_CUSTODY', 'EXPLICIT_NODES');

-- CreateEnum
CREATE TYPE "ViewAudienceType" AS ENUM ('EVERYONE', 'ROLE', 'PERSON');

-- CreateEnum
CREATE TYPE "PolicyOutcome" AS ENUM ('AUTO', 'CHAIN', 'DENY');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'APPLIED', 'REJECTED', 'CANCELLED', 'STALE');

-- CreateEnum
CREATE TYPE "StepStatus" AS ENUM ('PENDING', 'WAITING', 'APPROVED', 'REJECTED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "StepSelectorType" AS ENUM ('HIERARCHY', 'NODE_OCCUPANT', 'OWNER_ANCESTOR', 'OWNER_HEAD', 'TARGET_HEAD', 'ITEM_CUSTODIAN', 'TARGET_CUSTODIAN', 'REQUESTER_RECEIPT');

-- CreateEnum
CREATE TYPE "NeedStatus" AS ENUM ('OPEN', 'CARRIED', 'DECLINED');

-- CreateEnum
CREATE TYPE "PurchaseStage" AS ENUM ('DRAFT', 'APPROVING', 'REVISING', 'ORDER_PLACED', 'BUYER_FOUND', 'ON_DELIVERY', 'IN_STORE', 'CLOSED', 'REJECTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "organisation" TEXT,
ADD COLUMN     "title" TEXT;

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
CREATE TABLE "CategoryTemplateChild" (
    "id" TEXT NOT NULL,
    "parentCategoryId" TEXT NOT NULL,
    "childCategoryId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "critical" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CategoryTemplateChild_pkey" PRIMARY KEY ("id")
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

-- CreateTable
CREATE TABLE "ItemImage" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "caption" TEXT,
    "contentType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "uploadedById" TEXT,
    "sourceSystem" TEXT,
    "sourceKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemChange" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT NOT NULL,
    "kind" "ItemChangeKind" NOT NULL,
    "targetKind" "ItemChangeTarget" NOT NULL,
    "itemId" TEXT,
    "itemName" TEXT NOT NULL,
    "categoryId" TEXT,
    "field" TEXT,
    "before" JSONB,
    "after" JSONB,
    "batchId" TEXT,
    "note" TEXT,

    CONSTRAINT "ItemChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessView" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scope" "ScopeMode" NOT NULL DEFAULT 'ORG_SUBTREE',
    "explicitNodeIds" TEXT[],
    "extraFilters" JSONB,
    "canEdit" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessViewAudience" (
    "id" TEXT NOT NULL,
    "viewId" TEXT NOT NULL,
    "type" "ViewAudienceType" NOT NULL,
    "role" "RoleKind",
    "personId" TEXT,

    CONSTRAINT "AccessViewAudience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalPolicy" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "operation" "ItemChangeKind" NOT NULL,
    "appliesTo" JSONB NOT NULL,
    "actorRole" "RoleKind",
    "outcome" "PolicyOutcome" NOT NULL,
    "chain" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeRequest" (
    "id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "requesterId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "baseVersions" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "note" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,

    CONSTRAINT "ChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChainStep" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "selector" "StepSelectorType" NOT NULL,
    "label" TEXT NOT NULL,
    "nodeId" TEXT,
    "approverId" TEXT,
    "status" "StepStatus" NOT NULL DEFAULT 'PENDING',
    "skipReason" TEXT,
    "receipt" BOOLEAN NOT NULL DEFAULT false,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "ChainStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NeedLine" (
    "id" TEXT NOT NULL,
    "raisedById" TEXT NOT NULL,
    "orgNodeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "unit" TEXT,
    "categoryId" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "NeedStatus" NOT NULL DEFAULT 'OPEN',
    "handledById" TEXT,
    "handledAt" TIMESTAMP(3),
    "note" TEXT,
    "purchaseLineId" TEXT,

    CONSTRAINT "NeedLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseRequest" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "orgNodeId" TEXT NOT NULL,
    "raisedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "title" TEXT NOT NULL,
    "stage" "PurchaseStage" NOT NULL DEFAULT 'DRAFT',
    "feedback" TEXT,

    CONSTRAINT "PurchaseRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseLine" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "unit" TEXT,
    "categoryId" TEXT,
    "estimatedUnitCost" DECIMAL(18,4),
    "justification" TEXT,
    "receivedQty" DECIMAL(18,4),
    "receivedAt" TIMESTAMP(3),
    "receivedById" TEXT,

    CONSTRAINT "PurchaseLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseEvent" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "byId" TEXT NOT NULL,
    "stage" "PurchaseStage" NOT NULL,
    "note" TEXT,

    CONSTRAINT "PurchaseEvent_pkey" PRIMARY KEY ("id")
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
CREATE INDEX "CategoryTemplateChild_childCategoryId_idx" ON "CategoryTemplateChild"("childCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "CategoryTemplateChild_parentCategoryId_childCategoryId_key" ON "CategoryTemplateChild"("parentCategoryId", "childCategoryId");

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
CREATE UNIQUE INDEX "ItemImage_storageKey_key" ON "ItemImage"("storageKey");

-- CreateIndex
CREATE INDEX "ItemImage_itemId_sortOrder_idx" ON "ItemImage"("itemId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ItemImage_sourceSystem_sourceKey_key" ON "ItemImage"("sourceSystem", "sourceKey");

-- CreateIndex
CREATE INDEX "ItemChange_itemId_idx" ON "ItemChange"("itemId");

-- CreateIndex
CREATE INDEX "ItemChange_categoryId_idx" ON "ItemChange"("categoryId");

-- CreateIndex
CREATE INDEX "ItemChange_batchId_idx" ON "ItemChange"("batchId");

-- CreateIndex
CREATE INDEX "ItemChange_at_idx" ON "ItemChange"("at");

-- CreateIndex
CREATE INDEX "AccessView_active_idx" ON "AccessView"("active");

-- CreateIndex
CREATE INDEX "AccessViewAudience_viewId_idx" ON "AccessViewAudience"("viewId");

-- CreateIndex
CREATE INDEX "AccessViewAudience_role_idx" ON "AccessViewAudience"("role");

-- CreateIndex
CREATE INDEX "AccessViewAudience_personId_idx" ON "AccessViewAudience"("personId");

-- CreateIndex
CREATE INDEX "ApprovalPolicy_operation_idx" ON "ApprovalPolicy"("operation");

-- CreateIndex
CREATE INDEX "ApprovalPolicy_enabled_idx" ON "ApprovalPolicy"("enabled");

-- CreateIndex
CREATE INDEX "ChangeRequest_requesterId_idx" ON "ChangeRequest"("requesterId");

-- CreateIndex
CREATE INDEX "ChangeRequest_status_idx" ON "ChangeRequest"("status");

-- CreateIndex
CREATE INDEX "ChainStep_requestId_order_idx" ON "ChainStep"("requestId", "order");

-- CreateIndex
CREATE INDEX "ChainStep_approverId_idx" ON "ChainStep"("approverId");

-- CreateIndex
CREATE INDEX "NeedLine_orgNodeId_idx" ON "NeedLine"("orgNodeId");

-- CreateIndex
CREATE INDEX "NeedLine_status_idx" ON "NeedLine"("status");

-- CreateIndex
CREATE INDEX "NeedLine_purchaseLineId_idx" ON "NeedLine"("purchaseLineId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseRequest_reference_key" ON "PurchaseRequest"("reference");

-- CreateIndex
CREATE INDEX "PurchaseRequest_orgNodeId_idx" ON "PurchaseRequest"("orgNodeId");

-- CreateIndex
CREATE INDEX "PurchaseRequest_stage_idx" ON "PurchaseRequest"("stage");

-- CreateIndex
CREATE INDEX "PurchaseLine_purchaseId_idx" ON "PurchaseLine"("purchaseId");

-- CreateIndex
CREATE INDEX "PurchaseEvent_purchaseId_at_idx" ON "PurchaseEvent"("purchaseId", "at");

-- AddForeignKey
ALTER TABLE "ResourceCategory" ADD CONSTRAINT "ResourceCategory_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CategoryGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryField" ADD CONSTRAINT "CategoryField_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ResourceCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryTemplateChild" ADD CONSTRAINT "CategoryTemplateChild_parentCategoryId_fkey" FOREIGN KEY ("parentCategoryId") REFERENCES "ResourceCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryTemplateChild" ADD CONSTRAINT "CategoryTemplateChild_childCategoryId_fkey" FOREIGN KEY ("childCategoryId") REFERENCES "ResourceCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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

-- AddForeignKey
ALTER TABLE "ItemImage" ADD CONSTRAINT "ItemImage_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemImage" ADD CONSTRAINT "ItemImage_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemChange" ADD CONSTRAINT "ItemChange_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessViewAudience" ADD CONSTRAINT "AccessViewAudience_viewId_fkey" FOREIGN KEY ("viewId") REFERENCES "AccessView"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessViewAudience" ADD CONSTRAINT "AccessViewAudience_personId_fkey" FOREIGN KEY ("personId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChainStep" ADD CONSTRAINT "ChainStep_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ChangeRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChainStep" ADD CONSTRAINT "ChainStep_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "OrgNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChainStep" ADD CONSTRAINT "ChainStep_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChainStep" ADD CONSTRAINT "ChainStep_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NeedLine" ADD CONSTRAINT "NeedLine_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NeedLine" ADD CONSTRAINT "NeedLine_orgNodeId_fkey" FOREIGN KEY ("orgNodeId") REFERENCES "OrgNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NeedLine" ADD CONSTRAINT "NeedLine_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ResourceCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NeedLine" ADD CONSTRAINT "NeedLine_handledById_fkey" FOREIGN KEY ("handledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NeedLine" ADD CONSTRAINT "NeedLine_purchaseLineId_fkey" FOREIGN KEY ("purchaseLineId") REFERENCES "PurchaseLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_orgNodeId_fkey" FOREIGN KEY ("orgNodeId") REFERENCES "OrgNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "PurchaseRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ResourceCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseEvent" ADD CONSTRAINT "PurchaseEvent_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "PurchaseRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseEvent" ADD CONSTRAINT "PurchaseEvent_byId_fkey" FOREIGN KEY ("byId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
