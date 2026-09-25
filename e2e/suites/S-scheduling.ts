/** Suite S — scheduling: staff bookings, class timetables by assistants. H23–H25. */
import { get, post, patch, del, check, ev, db, done, uniq, nodeId, S } from "../lib";

const SS = "S";
const book = (a: string, b: Record<string, unknown>) => post(a, "/scheduling/bookings", { title: uniq("E2E booking"), ...b });
const decide = (a: string, id: string, decision: "APPROVE" | "DECLINE", note?: string) => post(a, `/scheduling/bookings/${id}/decide`, { decision, note });
const cancel = (a: string, id: string, note?: string) => post(a, `/scheduling/bookings/${id}/cancel`, { note });

async function descendants(rootId: string): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>`WITH RECURSIVE d AS (SELECT id FROM "Item" WHERE id = ${rootId} UNION SELECT i.id FROM "Item" i JOIN d ON i."parentId" = d.id) SELECT id FROM d`;
  return rows.map((r) => r.id);
}

async function main() {
  const se = await nodeId("Software Engineering");
  const room = await db.item.findFirstOrThrow({ where: { name: "SE Lab X — Software Lab 3" } });
  const inRoom = await descendants(room.id);
  const computers = await db.item.findMany({ where: { id: { in: inRoom }, category: { key: "computer" }, status: "WORKING" }, orderBy: { name: "asc" } });
  const [pcA, pcB] = computers;
  const chair = await db.item.findFirstOrThrow({ where: { id: { in: inRoom }, category: { key: "chair" } } });

  let staffReq = "";
  await check(SS, "S-01", "staff request → REQUESTED; the room's custodian books a machine → CONFIRMED automatically", async () => {
    const r1 = await book("staffSe", { itemIds: [room.id], date: "2026-10-05", start: "10:00", end: "12:00", onBehalfOfNote: "Sara T. (UGR/1234/13)" });
    staffReq = r1.body?.id;
    const r2 = await book("custSe", { itemIds: [pcA.id], date: "2026-10-05", start: "13:00", end: "14:00" });
    return { ok: r1.status === 201 && r1.body.state === "REQUESTED" && r2.status === 201 && r2.body.state === "CONFIRMED", evidence: { staff: [r1.status, r1.body?.state], custodian: [r2.status, r2.body?.state] } };
  });

  await check(SS, "S-02", "refusals: student, non-bookable item, broken machine, past time, end before start", async () => {
    const broken = computers[2];
    await post("custSe", "/resources/items/changes", { kind: "setStatus", itemIds: [broken.id], value: "BROKEN" });
    const r = {
      student: (await book("student", { itemIds: [room.id], date: "2026-10-05", start: "15:00", end: "16:00" })).status,
      nonBookableChair: (await book("staffSe", { itemIds: [chair.id], date: "2026-10-05", start: "15:00", end: "16:00" })).status,
      brokenMachine: (await book("staffSe", { itemIds: [broken.id], date: "2026-10-05", start: "15:00", end: "16:00" })).status,
      past: (await book("staffSe", { itemIds: [room.id], date: "2026-09-01", start: "10:00", end: "11:00" })).status,
      inverted: (await book("staffSe", { itemIds: [room.id], date: "2026-10-05", start: "16:00", end: "15:00" })).status,
      invalidDate: (await book("staffSe", { itemIds: [room.id], date: "2026-02-30", start: "10:00", end: "11:00" })).status,
    };
    await post("custSe", "/resources/items/changes", { kind: "setStatus", itemIds: [broken.id], value: "WORKING" });
    return { ok: r.student === 403 && [r.nonBookableChair, r.brokenMachine, r.past, r.inverted, r.invalidDate].every((s) => s === 400), evidence: r };
  });

  await check(SS, "S-03", "hierarchical clash: room over a confirmed machine booking → 409; sibling machine free; back-to-back OK", async () => {
    const roomOverMachine = await book("custSe", { itemIds: [room.id], date: "2026-10-05", start: "13:30", end: "14:30" });
    const sibling = await book("custSe", { itemIds: [pcB.id], date: "2026-10-05", start: "13:00", end: "14:00" });
    const backToBack = await book("custSe", { itemIds: [pcA.id], date: "2026-10-05", start: "14:00", end: "15:00" });
    return { ok: roomOverMachine.status === 409 && sibling.status === 201 && backToBack.status === 201, evidence: { roomOverMachine: roomOverMachine.status, clashes: roomOverMachine.body?.clashes?.length, siblingMachine: sibling.status, backToBack: backToBack.status } };
  });

  await check(SS, "S-04", "deciding: department head and other custodians refused; the room's custodian approves", async () => {
    const head = await decide("headSe", staffReq, "APPROVE");
    const other = await decide("custChem", staffReq, "APPROVE");
    const ok = await decide("custSe", staffReq, "APPROVE");
    const twice = await decide("custSe", staffReq, "APPROVE");
    return { ok: head.status === 403 && other.status === 403 && ok.body?.state === "CONFIRMED" && twice.status === 409, evidence: { head: head.status, otherCustodian: other.status, custodian: ok.body?.state, again: twice.status } };
  });

  await check(SS, "S-05", "timezone: 08:00 Addis local is stored as 05:00Z and read back as 08:00", async () => {
    const r = await book("custSe", { itemIds: [pcB.id], date: "2026-10-06", start: "08:00", end: "09:00" });
    return { ok: r.body?.startsAt === "2026-10-06T05:00:00.000Z" && r.body?.start === "08:00", evidence: { startsAt: r.body?.startsAt, start: r.body?.start } };
  });

  await check(SS, "S-06", "race: 5 identical confirmed bookings fired together → exactly one 201", async () => {
    const res = await Promise.all([0, 1, 2, 3, 4].map(() => book("custSe", { itemIds: [pcB.id], date: "2026-10-07", start: "10:00", end: "11:00" })));
    const s = res.map((r) => r.status);
    return { ok: s.filter((x) => x === 201).length === 1 && s.filter((x) => x === 409).length === 4, evidence: { statuses: s } };
  });

  let seriesId = "";
  await check(SS, "S-07", "weekly class: custodian creates Mon+Wed 08–10 for 8 weeks; staff and the head are refused", async () => {
    const body = { labItemId: room.id, title: "SE3102 Operating Systems Lab", section: "A", instructorName: "Dr. E2E", weekdays: [1, 3], startTimeLocal: "08:00", endTimeLocal: "10:00", startDate: "2026-10-12", endDate: "2026-12-02" };
    const staff = await post("staffSe", "/scheduling/series", body);
    const head = await post("headSe", "/scheduling/series", body);
    const r = await post("custSe", "/scheduling/series", body);
    seriesId = r.body?.id;
    const n = await db.reservation.count({ where: { seriesId, state: "CONFIRMED" } });
    return { ok: staff.status === 403 && head.status === 403 && r.status === 201 && n === 16, evidence: { staff: staff.status, head: head.status, create: r.status, occurrences: n } };
  });

  await check(SS, "S-08", "a class clashing with a confirmed booking is refused with nothing written", async () => {
    const b = await book("custSe", { itemIds: [pcA.id], date: "2026-12-09", start: "09:00", end: "09:30" });
    const before = await db.scheduleSeries.count();
    const r = await post("custSe", "/scheduling/series", { labItemId: room.id, title: "Clashing class", weekdays: [3], startTimeLocal: "08:00", endTimeLocal: "10:00", startDate: "2026-12-09", endDate: "2026-12-30" });
    const after = await db.scheduleSeries.count();
    return { ok: b.status === 201 && r.status === 409 && before === after, evidence: { blocker: b.status, series: r.status, clashes: r.body?.clashes?.length, seriesRowsAdded: after - before } };
  });

  await check(SS, "S-09", "exception cancels one date; reinstating restores it; update regenerates future sessions only", async () => {
    const ex = await post("custSe", `/scheduling/series/${seriesId}/exceptions`, { date: "2026-10-14", reason: "Midterm" });
    const cancelled = await db.reservation.count({ where: { seriesId, occursOnLocal: new Date("2026-10-14T00:00:00Z"), state: "CANCELLED" } });
    const back = await del("custSe", `/scheduling/series/${seriesId}/exceptions?date=2026-10-14`);
    const live = await db.reservation.count({ where: { seriesId, occursOnLocal: new Date("2026-10-14T00:00:00Z"), state: "CONFIRMED" } });
    const upd = await patch("custSe", `/scheduling/series/${seriesId}`, { startTimeLocal: "07:30", endTimeLocal: "09:30" });
    const first = await db.reservation.findFirst({ where: { seriesId, state: "CONFIRMED" }, orderBy: { startsAt: "asc" } });
    return { ok: ex.status === 200 && cancelled === 1 && back.status === 200 && live === 1 && upd.status === 200 && !!first?.startsAt.toISOString().endsWith("04:30:00.000Z"), evidence: { addException: ex.status, cancelledThatDay: cancelled, reinstate: back.status, liveAgain: live, update: upd.status, firstStartsAt: first?.startsAt } };
  });

  await check(SS, "S-10", "H25 — exceptions accepted for dates outside the series / not on its weekdays / in the past", async () => {
    const r = {
      outsideRange: (await post("custSe", `/scheduling/series/${seriesId}/exceptions`, { date: "2027-06-01" })).status,
      wrongWeekday: (await post("custSe", `/scheduling/series/${seriesId}/exceptions`, { date: "2026-10-13" })).status,
      past: (await post("custSe", `/scheduling/series/${seriesId}/exceptions`, { date: "2026-01-05" })).status,
    };
    return { ok: Object.values(r).every((s) => s === 400), evidence: r, hypothesis: "H25" };
  });

  await check(SS, "S-11", "H25 — a 10-year, 7-days-a-week class is accepted in one request (row explosion)", async () => {
    const t = Date.now();
    const r = await post("custSe2", "/scheduling/series", { labItemId: (await db.item.findFirstOrThrow({ where: { name: "Software Laboratory — B509-R7" } })).id, title: "Forever class", weekdays: [1, 2, 3, 4, 5, 6, 7], startTimeLocal: "18:00", endTimeLocal: "19:00", startDate: "2026-10-01", endDate: "2036-09-30" });
    const n = r.body?.id ? await db.reservation.count({ where: { seriesId: r.body.id } }) : 0;
    return { ok: r.status === 400, evidence: { status: r.status, body: r.status >= 400 ? r.body : undefined, rows: n, ms: Date.now() - t }, hypothesis: "H25" };
  });

  await check(SS, "S-12", "H25 — a booking 73 years ahead is accepted", async () => {
    const r = await book("custSe", { itemIds: [pcB.id], date: "2099-01-05", start: "10:00", end: "11:00" });
    return { ok: r.status === 400, evidence: { status: r.status }, hypothesis: "H25" };
  });

  await check(SS, "S-13", "H23 — past bookings: a finished CONFIRMED booking can still be cancelled via the API; a past REQUESTED one sits in the inbox", async () => {
    const past = await db.reservation.create({ data: { source: "STAFF", state: "CONFIRMED", title: "E2E past lab", labItemId: room.id, startsAt: new Date("2026-09-01T06:00:00Z"), endsAt: new Date("2026-09-01T07:00:00Z"), occursOnLocal: new Date("2026-09-01T00:00:00Z"), requestedById: S.staffSe.id, decidedById: S.custSe.id, resources: { create: [{ itemId: room.id, startsAt: new Date("2026-09-01T06:00:00Z"), endsAt: new Date("2026-09-01T07:00:00Z"), blocking: true }] } } });
    const stale = await db.reservation.create({ data: { source: "STAFF", state: "REQUESTED", title: "E2E never decided", labItemId: room.id, startsAt: new Date("2026-09-02T06:00:00Z"), endsAt: new Date("2026-09-02T07:00:00Z"), occursOnLocal: new Date("2026-09-02T00:00:00Z"), requestedById: S.staffSe.id, resources: { create: [{ itemId: room.id, startsAt: new Date("2026-09-02T06:00:00Z"), endsAt: new Date("2026-09-02T07:00:00Z"), blocking: false }] } } });
    const c = await cancel("staffSe", past.id, "rewriting history");
    const inbox = await get("custSe", "/scheduling/bookings?box=inbox");
    const staleInInbox = (inbox.body ?? []).some((x: any) => x.id === stale.id);
    return { ok: c.status >= 400 && !staleInInbox, evidence: { cancelFinishedBooking: c.status, stateAfter: c.body?.state, pastRequestStillInInbox: staleInInbox }, hypothesis: "H23" };
  });

  await check(SS, "S-14", "H24 — a confirmed booking survives the machine being marked BROKEN; nobody is told", async () => {
    const b = await book("custSe", { itemIds: [pcA.id], date: "2026-10-08", start: "10:00", end: "11:00" });
    await post("custSe", "/resources/items/changes", { kind: "setStatus", itemIds: [pcA.id], value: "BROKEN" });
    const row = await db.reservation.findUniqueOrThrow({ where: { id: b.body.id } });
    await post("custSe", "/resources/items/changes", { kind: "setStatus", itemIds: [pcA.id], value: "WORKING" });
    return { ok: row.state !== "CONFIRMED", evidence: { bookingStateAfterBreak: row.state }, hypothesis: "H24" };
  });

  await check(SS, "S-15", "H24 — switching the Lab category to NOT_BOOKABLE leaves every future booking and class live", async () => {
    const labCat = await db.resourceCategory.findUniqueOrThrow({ where: { key: "lab" } });
    const impact = await post("admin", `/resources/categories/${labCat.id}/impact`, { bookingMode: "NOT_BOOKABLE" });
    const notes = (impact.body?.notes ?? []).map((n: any) => `${n.severity}: ${n.title}`);
    const live = await db.reservation.count({ where: { lab: { categoryId: labCat.id }, state: { in: ["CONFIRMED", "REQUESTED", "HELD"] }, startsAt: { gt: new Date() } } });
    return { ok: live === 0 || notes.some((n: string) => /booking|reservation|class/i.test(n)), evidence: { liveFutureReservationsOnLabs: live, impactNotes: notes } };
  });

  await check(SS, "S-16", "H12 — deleting a room silently deletes its confirmed bookings and class timetable", async () => {
    const labCat = await db.resourceCategory.findUniqueOrThrow({ where: { key: "lab" } });
    const newRoom = (await post("custSe", "/resources/items/changes", { kind: "createItem", parentId: null, categoryId: labCat.id, count: 1, ownerOrgNodeId: se, custodianId: S.custSe.id, name: uniq("E2E Doomed Room") })).body.itemIds[0];
    const b = await book("custSe", { itemIds: [newRoom], date: "2026-10-09", start: "10:00", end: "11:00" });
    const s = await post("custSe", "/scheduling/series", { labItemId: newRoom, title: "Doomed class", weekdays: [2], startTimeLocal: "08:00", endTimeLocal: "09:00", startDate: "2026-10-13", endDate: "2026-11-24" });
    const d = await post("custSe", "/resources/items/changes", { kind: "deleteItem", itemIds: [newRoom] });
    const left = await db.reservation.count({ where: { OR: [{ id: b.body.id }, { seriesId: s.body.id }] } });
    const seriesLeft = await db.scheduleSeries.count({ where: { id: s.body.id } });
    return { ok: d.status >= 400, evidence: { booking: b.status, series: s.status, deleteRoom: d.status, reservationsLeft: left, seriesLeft }, hypothesis: "H12" };
  });

  await check(SS, "S-17", "any STAFF can read any room's calendar university-wide, including 'on behalf of' student notes", async () => {
    const cal = await get("staffChem", `/scheduling/calendar?labItemId=${room.id}&from=2026-10-05&to=2026-10-05`);
    const notes = (cal.body ?? []).map((r: any) => r.onBehalfOfNote).filter(Boolean);
    return { ok: notes.length === 0, evidence: { status: cal.status, visibleNotes: notes } };
  });

  await check(SS, "S-18", "the department head has no way to see pending bookings for their department's rooms", async () => {
    const pending = await book("staffSe", { itemIds: [room.id], date: "2026-10-20", start: "14:00", end: "15:00" });
    const inbox = await get("headSe", "/scheduling/bookings?box=inbox");
    const sees = (inbox.body ?? []).some((x: any) => x.id === pending.body?.id);
    return { ok: sees, evidence: { headInboxStatus: inbox.status, headSeesPendingDeptBooking: sees } };
  });

  await done();
}

main();
