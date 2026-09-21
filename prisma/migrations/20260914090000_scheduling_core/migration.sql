-- Track 6 (~/.claude/plans/understand-where-we-are-crystalline-marshmallow.md): the
-- scheduling core. The exclusion constraint needs btree_gist to combine text equality
-- with range overlap in one GiST index.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- CreateEnum
CREATE TYPE "BookingMode" AS ENUM ('NOT_BOOKABLE', 'ROOM', 'EQUIPMENT');

-- CreateEnum
CREATE TYPE "ReservationSource" AS ENUM ('CLASS', 'STAFF', 'EXTERNAL', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "ReservationState" AS ENUM ('REQUESTED', 'HELD', 'CONFIRMED', 'DECLINED', 'CANCELLED', 'EXPIRED');

-- AlterTable
ALTER TABLE "ResourceCategory" ADD COLUMN     "bookingMode" "BookingMode" NOT NULL DEFAULT 'NOT_BOOKABLE',
ADD COLUMN     "publicListed" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ScheduleSeries" (
    "id" TEXT NOT NULL,
    "labItemId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "section" TEXT,
    "instructorName" TEXT,
    "participantCount" INTEGER,
    "weekdays" INTEGER[],
    "startTimeLocal" TEXT NOT NULL,
    "endTimeLocal" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "timeZone" TEXT NOT NULL DEFAULT 'Africa/Addis_Ababa',
    "generation" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleSeriesResource" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,

    CONSTRAINT "ScheduleSeriesResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleSeriesException" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "reason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleSeriesException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" TEXT NOT NULL,
    "source" "ReservationSource" NOT NULL,
    "state" "ReservationState" NOT NULL,
    "title" TEXT NOT NULL,
    "labItemId" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "occursOnLocal" DATE,
    "seriesId" TEXT,
    "seriesGeneration" INTEGER,
    "requestedById" TEXT,
    "onBehalfOfNote" TEXT,
    "participantCount" INTEGER,
    "holdExpiresAt" TIMESTAMPTZ(3),
    "decidedById" TEXT,
    "decidedAt" TIMESTAMPTZ(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationResource" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "blocking" BOOLEAN NOT NULL,
    -- Generated from the two instants, half-open [startsAt, endsAt) so back-to-back
    -- sessions never overlap. Read only by the exclusion constraint below.
    "period" tstzrange GENERATED ALWAYS AS (tstzrange("startsAt", "endsAt", '[)')) STORED,

    CONSTRAINT "ReservationResource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduleSeries_labItemId_idx" ON "ScheduleSeries"("labItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleSeriesResource_seriesId_itemId_key" ON "ScheduleSeriesResource"("seriesId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleSeriesException_seriesId_date_key" ON "ScheduleSeriesException"("seriesId", "date");

-- CreateIndex
CREATE INDEX "Reservation_labItemId_startsAt_idx" ON "Reservation"("labItemId", "startsAt");

-- CreateIndex
CREATE INDEX "Reservation_requestedById_idx" ON "Reservation"("requestedById");

-- CreateIndex
CREATE INDEX "Reservation_seriesId_idx" ON "Reservation"("seriesId");

-- CreateIndex
CREATE INDEX "Reservation_state_holdExpiresAt_idx" ON "Reservation"("state", "holdExpiresAt");

-- CreateIndex
CREATE INDEX "ReservationResource_itemId_startsAt_idx" ON "ReservationResource"("itemId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReservationResource_reservationId_itemId_key" ON "ReservationResource"("reservationId", "itemId");

-- AddForeignKey
ALTER TABLE "ScheduleSeries" ADD CONSTRAINT "ScheduleSeries_labItemId_fkey" FOREIGN KEY ("labItemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleSeries" ADD CONSTRAINT "ScheduleSeries_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleSeriesResource" ADD CONSTRAINT "ScheduleSeriesResource_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "ScheduleSeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleSeriesResource" ADD CONSTRAINT "ScheduleSeriesResource_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleSeriesException" ADD CONSTRAINT "ScheduleSeriesException_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "ScheduleSeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleSeriesException" ADD CONSTRAINT "ScheduleSeriesException_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_labItemId_fkey" FOREIGN KEY ("labItemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "ScheduleSeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationResource" ADD CONSTRAINT "ReservationResource_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationResource" ADD CONSTRAINT "ReservationResource_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- An instant range must run forwards. Enforced here as well as in the service so no
-- write path can store a zero-length or inverted booking.
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_time_order_check" CHECK ("endsAt" > "startsAt");
ALTER TABLE "ReservationResource" ADD CONSTRAINT "ReservationResource_time_order_check" CHECK ("endsAt" > "startsAt");

-- The double-booking guard. Two BLOCKING claims (parent HELD or CONFIRMED) on the SAME
-- item may never overlap in time. Hierarchical clashes — a room booked while a machine
-- inside it is booked — cannot be expressed as a constraint and are checked under a
-- per-lab advisory lock by lib/server/scheduling/reservations.ts; this is the backstop
-- that makes same-item races structurally impossible rather than merely unlikely.
ALTER TABLE "ReservationResource" ADD CONSTRAINT "ReservationResource_no_overlap"
  EXCLUDE USING gist ("itemId" WITH =, "period" WITH &&) WHERE ("blocking");
