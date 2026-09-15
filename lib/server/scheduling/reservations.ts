import "server-only";
import type { BookableDto, BookingInput, BookingPreviewDto, ReservationDto, SchedulingLabDto } from "@/lib/shared";
import { prisma } from "../prisma";
import { HttpError } from "../http-error";
import { findClashes } from "@/lib/domain/availability";
import { DEFAULT_TIME_ZONE, addDays, civilToInstant, isCivilDate, minutesOf } from "@/lib/domain/civil-time";
import {
  RESERVATION_INCLUDE,
  assertMayBook,
  dateColumn,
  decidesFor,
  expireHolds,
  isOverlapViolation,
  lineageRows,
  loadClaims,
  lockTree,
  overlapConflict,
  resolveBookingTarget,
  roomOf,
  rootOf,
  subtreeRows,
  toClashDtos,
  toReservationDto,
  viewerOf,
  type BookingTarget,
  type TreeRow,
} from "./context";

/**
 * Track 6 — staff bookings of a room or specific machines in it, decided by the room's
 * custodian (~/.claude/plans/understand-where-we-are-crystalline-marshmallow.md).
 *
 * Every write runs in one transaction: lock the containment tree, sweep lapsed holds,
 * load overlapping claims, run lib/domain/availability's hierarchical clash rule, write.
 * A REQUESTED booking contends but never blocks; the custodian's approval re-checks and
 * flips it to CONFIRMED, at which point the exclusion constraint also applies.
 */

const MAX_BOOKING_MINUTES = 16 * 60;
const TX = { timeout: 20_000 };

function windowOf(input: Pick<BookingInput, "date" | "start" | "end">, timeZone = DEFAULT_TIME_ZONE): { startsAt: Date; endsAt: Date } {
  if (!isCivilDate(input.date)) throw new HttpError(400, "Choose a real date.");
  const length = minutesOf(input.end) - minutesOf(input.start);
  if (length <= 0) throw new HttpError(400, "A booking must end after it starts, on the same day.");
  if (length > MAX_BOOKING_MINUTES) throw new HttpError(400, "A single booking can last at most 16 hours.");
  return { startsAt: civilToInstant(input.date, input.start, timeZone), endsAt: civilToInstant(input.date, input.end, timeZone) };
}

export function parentLookup(rows: TreeRow[]): (id: string) => string | null {
  const parents = new Map(rows.map((r) => [r.id, r.parentId]));
  return (id) => parents.get(id) ?? null;
}

export async function loadDto(id: string, userId: string): Promise<ReservationDto> {
  const [row, viewer] = await Promise.all([prisma.reservation.findUniqueOrThrow({ where: { id }, include: RESERVATION_INCLUDE }), viewerOf(userId)]);
  return toReservationDto(row, viewer);
}

// ── Preview & create ───────────────────────────────────────────────────────────

export async function previewBooking(userId: string, input: BookingInput): Promise<BookingPreviewDto> {
  await assertMayBook(userId);
  const { startsAt, endsAt } = windowOf(input);
  const target = await resolveBookingTarget(prisma, input.itemIds);
  const [tree, viewer, custodian] = await Promise.all([
    subtreeRows(prisma, target.rootId),
    viewerOf(userId),
    prisma.user.findUnique({ where: { id: target.lab.custodianId }, select: { name: true } }),
  ]);
  const treeIds = tree.map((r) => r.id);
  // A lapsed hold must not show as blocking; the sweep is idempotent, so a read may run it.
  await expireHolds(prisma, treeIds);
  const { claims, meta } = await loadClaims(prisma, treeIds, startsAt, endsAt);
  const clashes = findClashes({ itemIds: target.items.map((i) => i.id), startsAt, endsAt }, claims, parentLookup(tree));
  const names = new Map(tree.map((r) => [r.id, r.name]));
  const dtos = toClashDtos(clashes, names, meta);
  return {
    labItemId: target.lab.id,
    labName: target.lab.name,
    custodianName: custodian?.name ?? "",
    autoConfirm: decidesFor(viewer, target.lab.id),
    blocking: dtos.filter((c) => c.blocking),
    contending: dtos.filter((c) => !c.blocking),
  };
}

