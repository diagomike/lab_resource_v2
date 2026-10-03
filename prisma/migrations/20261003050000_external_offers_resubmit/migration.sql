-- AlterTable
ALTER TABLE "ExternalRequest" ADD COLUMN     "offerKey" TEXT,
ADD COLUMN     "peopleCount" INTEGER,
ADD COLUMN     "resubmitOfId" TEXT;

-- CreateIndex
CREATE INDEX "ExternalRequest_resubmitOfId_idx" ON "ExternalRequest"("resubmitOfId");

-- AddForeignKey
ALTER TABLE "ExternalRequest" ADD CONSTRAINT "ExternalRequest_resubmitOfId_fkey" FOREIGN KEY ("resubmitOfId") REFERENCES "ExternalRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

