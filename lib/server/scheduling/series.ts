import "server-only";
import { randomUUID } from "crypto";
import type { ScheduleSeriesDto, SeriesExceptionInput, SeriesInput, UpdateSeriesInput } from "@/lib/shared";
import { prisma } from "../prisma";
import { HttpError } from "../http-error";
import { findClashes, type Clash } from "@/lib/domain/availability";
import { DEFAULT_TIME_ZONE, MAX_HORIZON_DAYS, addDays, expandSeries, instantToCivil, validateSeriesRule, weekdayOf, type Occurrence, type SeriesRule } from "@/lib/domain/civil-time";
import {
  assertMayBook,
  civilDateOf,
  dateColumn,
  decidesFor,
  expireHolds,
  isOverlapViolation,
  lineageRows,
  loadClaims,
  lockTree,
  overlapConflict,
  rootOf,
  subtreeRows,
  toClashDtos,
  viewerOf,
  type Tx,
} from "./context";

/**
 * Track 6 — a lab's weekly class timetable. A series is a RULE (weekdays, times, its own
 * date range); its occurrences are materialised as CLASS reservations, CONFIRMED and
 * blocking. Regenerating replaces only future occurrences and never touches the past.
 *
 * Generation refuses and reports on any clash — it never evicts a booking that is
 * already confirmed. The custodian cancels the clashing dates (exceptions, which
 * survive every regeneration) or resolves the other booking, then saves again.
 */

const TX = { timeout: 60_000 };

type SeriesRow = NonNullable<Awaited<ReturnType<typeof loadSeries>>>;

async function loadSeries(id: string) {
  return prisma.scheduleSeries.findUnique({
    where: { id },
    include: {
      lab: { select: { name: true } },
      resources: { include: { item: { select: { name: true, category: { select: { name: true } } } } } },
      exceptions: { orderBy: { date: "asc" } },
    },
  });
}

function ruleOf(row: { weekdays: number[]; startTimeLocal: string; endTimeLocal: string; startDate: Date; endDate: Date; timeZone: string }): SeriesRule {
  return {
    weekdays: row.weekdays,
    startTimeLocal: row.startTimeLocal,
    endTimeLocal: row.endTimeLocal,
    startDate: civilDateOf(row.startDate),
    endDate: civilDateOf(row.endDate),
    timeZone: row.timeZone,
  };
}

async function toDto(row: SeriesRow): Promise<ScheduleSeriesDto> {
  const upcomingCount = await prisma.reservation.count({ where: { seriesId: row.id, state: "CONFIRMED", startsAt: { gte: new Date() } } });
  return {
    id: row.id,
    labItemId: row.labItemId,
    labName: row.lab.name,
    title: row.title,
    section: row.section,
    instructorName: row.instructorName,
    participantCount: row.participantCount,
    weekdays: row.weekdays,
    startTimeLocal: row.startTimeLocal,
    endTimeLocal: row.endTimeLocal,
    startDate: civilDateOf(row.startDate),
    endDate: civilDateOf(row.endDate),
    timeZone: row.timeZone,
    active: row.active,
    generation: row.generation,
    equipment: row.resources.map((r) => ({ itemId: r.itemId, name: r.item.name, categoryName: r.item.category.name })),
    exceptions: row.exceptions.map((e) => ({ date: civilDateOf(e.date), reason: e.reason })),
    upcomingCount,
  };
}

/** The room must be a bookable ROOM the actor decides for; every machine must be a
 *  working, bookable machine inside it. Returns the containment root to lock. */
async function assertLabAndEquipment(userId: string, labItemId: string, equipmentItemIds: string[]): Promise<string> {
  await assertMayBook(userId);
  const lineage = await lineageRows(prisma, [labItemId]);
  const lab = lineage.get(labItemId);
  if (!lab || lab.deletedAt || lab.bookingMode !== "ROOM") throw new HttpError(400, "Choose a bookable room.");
  const viewer = await viewerOf(userId);
  if (!decidesFor(viewer, labItemId)) throw new HttpError(403, "Only this room's custodian keeps its timetable.");

  if (equipmentItemIds.length) {
    const inside = new Map((await subtreeRows(prisma, labItemId)).map((r) => [r.id, r]));
    for (const id of equipmentItemIds) {
      const row = inside.get(id);
      if (!row || id === labItemId) throw new HttpError(400, "Every machine in a class slot must sit inside that room.");
      if (row.bookingMode !== "EQUIPMENT") throw new HttpError(400, `"${row.name}" is not bookable equipment.`);
      if (row.status !== "WORKING") throw new HttpError(400, `"${row.name}" is not working right now.`);
    }
  }
  return rootOf(lineage, labItemId);
}

