import "server-only";
import { Prisma, type ReservationSource, type ReservationState } from "@prisma/client";
import type { ClashDto, ReservationDto, RoleKind } from "@/lib/shared";
import { prisma } from "../prisma";
import { HttpError } from "../http-error";
import * as scope from "../resources/scope";
import type { Clash, ExistingClaim } from "@/lib/domain/availability";
import { DEFAULT_TIME_ZONE, instantToCivil } from "@/lib/domain/civil-time";

/**
 * Shared plumbing for Track 6's scheduling services
 * (~/.claude/plans/understand-where-we-are-crystalline-marshmallow.md): who may book,
 * where a booking belongs (its room and that room's containment root), the per-lab
 * lock every write takes, the hold sweep, loading claims, and the DTO mapping. The
 * rules themselves live in lib/domain/availability.ts and lib/domain/civil-time.ts.
 */

export type Tx = Prisma.TransactionClient;
type Client = Tx | typeof prisma;

export const LIVE_STATES: ReservationState[] = ["REQUESTED", "HELD", "CONFIRMED"];
export const BLOCKING_STATES: ReservationState[] = ["HELD", "CONFIRMED"];

/** Students book through their advisor and outsiders through the public portal — the
 *  booking screens are for staff, custodians, heads and administrators. */
const BOOKING_ROLES: RoleKind[] = ["SYS_ADMIN", "MANAGER", "CUSTODIAN", "STAFF"];

export async function assertMayBook(userId: string): Promise<void> {
  const roles = await scope.rolesOf(userId);
  if (!roles.some((r) => BOOKING_ROLES.includes(r))) throw new HttpError(403, "Bookings are made by staff — ask your advisor to book for you.");
}

export interface TreeRow {
  id: string;
  parentId: string | null;
  name: string;
  categoryName: string;
  bookingMode: "NOT_BOOKABLE" | "ROOM" | "EQUIPMENT";
  status: string;
  custodianId: string;
  currentOrgNodeId: string;
  deletedAt: Date | null;
}

/** The given items plus every ancestor, with what scheduling needs of each. */
export async function lineageRows(client: Client, itemIds: string[]): Promise<Map<string, TreeRow>> {
  if (!itemIds.length) return new Map();
  const rows = await client.$queryRaw<TreeRow[]>`
    WITH RECURSIVE up AS (
      SELECT i.id, i."parentId" FROM "Item" i WHERE i.id IN (${Prisma.join(itemIds)})
      UNION
      SELECT p.id, p."parentId" FROM "Item" p INNER JOIN up ON p.id = up."parentId"
    )
    SELECT i.id, i."parentId", i.name, c.name AS "categoryName", c."bookingMode"::text AS "bookingMode",
           i.status::text AS status, i."custodianId", i."currentOrgNodeId", i."deletedAt"
    FROM up
    INNER JOIN "Item" i ON i.id = up.id
    INNER JOIN "ResourceCategory" c ON c.id = i."categoryId"
  `;
  return new Map(rows.map((r) => [r.id, r]));
}

/** An item and everything beneath it (undeleted). */
export async function subtreeRows(client: Client, rootId: string): Promise<TreeRow[]> {
  return client.$queryRaw<TreeRow[]>`
    WITH RECURSIVE down AS (
      SELECT i.id FROM "Item" i WHERE i.id = ${rootId} AND i."deletedAt" IS NULL
      UNION
      SELECT c.id FROM "Item" c INNER JOIN down ON c."parentId" = down.id WHERE c."deletedAt" IS NULL
    )
    SELECT i.id, i."parentId", i.name, c.name AS "categoryName", c."bookingMode"::text AS "bookingMode",
           i.status::text AS status, i."custodianId", i."currentOrgNodeId", i."deletedAt"
    FROM down
    INNER JOIN "Item" i ON i.id = down.id
    INNER JOIN "ResourceCategory" c ON c.id = i."categoryId"
  `;
}

export function rootOf(rows: Map<string, TreeRow>, itemId: string): string {
  let current = rows.get(itemId);
  const seen = new Set<string>();
  while (current?.parentId && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = rows.get(current.parentId);
    if (!parent) break;
    current = parent;
  }
  return current?.id ?? itemId;
}

/** The nearest ROOM at or above an item — the room a booking of it goes through. */
export function roomOf(rows: Map<string, TreeRow>, itemId: string): TreeRow | null {
  let current = rows.get(itemId);
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    if (current.bookingMode === "ROOM") return current;
    seen.add(current.id);
    current = current.parentId ? rows.get(current.parentId) : undefined;
  }
  return null;
}

