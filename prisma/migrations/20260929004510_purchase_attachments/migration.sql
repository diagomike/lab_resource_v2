-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('PDF', 'IMAGE', 'SPREADSHEET');

-- CreateEnum
CREATE TYPE "AttachmentStatus" AS ENUM ('STAGED', 'ATTACHED');

-- CreateTable
CREATE TABLE "PurchaseAttachment" (
    "id" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "kind" "AttachmentKind" NOT NULL,
    "contentType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "status" "AttachmentStatus" NOT NULL DEFAULT 'STAGED',
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "purchaseId" TEXT,
    "eventId" TEXT,

    CONSTRAINT "PurchaseAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseAttachment_storageKey_key" ON "PurchaseAttachment"("storageKey");

-- CreateIndex
CREATE INDEX "PurchaseAttachment_purchaseId_idx" ON "PurchaseAttachment"("purchaseId");

-- CreateIndex
CREATE INDEX "PurchaseAttachment_eventId_idx" ON "PurchaseAttachment"("eventId");

-- CreateIndex
CREATE INDEX "PurchaseAttachment_status_expiresAt_idx" ON "PurchaseAttachment"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "PurchaseAttachment_uploadedById_status_idx" ON "PurchaseAttachment"("uploadedById", "status");

-- AddForeignKey
ALTER TABLE "PurchaseAttachment" ADD CONSTRAINT "PurchaseAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseAttachment" ADD CONSTRAINT "PurchaseAttachment_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "PurchaseRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseAttachment" ADD CONSTRAINT "PurchaseAttachment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "PurchaseEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
