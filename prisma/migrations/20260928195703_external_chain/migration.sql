-- CreateEnum
CREATE TYPE "ExternalAssignmentLevel" AS ENUM ('COLLEGE', 'DEPARTMENT');

-- CreateEnum
CREATE TYPE "ExternalRequestKind" AS ENUM ('FACILITY', 'SAMPLE_ANALYSIS');

-- CreateEnum
CREATE TYPE "ExternalTaskStatus" AS ENUM ('PENDING', 'DONE', 'DECLINED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ExternalAssignmentStatus" ADD VALUE 'FORWARDED';
ALTER TYPE "ExternalAssignmentStatus" ADD VALUE 'SUBMITTED';
ALTER TYPE "ExternalAssignmentStatus" ADD VALUE 'APPROVED';
ALTER TYPE "ExternalAssignmentStatus" ADD VALUE 'RETURNED';

-- AlterTable
ALTER TABLE "ExternalRequest" ADD COLUMN     "contactsRevealedAt" TIMESTAMPTZ(3),
ADD COLUMN     "kind" "ExternalRequestKind" NOT NULL DEFAULT 'FACILITY',
ADD COLUMN     "requesterId" TEXT,
ADD COLUMN     "sample" JSONB,
ALTER COLUMN "trackingTokenHash" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ExternalRequestAssignment" ADD COLUMN     "contacts" JSONB,
ADD COLUMN     "level" "ExternalAssignmentLevel" NOT NULL DEFAULT 'DEPARTMENT',
ADD COLUMN     "parentId" TEXT;

-- CreateTable
CREATE TABLE "ExternalCustodianTask" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "custodianId" TEXT NOT NULL,
    "want" TEXT NOT NULL,
    "status" "ExternalTaskStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "decidedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalCustodianTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExternalCustodianTask_custodianId_status_idx" ON "ExternalCustodianTask"("custodianId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalCustodianTask_assignmentId_custodianId_key" ON "ExternalCustodianTask"("assignmentId", "custodianId");

-- CreateIndex
CREATE INDEX "ExternalRequest_requesterId_idx" ON "ExternalRequest"("requesterId");

-- CreateIndex
CREATE INDEX "ExternalRequestAssignment_parentId_idx" ON "ExternalRequestAssignment"("parentId");

-- AddForeignKey
ALTER TABLE "ExternalRequest" ADD CONSTRAINT "ExternalRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalRequestAssignment" ADD CONSTRAINT "ExternalRequestAssignment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ExternalRequestAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalCustodianTask" ADD CONSTRAINT "ExternalCustodianTask_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "ExternalRequestAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalCustodianTask" ADD CONSTRAINT "ExternalCustodianTask_custodianId_fkey" FOREIGN KEY ("custodianId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