export interface NewReservation {
  source: "STAFF" | "EXTERNAL" | "MAINTENANCE";
  state: "REQUESTED" | "HELD" | "CONFIRMED";
  title: string;
  requestedById: string;
  decidedById?: string | null;
  onBehalfOfNote?: string | null;
  participantCount?: number | null;
  note?: string | null;
  externalRequestId?: string | null;
  holdExpiresAt?: Date | null;
}

/**
 * The one locked write every one-off reservation goes through — a staff booking here,
 * an external hold from lib/server/external/requests.ts. Refuses with 409 + `clashes`
 * when a HELD/CONFIRMED claim is in the way. Callers do their own authorization first.
 */
export async function writeReservation(target: BookingTarget, window: Pick<BookingInput, "date" | "start" | "end">, data: NewReservation): Promise<string> {
  const { startsAt, endsAt } = windowOf(window);
  if (startsAt.getTime() < Date.now()) throw new HttpError(400, "That time has already started — choose a time in the future.");
  const itemIds = target.items.map((i) => i.id);
  try {
    return await prisma.$transaction(async (tx) => {
      await lockTree(tx, target.rootId);
      const tree = await subtreeRows(tx, target.rootId);
      const treeIds = tree.map((r) => r.id);
      await expireHolds(tx, treeIds);
      const { claims, meta } = await loadClaims(tx, treeIds, startsAt, endsAt);
      const blocking = findClashes({ itemIds, startsAt, endsAt }, claims, parentLookup(tree)).filter((c) => c.blocking);
      if (blocking.length) {
        throw new HttpError(409, "This slot is already taken.", {
          message: "This slot is already taken.",
          clashes: toClashDtos(blocking, new Map(tree.map((r) => [r.id, r.name])), meta),
        });
      }
      const blocks = data.state !== "REQUESTED";
      const row = await tx.reservation.create({
        data: {
          source: data.source,
          state: data.state,
          title: data.title,
          labItemId: target.lab.id,
          startsAt,
          endsAt,
          occursOnLocal: dateColumn(window.date),
          requestedById: data.requestedById,
          onBehalfOfNote: data.onBehalfOfNote || null,
          participantCount: data.participantCount ?? null,
          note: data.note || null,
          externalRequestId: data.externalRequestId ?? null,
          holdExpiresAt: data.holdExpiresAt ?? null,
          decidedById: data.decidedById ?? null,
          decidedAt: data.decidedById ? new Date() : null,
          resources: { create: itemIds.map((itemId) => ({ itemId, startsAt, endsAt, blocking: blocks })) },
        },
      });
      return row.id;
    }, TX);
  } catch (err) {
    if (isOverlapViolation(err)) throw overlapConflict();
    throw err;
  }
}

export async function createStaffBooking(userId: string, input: BookingInput): Promise<ReservationDto> {
  await assertMayBook(userId);
  windowOf(input);
  const target = await resolveBookingTarget(prisma, input.itemIds);
  const viewer = await viewerOf(userId);
  const confirms = decidesFor(viewer, target.lab.id);
  const id = await writeReservation(target, input, {
    source: "STAFF",
    state: confirms ? "CONFIRMED" : "REQUESTED",
    title: input.title,
    requestedById: userId,
    decidedById: confirms ? userId : null,
    onBehalfOfNote: input.onBehalfOfNote,
    participantCount: input.participantCount,
    note: input.note,
  });
  return loadDto(id, userId);
}

// ── Decide & cancel ────────────────────────────────────────────────────────────