export interface BookingTarget {
  rootId: string;
  lab: TreeRow;
  items: TreeRow[];
}

/** Validates that every item may be booked at all, and that they belong to one room. */
export async function resolveBookingTarget(client: Client, rawItemIds: string[]): Promise<BookingTarget> {
  const itemIds = [...new Set(rawItemIds)];
  const rows = await lineageRows(client, itemIds);
  const items: TreeRow[] = [];
  for (const id of itemIds) {
    const row = rows.get(id);
    if (!row || row.deletedAt) throw new HttpError(400, "One or more of these resources no longer exist.");
    if (row.bookingMode === "NOT_BOOKABLE") throw new HttpError(400, `"${row.name}" is not bookable.`);
    if (row.status !== "WORKING") throw new HttpError(400, `"${row.name}" is not working right now, so it cannot be booked.`);
    items.push(row);
  }
  const labs = new Set(items.map((i) => roomOf(rows, i.id)?.id ?? null));
  if (labs.has(null)) throw new HttpError(400, "Equipment can only be booked through the room it sits in, and this one is not inside a bookable room.");
  if (labs.size > 1) throw new HttpError(400, "Book one room at a time — these resources sit in different rooms.");
  const lab = roomOf(rows, items[0].id)!;
  return { rootId: rootOf(rows, lab.id), lab, items };
}

/** Serialises every scheduling write within one containment tree. The exclusion
 *  constraint already makes a same-item double booking impossible; this is what makes
 *  a room-vs-machine clash safe under concurrency too. Released at commit/rollback. */
export async function lockTree(tx: Tx, rootId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${rootId}))`;
}

/** A HELD reservation whose hold has lapsed stops blocking. Swept inside every write's
 *  own lock (so correctness never waits on a cron), and globally by the cron route. */
export async function expireHolds(client: Client, itemIds?: string[]): Promise<number> {
  const expired = await client.reservation.findMany({
    where: {
      state: "HELD",
      holdExpiresAt: { lt: new Date() },
      ...(itemIds ? { resources: { some: { itemId: { in: itemIds } } } } : {}),
    },
    select: { id: true },
  });
  if (!expired.length) return 0;
  const ids = expired.map((r) => r.id);
  await client.reservation.updateMany({ where: { id: { in: ids } }, data: { state: "EXPIRED" } });
  await client.reservationResource.updateMany({ where: { reservationId: { in: ids } }, data: { blocking: false } });
  return ids.length;
}

/**
 * F-050 of the 2026-09-15 campaign — a REQUESTED booking nobody decided in time
 * (the custodian never responded before the slot itself passed) used to sit in
 * the inbox forever, decidable only as a decline; there was no way for it to
 * simply lapse. Swept by the cron route only (unlike `expireHolds`, this isn't
 * on the hot path of an ordinary write — nothing here BLOCKS a future booking
 * the way a live HELD hold does, so correctness doesn't need it inline); the
 * inbox query itself also filters to future bookings directly, so this sweep is
 * belt-and-braces rather than the only thing keeping it accurate.
 */
export async function expireLapsedRequests(client: Client): Promise<number> {
  const lapsed = await client.reservation.findMany({
    where: { state: "REQUESTED", startsAt: { lt: new Date() } },
    select: { id: true },
  });
  if (!lapsed.length) return 0;
  const ids = lapsed.map((r) => r.id);
  await client.reservation.updateMany({ where: { id: { in: ids } }, data: { state: "EXPIRED" } });
  await client.reservationResource.updateMany({ where: { reservationId: { in: ids } }, data: { blocking: false } });
  return ids.length;
}

export interface ClaimMeta {
  title: string;
  source: ReservationSource;
  state: ReservationState;
  seriesId: string | null;
}

/** Live claims on any of `itemIds` overlapping [from, to). */
export async function loadClaims(client: Client, itemIds: string[], from: Date, to: Date): Promise<{ claims: ExistingClaim[]; meta: Map<string, ClaimMeta> }> {
  const rows = await client.reservationResource.findMany({
    where: { itemId: { in: itemIds }, startsAt: { lt: to }, endsAt: { gt: from }, reservation: { state: { in: LIVE_STATES } } },
    include: { reservation: { select: { id: true, title: true, state: true, source: true, seriesId: true } } },
  });
  const meta = new Map<string, ClaimMeta>();
  const claims = rows.map((r) => {
    meta.set(r.reservationId, { title: r.reservation.title, source: r.reservation.source, state: r.reservation.state, seriesId: r.reservation.seriesId });
    return {
      reservationId: r.reservationId,
      itemId: r.itemId,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      blocking: BLOCKING_STATES.includes(r.reservation.state),
      title: r.reservation.title,
    };
  });
  return { claims, meta };
}

export function toClashDtos(clashes: Clash[], names: Map<string, string>, meta: Map<string, ClaimMeta>, timeZone = DEFAULT_TIME_ZONE): ClashDto[] {
  const seen = new Set<string>();
  const out: ClashDto[] = [];
  for (const c of clashes) {
    const key = `${c.reservationId}::${c.itemId}::${c.claimedItemId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const m = meta.get(c.reservationId);
    const start = instantToCivil(c.startsAt, timeZone);
    out.push({
      reservationId: c.reservationId,
      title: c.title,
      source: m?.source ?? "STAFF",
      state: m?.state ?? "CONFIRMED",
      itemName: names.get(c.itemId) ?? c.itemId,
      claimedItemName: names.get(c.claimedItemId) ?? c.claimedItemId,
      date: start.date,
      start: start.time,
      end: instantToCivil(c.endsAt, timeZone).time,
      blocking: c.blocking,
    });
  }
  return out;
}

