-- Track 7 (~/.claude/plans/understand-where-we-are-crystalline-marshmallow.md): external
-- booking requests from the public portal, the AVP -> department workflow, and the link
-- from a HELD reservation to the request it holds a slot for.

-- CreateEnum
CREATE TYPE "ExternalRequestStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'QUOTED', 'PAYMENT_SUBMITTED', 'PAID', 'SCHEDULED', 'DECLINED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ExternalAssignmentStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "externalRequestId" TEXT;

-- CreateTable
CREATE TABLE "ExternalRequest" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "ExternalRequestStatus" NOT NULL DEFAULT 'SUBMITTED',
    "organizationName" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "letterStorageKey" TEXT NOT NULL,
    "letterFileName" TEXT NOT NULL,
    "letterByteSize" INTEGER NOT NULL,
    "trackingTokenHash" TEXT NOT NULL,
    "submitterIpHash" TEXT,
    "quoteAmountSantim" INTEGER,
    "quoteNote" TEXT,
    "quoteSentAt" TIMESTAMPTZ(3),
    "paymentDeadline" TIMESTAMPTZ(3),
    "closingNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalRequestWindow" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "startTimeLocal" TEXT NOT NULL,
    "endTimeLocal" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ExternalRequestWindow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalRequestAssignment" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "orgNodeId" TEXT NOT NULL,
    "status" "ExternalAssignmentStatus" NOT NULL DEFAULT 'PENDING',
    "sheetUrl" TEXT,
    "amountSantim" INTEGER,
    "noCalendarNeeded" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalRequestAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalRequestEvent" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "actorLabel" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "note" TEXT,
    "data" JSONB,

    CONSTRAINT "ExternalRequestEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExternalRequest_reference_key" ON "ExternalRequest"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalRequest_trackingTokenHash_key" ON "ExternalRequest"("trackingTokenHash");

-- CreateIndex
CREATE INDEX "ExternalRequest_status_idx" ON "ExternalRequest"("status");

-- CreateIndex
CREATE INDEX "ExternalRequest_contactEmail_createdAt_idx" ON "ExternalRequest"("contactEmail", "createdAt");

-- CreateIndex
CREATE INDEX "ExternalRequest_submitterIpHash_createdAt_idx" ON "ExternalRequest"("submitterIpHash", "createdAt");

-- CreateIndex
CREATE INDEX "ExternalRequestWindow_requestId_idx" ON "ExternalRequestWindow"("requestId");

-- CreateIndex
CREATE INDEX "ExternalRequestAssignment_orgNodeId_status_idx" ON "ExternalRequestAssignment"("orgNodeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalRequestAssignment_requestId_orgNodeId_key" ON "ExternalRequestAssignment"("requestId", "orgNodeId");

-- CreateIndex
CREATE INDEX "ExternalRequestEvent_requestId_at_idx" ON "ExternalRequestEvent"("requestId", "at");

-- CreateIndex
CREATE INDEX "Reservation_externalRequestId_idx" ON "Reservation"("externalRequestId");

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_externalRequestId_fkey" FOREIGN KEY ("externalRequestId") REFERENCES "ExternalRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalRequestWindow" ADD CONSTRAINT "ExternalRequestWindow_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ExternalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalRequestAssignment" ADD CONSTRAINT "ExternalRequestAssignment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ExternalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalRequestAssignment" ADD CONSTRAINT "ExternalRequestAssignment_orgNodeId_fkey" FOREIGN KEY ("orgNodeId") REFERENCES "OrgNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalRequestAssignment" ADD CONSTRAINT "ExternalRequestAssignment_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalRequestEvent" ADD CONSTRAINT "ExternalRequestEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ExternalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalRequestEvent" ADD CONSTRAINT "ExternalRequestEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