export async function decideBooking(userId: string, id: string, decision: "APPROVE" | "DECLINE", note?: string): Promise<ReservationDto> {
  const row = await prisma.reservation.findUnique({ where: { id }, include: { resources: true } });
  if (!row) throw new HttpError(404, "Booking not found");
  const viewer = await viewerOf(userId);
  if (!decidesFor(viewer, row.labItemId)) throw new HttpError(403, "Only this room's custodian decides its bookings.");
  if (row.state !== "REQUESTED") throw new HttpError(409, "This booking has already been decided.");

  const now = new Date();
  if (decision === "DECLINE") {
    await prisma.reservation.update({ where: { id }, data: { state: "DECLINED", decidedById: userId, decidedAt: now, note: note || row.note } });
    return loadDto(id, userId);
  }
  if (row.startsAt < now) throw new HttpError(409, "This booking's time has already started, so it can only be declined.");

  const lineage = await lineageRows(prisma, [row.labItemId]);
  const rootId = rootOf(lineage, row.labItemId);
  try {
    await prisma.$transaction(async (tx) => {
      await lockTree(tx, rootId);
      const tree = await subtreeRows(tx, rootId);
      const treeIds = tree.map((r) => r.id);
      await expireHolds(tx, treeIds);
      const { claims, meta } = await loadClaims(tx, treeIds, row.startsAt, row.endsAt);
      const blocking = findClashes({ itemIds: row.resources.map((r) => r.itemId), startsAt: row.startsAt, endsAt: row.endsAt }, claims, parentLookup(tree), [id]).filter((c) => c.blocking);
      if (blocking.length) {
        throw new HttpError(409, "Something else now holds this slot — decline this request or ask for another time.", {
          message: "Something else now holds this slot — decline this request or ask for another time.",
          clashes: toClashDtos(blocking, new Map(tree.map((r) => [r.id, r.name])), meta),
        });
      }
      await tx.reservation.update({ where: { id }, data: { state: "CONFIRMED", decidedById: userId, decidedAt: now, note: note || row.note } });
      await tx.reservationResource.updateMany({ where: { reservationId: id }, data: { blocking: true } });
    }, TX);
  } catch (err) {
    if (isOverlapViolation(err)) throw overlapConflict();
    throw err;
  }
  return loadDto(id, userId);
}

/** The requester may withdraw their own staff booking; the room's custodian may cancel
 *  anything on its calendar. Cancelling one class occurrence records a series exception
 *  too, so regenerating the series never brings it back. */
export async function cancelBooking(userId: string, id: string, note?: string): Promise<ReservationDto> {
  const row = await prisma.reservation.findUnique({ where: { id } });
  if (!row) throw new HttpError(404, "Booking not found");
  const viewer = await viewerOf(userId);
  const decides = decidesFor(viewer, row.labItemId);
  const ownStaffBooking = row.requestedById === userId && row.source === "STAFF";
  if (!decides && !ownStaffBooking) throw new HttpError(403, "Only the person who booked this, or the room's custodian, may cancel it.");
  if (!["REQUESTED", "HELD", "CONFIRMED"].includes(row.state)) throw new HttpError(409, "This booking is no longer active.");

  await prisma.$transaction(async (tx) => {
    if (row.source === "CLASS" && row.seriesId && row.occursOnLocal) {
      await tx.scheduleSeriesException.upsert({
        where: { seriesId_date: { seriesId: row.seriesId, date: row.occursOnLocal } },
        create: { seriesId: row.seriesId, date: row.occursOnLocal, reason: note || null, createdById: userId },
        update: { reason: note || undefined },
      });
    }
    await tx.reservation.update({ where: { id }, data: { state: "CANCELLED", note: note || row.note, decidedById: decides ? userId : row.decidedById, decidedAt: new Date() } });
    await tx.reservationResource.updateMany({ where: { reservationId: id }, data: { blocking: false } });
  });
  return loadDto(id, userId);
}

// ── Reads ──────────────────────────────────────────────────────────────────────

/** Everything live on a room's calendar — bookings of the room or anything inside it —
 *  between two civil dates (inclusive), in the venue's zone. */
export async function listCalendar(userId: string, labItemId: string, from: string, to: string): Promise<ReservationDto[]> {
  await assertMayBook(userId);
  if (!isCivilDate(from) || !isCivilDate(to) || to < from) throw new HttpError(400, "Give a date range like from=2026-09-14&to=2026-09-20.");
  if (addDays(from, 62) < to) throw new HttpError(400, "Ask for at most two months at a time.");
  const lab = await prisma.item.findUnique({ where: { id: labItemId }, include: { category: { select: { bookingMode: true } } } });
  if (!lab || lab.deletedAt || lab.category.bookingMode !== "ROOM") throw new HttpError(404, "Room not found");

  const tree = await subtreeRows(prisma, labItemId);
  const [rows, viewer] = await Promise.all([
    prisma.reservation.findMany({
      where: {
        state: { in: ["REQUESTED", "HELD", "CONFIRMED"] },
        startsAt: { lt: civilToInstant(addDays(to, 1), "00:00") },
        endsAt: { gt: civilToInstant(from, "00:00") },
        resources: { some: { itemId: { in: tree.map((r) => r.id) } } },
      },
      include: RESERVATION_INCLUDE,
      orderBy: { startsAt: "asc" },
    }),
    viewerOf(userId),
  ]);
  return rows.map((r) => toReservationDto(r, viewer));
}

