-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('CBE', 'TELEBIRR', 'DASHEN', 'ABYSSINIA', 'CBEBIRR');

-- CreateEnum
CREATE TYPE "PaymentVerificationStatus" AS ENUM ('VERIFIED', 'REJECTED', 'PENDING_REVIEW', 'MANUAL_VERIFIED', 'MANUAL_REJECTED');

-- CreateTable
CREATE TABLE "PaymentVerification" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "reference" TEXT NOT NULL,
    "claimKey" TEXT,
    "status" "PaymentVerificationStatus" NOT NULL,
    "amountSantim" INTEGER,
    "payerName" TEXT,
    "receiverName" TEXT,
    "receiverAccount" TEXT,
    "paidAt" TIMESTAMPTZ(3),
    "raw" JSONB,
    "reason" TEXT,
    "requesterNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentVerification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentVerification_claimKey_key" ON "PaymentVerification"("claimKey");

-- CreateIndex
CREATE INDEX "PaymentVerification_requestId_createdAt_idx" ON "PaymentVerification"("requestId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentVerification_status_idx" ON "PaymentVerification"("status");

-- AddForeignKey
ALTER TABLE "PaymentVerification" ADD CONSTRAINT "PaymentVerification_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ExternalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentVerification" ADD CONSTRAINT "PaymentVerification_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