/** Materialises `occurrences` for a series inside an already-locked transaction, after
 *  checking every one against the tree's live claims. Throws 409 with the full clash
 *  list, rolling the whole save back, if any occurrence collides. */
async function insertOccurrences(
  tx: Tx,
  rootId: string,
  series: { id: string; labItemId: string; title: string; participantCount: number | null; timeZone: string; generation: number; createdById: string },
  itemIds: string[],
  occurrences: Occurrence[],
): Promise<void> {
  if (!occurrences.length) return;
  const tree = await subtreeRows(tx, rootId);
  const treeIds = tree.map((r) => r.id);
  await expireHolds(tx, treeIds);
  const first = occurrences[0].startsAt;
  const last = occurrences[occurrences.length - 1].endsAt;
  const { claims, meta } = await loadClaims(tx, treeIds, first, last);
  const parents = new Map(tree.map((r) => [r.id, r.parentId]));
  const own = claims.filter((c) => meta.get(c.reservationId)?.seriesId === series.id).map((c) => c.reservationId);

  const clashes: Clash[] = [];
  for (const occ of occurrences) {
    clashes.push(...findClashes({ itemIds, startsAt: occ.startsAt, endsAt: occ.endsAt }, claims, (id) => parents.get(id) ?? null, own).filter((c) => c.blocking));
  }
  if (clashes.length) {
    const dtos = toClashDtos(clashes, new Map(tree.map((r) => [r.id, r.name])), meta, series.timeZone);
    const dates = new Set(dtos.map((d) => d.date));
    const message = `${dates.size} session date${dates.size === 1 ? "" : "s"} clash with bookings already on this room's calendar. Cancel those dates for this class, or resolve the other bookings, then save again.`;
    throw new HttpError(409, message, { message, clashes: dtos });
  }

  const reservations = occurrences.map((occ) => ({ id: randomUUID(), occ }));
  await tx.reservation.createMany({
    data: reservations.map(({ id, occ }) => ({
      id,
      source: "CLASS" as const,
      state: "CONFIRMED" as const,
      title: series.title,
      labItemId: series.labItemId,
      startsAt: occ.startsAt,
      endsAt: occ.endsAt,
      occursOnLocal: dateColumn(occ.date),
      seriesId: series.id,
      seriesGeneration: series.generation,
      requestedById: series.createdById,
      participantCount: series.participantCount,
    })),
  });
  await tx.reservationResource.createMany({
    data: reservations.flatMap(({ id, occ }) => itemIds.map((itemId) => ({ reservationId: id, itemId, startsAt: occ.startsAt, endsAt: occ.endsAt, blocking: true }))),
  });
}

/** Occurrences from now on — anything already started stays as it was generated. */
function futureOccurrences(rule: SeriesRule, exceptions: string[]): Occurrence[] {
  const now = new Date();
  const today = instantToCivil(now, rule.timeZone).date;
  return expandSeries(rule, exceptions, today).filter((o) => o.startsAt >= now);
}

async function runLocked<T>(rootId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await prisma.$transaction(async (tx) => {
      await lockTree(tx, rootId);
      return fn(tx);
    }, TX);
  } catch (err) {
    if (isOverlapViolation(err)) throw overlapConflict();
    throw err;
  }
}

/** F-052: a class may not start further ahead than a booking may be made. */
function assertWithinHorizon(startDate: string): void {
  if (startDate > addDays(instantToCivil(new Date()).date, MAX_HORIZON_DAYS)) throw new HttpError(400, "A class slot can start at most a year ahead.");
}

