-- CreateTable
CREATE TABLE "PurchaseStep" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "selector" "StepSelectorType" NOT NULL,
    "label" TEXT NOT NULL,
    "nodeId" TEXT,
    "approverId" TEXT,
    "status" "StepStatus" NOT NULL DEFAULT 'PENDING',
    "skipReason" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "PurchaseStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseStep_requestId_order_idx" ON "PurchaseStep"("requestId", "order");

-- CreateIndex
CREATE INDEX "PurchaseStep_approverId_idx" ON "PurchaseStep"("approverId");

-- AddForeignKey
ALTER TABLE "PurchaseStep" ADD CONSTRAINT "PurchaseStep_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PurchaseRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseStep" ADD CONSTRAINT "PurchaseStep_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "OrgNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseStep" ADD CONSTRAINT "PurchaseStep_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseStep" ADD CONSTRAINT "PurchaseStep_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

