-- CreateEnum
CREATE TYPE "ProcurementStage" AS ENUM ('PREPARING', 'PLACED_ON_EGP', 'BUYER_FOUND', 'ON_DELIVERY', 'ARRIVED', 'CLOSED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "ImportSource" ADD VALUE 'PROCUREMENT';

-- AlterEnum
ALTER TYPE "PurchaseStage" ADD VALUE 'WITH_PROCUREMENT';

-- AlterTable
ALTER TABLE "ImportRecord" ADD COLUMN     "procurementId" TEXT;

-- CreateTable
CREATE TABLE "Procurement" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "egpReference" TEXT,
    "supplier" TEXT,
    "stage" "ProcurementStage" NOT NULL DEFAULT 'PREPARING',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Procurement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcurementRequest" (
    "procurementId" TEXT NOT NULL,
    "purchaseRequestId" TEXT NOT NULL,

    CONSTRAINT "ProcurementRequest_pkey" PRIMARY KEY ("procurementId","purchaseRequestId")
);

-- CreateTable
CREATE TABLE "ProcurementLine" (
    "id" TEXT NOT NULL,
    "procurementId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" TEXT,
    "qty" DECIMAL(18,4) NOT NULL,
    "unit" TEXT,
    "unitCost" DECIMAL(18,4),
    "spec" TEXT,
    "purchaseLineId" TEXT,
    "arrivedQty" DECIMAL(18,4),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProcurementLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcurementEvent" (
    "id" TEXT NOT NULL,
    "procurementId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "byId" TEXT NOT NULL,
    "stage" "ProcurementStage" NOT NULL,
    "note" TEXT,
    "lineChanges" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "ProcurementEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Procurement_reference_key" ON "Procurement"("reference");

-- CreateIndex
CREATE INDEX "Procurement_stage_idx" ON "Procurement"("stage");

-- CreateIndex
CREATE INDEX "ProcurementRequest_purchaseRequestId_idx" ON "ProcurementRequest"("purchaseRequestId");

-- CreateIndex
CREATE INDEX "ProcurementLine_procurementId_idx" ON "ProcurementLine"("procurementId");

-- CreateIndex
CREATE INDEX "ProcurementLine_purchaseLineId_idx" ON "ProcurementLine"("purchaseLineId");

-- CreateIndex
CREATE INDEX "ProcurementEvent_procurementId_at_idx" ON "ProcurementEvent"("procurementId", "at");

-- CreateIndex
CREATE INDEX "ImportRecord_procurementId_idx" ON "ImportRecord"("procurementId");

-- AddForeignKey
ALTER TABLE "ImportRecord" ADD CONSTRAINT "ImportRecord_procurementId_fkey" FOREIGN KEY ("procurementId") REFERENCES "Procurement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Procurement" ADD CONSTRAINT "Procurement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcurementRequest" ADD CONSTRAINT "ProcurementRequest_procurementId_fkey" FOREIGN KEY ("procurementId") REFERENCES "Procurement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcurementRequest" ADD CONSTRAINT "ProcurementRequest_purchaseRequestId_fkey" FOREIGN KEY ("purchaseRequestId") REFERENCES "PurchaseRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcurementLine" ADD CONSTRAINT "ProcurementLine_procurementId_fkey" FOREIGN KEY ("procurementId") REFERENCES "Procurement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcurementLine" ADD CONSTRAINT "ProcurementLine_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ResourceCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcurementLine" ADD CONSTRAINT "ProcurementLine_purchaseLineId_fkey" FOREIGN KEY ("purchaseLineId") REFERENCES "PurchaseLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcurementEvent" ADD CONSTRAINT "ProcurementEvent_procurementId_fkey" FOREIGN KEY ("procurementId") REFERENCES "Procurement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcurementEvent" ADD CONSTRAINT "ProcurementEvent_byId_fkey" FOREIGN KEY ("byId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Data: every request already on order (ORDER_PLACED … IN_STORE) gets its own procurement
-- at the matching stage, buying exactly its lines; the request keeps its stage and now
-- follows the procurement. PR-2026-001 → PROC-2026-001.
INSERT INTO "Procurement" ("id", "reference", "title", "stage", "createdById", "createdAt", "updatedAt")
SELECT 'proc_' || pr."id",
       'PROC-' || substring(pr."reference" from 4),
       pr."title",
       (CASE pr."stage" WHEN 'ORDER_PLACED' THEN 'PLACED_ON_EGP' WHEN 'BUYER_FOUND' THEN 'BUYER_FOUND' WHEN 'ON_DELIVERY' THEN 'ON_DELIVERY' ELSE 'ARRIVED' END)::"ProcurementStage",
       COALESCE((SELECT e."byId" FROM "PurchaseEvent" e WHERE e."purchaseId" = pr."id" ORDER BY e."at" DESC LIMIT 1), pr."raisedById"),
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP
FROM "PurchaseRequest" pr
WHERE pr."stage" IN ('ORDER_PLACED', 'BUYER_FOUND', 'ON_DELIVERY', 'IN_STORE');

INSERT INTO "ProcurementRequest" ("procurementId", "purchaseRequestId")
SELECT 'proc_' || pr."id", pr."id" FROM "PurchaseRequest" pr
WHERE pr."stage" IN ('ORDER_PLACED', 'BUYER_FOUND', 'ON_DELIVERY', 'IN_STORE');

INSERT INTO "ProcurementLine" ("id", "procurementId", "name", "categoryId", "qty", "unit", "unitCost", "purchaseLineId", "arrivedQty", "sortOrder")
SELECT 'procl_' || l."id", 'proc_' || pr."id", l."name", l."categoryId", l."qty", l."unit", l."estimatedUnitCost", l."id",
       CASE WHEN pr."stage" = 'IN_STORE' THEN l."qty" ELSE NULL END,
       ROW_NUMBER() OVER (PARTITION BY pr."id" ORDER BY l."id")::int
FROM "PurchaseLine" l JOIN "PurchaseRequest" pr ON pr."id" = l."purchaseId"
WHERE pr."stage" IN ('ORDER_PLACED', 'BUYER_FOUND', 'ON_DELIVERY', 'IN_STORE');

INSERT INTO "ProcurementEvent" ("id", "procurementId", "byId", "stage", "note")
SELECT 'proce_' || p."id", p."id", p."createdById", p."stage", 'Carried over from the request''s own pipeline.'
FROM "Procurement" p WHERE p."id" LIKE 'proc\_%';

UPDATE "ImportRecord" r SET "procurementId" = 'proc_' || r."purchaseRequestId"
WHERE r."purchaseRequestId" IS NOT NULL AND EXISTS (SELECT 1 FROM "Procurement" p WHERE p."id" = 'proc_' || r."purchaseRequestId");