export async function createSeries(userId: string, input: SeriesInput): Promise<ScheduleSeriesDto> {
  const equipment = [...new Set(input.equipmentItemIds)];
  const rootId = await assertLabAndEquipment(userId, input.labItemId, equipment);
  const rule: SeriesRule = { weekdays: [...new Set(input.weekdays)].sort(), startTimeLocal: input.startTimeLocal, endTimeLocal: input.endTimeLocal, startDate: input.startDate, endDate: input.endDate, timeZone: DEFAULT_TIME_ZONE };
  const problem = validateSeriesRule(rule);
  if (problem) throw new HttpError(400, problem);
  assertWithinHorizon(rule.startDate);
  const occurrences = futureOccurrences(rule, []);
  if (!occurrences.length) throw new HttpError(400, "No session of this class falls between now and its last date.");

  const id = await runLocked(rootId, async (tx) => {
    const series = await tx.scheduleSeries.create({
      data: {
        labItemId: input.labItemId,
        title: input.title,
        section: input.section || null,
        instructorName: input.instructorName || null,
        participantCount: input.participantCount ?? null,
        weekdays: rule.weekdays,
        startTimeLocal: rule.startTimeLocal,
        endTimeLocal: rule.endTimeLocal,
        startDate: dateColumn(rule.startDate),
        endDate: dateColumn(rule.endDate),
        timeZone: rule.timeZone,
        createdById: userId,
        resources: { create: equipment.map((itemId) => ({ itemId })) },
      },
    });
    await insertOccurrences(tx, rootId, series, [input.labItemId, ...equipment], occurrences);
    return series.id;
  });
  return toDto((await loadSeries(id))!);
}

export async function updateSeries(userId: string, id: string, input: UpdateSeriesInput): Promise<ScheduleSeriesDto> {
  const existing = await loadSeries(id);
  if (!existing) throw new HttpError(404, "Class slot not found");
  if (!existing.active) throw new HttpError(409, "This class slot has been removed.");
  const equipment = input.equipmentItemIds ? [...new Set(input.equipmentItemIds)] : existing.resources.map((r) => r.itemId);
  const rootId = await assertLabAndEquipment(userId, existing.labItemId, equipment);

  const before = ruleOf(existing);
  const rule: SeriesRule = {
    weekdays: input.weekdays ? [...new Set(input.weekdays)].sort() : before.weekdays,
    startTimeLocal: input.startTimeLocal ?? before.startTimeLocal,
    endTimeLocal: input.endTimeLocal ?? before.endTimeLocal,
    startDate: input.startDate ?? before.startDate,
    endDate: input.endDate ?? before.endDate,
    timeZone: existing.timeZone,
  };
  const problem = validateSeriesRule(rule);
  if (problem) throw new HttpError(400, problem);
  assertWithinHorizon(rule.startDate);
  const occurrences = futureOccurrences(rule, existing.exceptions.map((e) => civilDateOf(e.date)));

  await runLocked(rootId, async (tx) => {
    await tx.reservation.deleteMany({ where: { seriesId: id, startsAt: { gte: new Date() } } });
    const series = await tx.scheduleSeries.update({
      where: { id },
      data: {
        title: input.title ?? undefined,
        section: input.section === undefined ? undefined : input.section || null,
        instructorName: input.instructorName === undefined ? undefined : input.instructorName || null,
        participantCount: input.participantCount === undefined ? undefined : input.participantCount,
        weekdays: rule.weekdays,
        startTimeLocal: rule.startTimeLocal,
        endTimeLocal: rule.endTimeLocal,
        startDate: dateColumn(rule.startDate),
        endDate: dateColumn(rule.endDate),
        generation: { increment: 1 },
      },
    });
    if (input.equipmentItemIds) {
      await tx.scheduleSeriesResource.deleteMany({ where: { seriesId: id } });
      if (equipment.length) await tx.scheduleSeriesResource.createMany({ data: equipment.map((itemId) => ({ seriesId: id, itemId })) });
    }
    await insertOccurrences(tx, rootId, series, [existing.labItemId, ...equipment], occurrences);
  });
  return toDto((await loadSeries(id))!);
}

/** Removes a class slot: every future session is withdrawn from the calendar; sessions
 *  already held stay on record. */