/** Postgres 23P01 — the exclusion constraint caught a race the lock should already have
 *  prevented. Surfaced as a clean 409, never a 500. */
export function isOverlapViolation(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err);
  return text.includes("ReservationResource_no_overlap") || text.includes("23P01");
}

export function overlapConflict(): HttpError {
  return new HttpError(409, "Someone booked this slot a moment ago — refresh the calendar and pick another time.");
}

export const RESERVATION_INCLUDE = {
  lab: { select: { name: true } },
  requestedBy: { select: { name: true } },
  decidedBy: { select: { name: true } },
  resources: { include: { item: { select: { name: true, category: { select: { name: true } } } } } },
} satisfies Prisma.ReservationInclude;

export type ReservationRow = Prisma.ReservationGetPayload<{ include: typeof RESERVATION_INCLUDE }>;

export interface Viewer {
  userId: string;
  sysAdmin: boolean;
  custody: Set<string>;
}

export async function viewerOf(userId: string): Promise<Viewer> {
  const [sysAdmin, custody] = await Promise.all([scope.isSysAdmin(userId), scope.custodyItemIdsOf(userId)]);
  return { userId, sysAdmin, custody: new Set(custody) };
}

/** Who answers for a room's calendar: its custodian (custody resolves through
 *  containment, as everywhere else) or SYS_ADMIN. */
export function decidesFor(viewer: Viewer, labItemId: string): boolean {
  return viewer.sysAdmin || viewer.custody.has(labItemId);
}

export function toReservationDto(row: ReservationRow, viewer: Viewer, timeZone = DEFAULT_TIME_ZONE): ReservationDto {
  const start = instantToCivil(row.startsAt, timeZone);
  const live = LIVE_STATES.includes(row.state);
  const decides = decidesFor(viewer, row.labItemId);
  return {
    id: row.id,
    source: row.source,
    state: row.state,
    title: row.title,
    labItemId: row.labItemId,
    labName: row.lab.name,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    date: row.occursOnLocal ? row.occursOnLocal.toISOString().slice(0, 10) : start.date,
    start: start.time,
    end: instantToCivil(row.endsAt, timeZone).time,
    seriesId: row.seriesId,
    requestedById: row.requestedById,
    requestedByName: row.requestedBy?.name ?? null,
    onBehalfOfNote: row.onBehalfOfNote,
    participantCount: row.participantCount,
    holdExpiresAt: row.holdExpiresAt?.toISOString() ?? null,
    decidedByName: row.decidedBy?.name ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    note: row.note,
    resources: row.resources.map((r) => ({ itemId: r.itemId, name: r.item.name, categoryName: r.item.category.name })),
    canDecide: row.state === "REQUESTED" && decides,
    canCancel: live && row.endsAt > new Date() && (decides || (row.requestedById === viewer.userId && row.source === "STAFF")),
  };
}

/** A civil date string → the Date Prisma stores in a @db.Date column. */
export function dateColumn(civilDate: string): Date {
  return new Date(`${civilDate}T00:00:00.000Z`);
}

export function civilDateOf(column: Date): string {
  return column.toISOString().slice(0, 10);
}