/** "mine": staff bookings I asked for. "inbox": requests waiting on rooms I decide for. */
export async function listBookings(userId: string, box: "mine" | "inbox"): Promise<ReservationDto[]> {
  await assertMayBook(userId);
  const viewer = await viewerOf(userId);
  const rows =
    box === "mine"
      ? await prisma.reservation.findMany({ where: { requestedById: userId, source: "STAFF" }, include: RESERVATION_INCLUDE, orderBy: { startsAt: "desc" }, take: 100 })
      : await prisma.reservation.findMany({
          where: { state: "REQUESTED", ...(viewer.sysAdmin ? {} : { labItemId: { in: [...viewer.custody] } }) },
          include: RESERVATION_INCLUDE,
          orderBy: { startsAt: "asc" },
          take: 200,
        });
  return rows.map((r) => toReservationDto(r, viewer));
}

/** University-wide search of what can be booked — like transfer destinations, a
 *  "find the thing you have in mind" search (≥ 2 characters, 25 results), never a dump. */
export async function searchBookables(userId: string, q: string): Promise<BookableDto[]> {
  await assertMayBook(userId);
  const query = q.trim();
  if (query.length < 2) throw new HttpError(400, "Type at least 2 characters to search.");
  const matches = await prisma.item.findMany({
    where: { deletedAt: null, status: "WORKING", name: { contains: query, mode: "insensitive" }, category: { bookingMode: { in: ["ROOM", "EQUIPMENT"] } } },
    include: { category: { select: { name: true, bookingMode: true } }, custodian: { select: { name: true } }, currentOrg: { select: { name: true } } },
    orderBy: { name: "asc" },
    take: 25,
  });
  const lineage = await lineageRows(prisma, matches.map((m) => m.id));
  const out: BookableDto[] = [];
  for (const m of matches) {
    const room = roomOf(lineage, m.id);
    if (!room) continue; // a machine outside any bookable room has nowhere to be booked through
    const path: string[] = [];
    let parentId = m.parentId;
    while (parentId) {
      const parent = lineage.get(parentId);
      if (!parent) break;
      path.unshift(parent.name);
      parentId = parent.parentId;
    }
    out.push({
      id: m.id,
      name: m.name,
      bookingMode: m.category.bookingMode,
      categoryName: m.category.name,
      labItemId: room.id,
      labName: room.name,
      orgNodeName: m.currentOrg.name,
      custodianName: m.custodian.name,
      path,
    });
  }
  return out;
}

async function labDto(lab: { id: string; name: string; currentOrg: { name: string }; custodian: { name: string } }): Promise<SchedulingLabDto> {
  const [tree, pendingCount] = await Promise.all([subtreeRows(prisma, lab.id), prisma.reservation.count({ where: { labItemId: lab.id, state: "REQUESTED" } })]);
  return {
    id: lab.id,
    name: lab.name,
    orgNodeName: lab.currentOrg.name,
    custodianName: lab.custodian.name,
    pendingCount,
    equipment: tree.filter((r) => r.bookingMode === "EQUIPMENT" && r.status === "WORKING").map((r) => ({ id: r.id, name: r.name, categoryName: r.categoryName })),
  };
}

const LAB_INCLUDE = { currentOrg: { select: { name: true } }, custodian: { select: { name: true } } } as const;

/** Rooms whose calendar this person keeps — every room they hold custody of. */
export async function myLabs(userId: string): Promise<SchedulingLabDto[]> {
  await assertMayBook(userId);
  const viewer = await viewerOf(userId);
  const rooms = await prisma.item.findMany({
    where: { deletedAt: null, category: { bookingMode: "ROOM" }, ...(viewer.sysAdmin ? {} : { id: { in: [...viewer.custody] } }) },
    include: LAB_INCLUDE,
    orderBy: { name: "asc" },
    take: 200,
  });
  return Promise.all(rooms.map(labDto));
}

export async function getLab(userId: string, labItemId: string): Promise<SchedulingLabDto> {
  await assertMayBook(userId);
  const lab = await prisma.item.findUnique({ where: { id: labItemId }, include: { ...LAB_INCLUDE, category: { select: { bookingMode: true } } } });
  if (!lab || lab.deletedAt || lab.category.bookingMode !== "ROOM") throw new HttpError(404, "Room not found");
  return labDto(lab);
}