export async function removeSeries(userId: string, id: string): Promise<void> {
  const existing = await loadSeries(id);
  if (!existing) throw new HttpError(404, "Class slot not found");
  const rootId = await assertLabAndEquipment(userId, existing.labItemId, []);
  await runLocked(rootId, async (tx) => {
    await tx.reservation.deleteMany({ where: { seriesId: id, startsAt: { gte: new Date() } } });
    await tx.scheduleSeries.update({ where: { id }, data: { active: false } });
  });
}

/** Cancels one date of a class — recorded as an exception so every later regeneration
 *  skips it too. */
export async function addException(userId: string, id: string, input: SeriesExceptionInput): Promise<ScheduleSeriesDto> {
  const existing = await loadSeries(id);
  if (!existing) throw new HttpError(404, "Class slot not found");
  await assertLabAndEquipment(userId, existing.labItemId, []);
  // F-052: an exception cancels ONE session of this class — so it must name a date the class
  // actually meets, and one still ahead. (A past date used to flip an already-held session
  // to CANCELLED after the fact; an off-week date recorded a no-op that later regenerations
  // would still carry around.)
  const rule = ruleOf(existing);
  if (input.date < rule.startDate || input.date > rule.endDate) throw new HttpError(400, "That date is outside this class slot's range.");
  if (!rule.weekdays.includes(weekdayOf(input.date))) throw new HttpError(400, "This class does not meet on that weekday.");
  if (input.date < instantToCivil(new Date(), rule.timeZone).date) throw new HttpError(400, "That session is already past.");
  const date = dateColumn(input.date);
  await prisma.$transaction(async (tx) => {
    await tx.scheduleSeriesException.upsert({
      where: { seriesId_date: { seriesId: id, date } },
      create: { seriesId: id, date, reason: input.reason || null, createdById: userId },
      update: { reason: input.reason || null },
    });
    const occurrences = await tx.reservation.findMany({ where: { seriesId: id, occursOnLocal: date, state: { in: ["REQUESTED", "HELD", "CONFIRMED"] } }, select: { id: true } });
    const ids = occurrences.map((o) => o.id);
    if (ids.length) {
      await tx.reservation.updateMany({ where: { id: { in: ids } }, data: { state: "CANCELLED", note: input.reason || null, decidedById: userId, decidedAt: new Date() } });
      await tx.reservationResource.updateMany({ where: { reservationId: { in: ids } }, data: { blocking: false } });
    }
  });
  return toDto((await loadSeries(id))!);
}

/** Reinstates a cancelled date, if it is still ahead and the slot is still free. */
export async function removeException(userId: string, id: string, civilDate: string): Promise<ScheduleSeriesDto> {
  const existing = await loadSeries(id);
  if (!existing) throw new HttpError(404, "Class slot not found");
  const equipment = existing.resources.map((r) => r.itemId);
  const rootId = await assertLabAndEquipment(userId, existing.labItemId, []);
  const date = dateColumn(civilDate);
  const rule = ruleOf(existing);

  await runLocked(rootId, async (tx) => {
    await tx.scheduleSeriesException.deleteMany({ where: { seriesId: id, date } });
    if (!existing.active || civilDate < rule.startDate || civilDate > rule.endDate || !rule.weekdays.includes(weekdayOf(civilDate))) return;
    const occurrence = expandSeries({ ...rule, startDate: civilDate, endDate: civilDate }).filter((o) => o.startsAt >= new Date());
    if (!occurrence.length) return;
    await tx.reservation.deleteMany({ where: { seriesId: id, occursOnLocal: date, state: "CANCELLED" } });
    await insertOccurrences(tx, rootId, existing, [existing.labItemId, ...equipment], occurrence);
  });
  return toDto((await loadSeries(id))!);
}

export async function listSeries(userId: string, labItemId: string): Promise<ScheduleSeriesDto[]> {
  await assertMayBook(userId);
  const rows = await prisma.scheduleSeries.findMany({ where: { labItemId, active: true }, select: { id: true }, orderBy: { startTimeLocal: "asc" } });
  const out: ScheduleSeriesDto[] = [];
  for (const r of rows) out.push(await toDto((await loadSeries(r.id))!));
  return out;
}
