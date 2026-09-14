import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, instantToCivil, weekdayOf } from "@/lib/domain/civil-time";

/** DB-backed — the exclusion constraint, the per-lab lock, hold expiry and series
 *  generation are Postgres behaviour, not provable as pure logic (that half lives in
 *  lib/domain/availability.spec.ts and civil-time.spec.ts). Every org node, category and
 *  item here is created fresh and removed afterwards, never the shared seed data. */
function loadDotEnv(): void {
  if (process.env.DATABASE_URL) return;
  const content = fs.readFileSync(path.resolve(process.cwd(), ".env"), "utf8");
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}
loadDotEnv();

type ReservationsModule = typeof import("./reservations");
type SeriesModule = typeof import("./series");
type PrismaModule = typeof import("../prisma");

let reservations: ReservationsModule;
let series: SeriesModule;
let prisma: PrismaModule["prisma"];

const testKey = `__test-scheduling-${Date.now()}`;
const HOOK_TIMEOUT = 60_000;

let nodeId: string;
let groupId: string;
const categoryIds: Record<"room" | "machine" | "desk", string> = { room: "", machine: "", desk: "" };
let custodianId: string;
let staffId: string;
let otherStaffId: string;
let studentId: string;
let labId: string;
let pc1: string;
let pc2: string;
let deskId: string;
const createdUserIds: string[] = [];

/** A civil date `n` days ahead, in the venue's zone — every test books in the future. */
function dayAhead(n: number): string {
  return addDays(instantToCivil(new Date()).date, n);
}

async function makeUser(suffix: string, roles: string[]) {
  const email = `${testKey}-${suffix}@astu.edu.et`;
  const user = await prisma.user.create({ data: { email, emailLower: email, name: `Test ${suffix}`, status: "ACTIVE", roles: { create: roles.map((kind) => ({ kind: kind as never })) } } });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeItem(name: string, categoryId: string, parentId: string | null, custodian: string) {
  const item = await prisma.item.create({ data: { name, categoryId, parentId, countingMode: "SERIALIZED", status: "WORKING", ownerOrgNodeId: nodeId, currentOrgNodeId: nodeId, custodianId: custodian } });
  return item.id;
}

beforeAll(async () => {
  reservations = await import("./reservations");
  series = await import("./series");
  ({ prisma } = await import("../prisma"));

  custodianId = await makeUser("custodian", ["CUSTODIAN", "STAFF"]);
  staffId = await makeUser("staff", ["STAFF"]);
  otherStaffId = await makeUser("staff2", ["STAFF"]);
  studentId = await makeUser("student", ["STUDENT"]);

  nodeId = (await prisma.orgNode.create({ data: { name: `${testKey}-dept`, level: 9, kind: "DEPARTMENT", active: true } })).id;
  groupId = (await prisma.categoryGroup.create({ data: { name: testKey, sortOrder: 999 } })).id;
  for (const [key, bookingMode] of [["room", "ROOM"], ["machine", "EQUIPMENT"], ["desk", "NOT_BOOKABLE"]] as const) {
    const c = await prisma.resourceCategory.create({ data: { key: `${testKey}-${key}`, name: `Sched ${key}`, iconKey: "Package", groupId, countingMode: "SERIALIZED", canBeRoot: true, bookingMode } });
    categoryIds[key] = c.id;
  }
  labId = await makeItem("Sched Lab", categoryIds.room, null, custodianId);
  pc1 = await makeItem("Sched PC 1", categoryIds.machine, labId, custodianId);
  pc2 = await makeItem("Sched PC 2", categoryIds.machine, labId, custodianId);
  deskId = await makeItem("Sched Desk", categoryIds.desk, labId, custodianId);
}, HOOK_TIMEOUT);

afterAll(async () => {
  const itemIds = [pc1, pc2, deskId, labId].filter(Boolean);
  await prisma.reservation.deleteMany({ where: { labItemId: { in: itemIds } } });
  await prisma.scheduleSeries.deleteMany({ where: { labItemId: { in: itemIds } } });
  await prisma.item.deleteMany({ where: { id: { in: [pc1, pc2, deskId].filter(Boolean) } } });
  await prisma.item.deleteMany({ where: { id: labId } });
  await prisma.resourceCategory.deleteMany({ where: { id: { in: Object.values(categoryIds).filter(Boolean) } } });
  await prisma.categoryGroup.deleteMany({ where: { id: groupId } });
  await prisma.orgNode.deleteMany({ where: { id: nodeId } });
  await prisma.userRole.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
}, HOOK_TIMEOUT);

function booking(itemIds: string[], date: string, start: string, end: string, title = "Test booking") {
  return { itemIds, date, start, end, title };
}

describe("the exclusion constraint — the database, not a scan", () => {
  it("refuses two overlapping BLOCKING claims on the same item, but not a non-blocking one or a back-to-back one", async () => {
    const startsAt = new Date(Date.UTC(2031, 0, 6, 5));
    const endsAt = new Date(Date.UTC(2031, 0, 6, 7));
    const make = (blocking: boolean, s = startsAt, e = endsAt) =>
      prisma.reservation.create({ data: { source: "MAINTENANCE", state: blocking ? "CONFIRMED" : "REQUESTED", title: "raw", labItemId: labId, startsAt: s, endsAt: e, resources: { create: [{ itemId: pc2, startsAt: s, endsAt: e, blocking }] } } });

    await make(true);
    await expect(make(true, new Date(Date.UTC(2031, 0, 6, 6)), new Date(Date.UTC(2031, 0, 6, 8)))).rejects.toThrow(/no_overlap|23P01|exclusion/i);
    await expect(make(false)).resolves.toBeTruthy();
    await expect(make(true, endsAt, new Date(Date.UTC(2031, 0, 6, 9)))).resolves.toBeTruthy();
    await prisma.reservation.deleteMany({ where: { labItemId: labId, title: "raw" } });
  });

  it("refuses an inverted time range", async () => {
    const s = new Date(Date.UTC(2031, 0, 7, 7));
    await expect(prisma.reservation.create({ data: { source: "MAINTENANCE", state: "CONFIRMED", title: "raw", labItemId: labId, startsAt: s, endsAt: s } })).rejects.toThrow();
  });
});

describe("staff bookings", () => {
  it("a staff member's booking waits for the custodian; the custodian's own confirms immediately", async () => {
    const date = dayAhead(10);
    const asked = await reservations.createStaffBooking(staffId, { ...booking([pc1], date, "08:00", "09:00"), onBehalfOfNote: "Advisees: Abebe, Sara", participantCount: 2 });
    expect([asked.state, asked.labItemId, asked.start, asked.end, asked.date]).toEqual(["REQUESTED", labId, "08:00", "09:00", date]);
    expect(asked.startsAt.endsWith("T05:00:00.000Z")).toBe(true); // 08:00 Addis Ababa, not 08:00 UTC

    const own = await reservations.createStaffBooking(custodianId, booking([pc2], date, "08:00", "09:00"));
    expect(own.state).toBe("CONFIRMED");
  });

  it("booking a room clashes with a confirmed machine inside it, and a machine clashes with a confirmed room; back-to-back is fine", async () => {
    const date = dayAhead(11);
    await reservations.createStaffBooking(custodianId, booking([pc1], date, "10:00", "12:00", "Machine session"));
    await expect(reservations.createStaffBooking(staffId, booking([labId], date, "11:00", "13:00"))).rejects.toMatchObject({ status: 409 });

    await reservations.createStaffBooking(custodianId, booking([labId], date, "14:00", "16:00", "Whole lab"));
    const err = await reservations.createStaffBooking(staffId, booking([pc2], date, "15:00", "15:30")).catch((e) => e);
    expect(err.status).toBe(409);
    expect(err.body.clashes[0]).toMatchObject({ title: "Whole lab", itemName: "Sched PC 2", claimedItemName: "Sched Lab", blocking: true });

    await expect(reservations.createStaffBooking(staffId, booking([pc2], date, "16:00", "17:00"))).resolves.toMatchObject({ state: "REQUESTED" });
    await expect(reservations.createStaffBooking(staffId, booking([pc2], date, "12:00", "13:00"))).resolves.toBeTruthy(); // a sibling machine never clashes
  });

  it("pending requests contend but don't block; approving the second after the first is refused", async () => {
    const date = dayAhead(12);
    const a = await reservations.createStaffBooking(staffId, booking([pc1], date, "09:00", "10:00", "A"));
    const b = await reservations.createStaffBooking(otherStaffId, booking([pc1], date, "09:30", "10:30", "B"));

    const preview = await reservations.previewBooking(otherStaffId, booking([pc1], date, "09:00", "10:00"));
    expect(preview.blocking).toEqual([]);
    expect(preview.contending.map((c) => c.title).sort()).toEqual(["A", "B"]);
    expect(preview.autoConfirm).toBe(false);

    await expect(reservations.decideBooking(staffId, a.id, "APPROVE")).rejects.toMatchObject({ status: 403 });
    await expect(reservations.decideBooking(custodianId, a.id, "APPROVE")).resolves.toMatchObject({ state: "CONFIRMED" });
    await expect(reservations.decideBooking(custodianId, b.id, "APPROVE")).rejects.toMatchObject({ status: 409 });
    await expect(reservations.decideBooking(custodianId, b.id, "DECLINE", "taken")).resolves.toMatchObject({ state: "DECLINED", note: "taken" });

    const inbox = await reservations.listBookings(custodianId, "inbox");
    expect(inbox.some((r) => r.id === a.id || r.id === b.id)).toBe(false);
  });

  it("the requester may cancel their own booking, someone else may not; a cancelled slot is free again", async () => {
    const date = dayAhead(13);
    const mine = await reservations.createStaffBooking(custodianId, booking([pc2], date, "08:00", "10:00"));
    await expect(reservations.cancelBooking(otherStaffId, mine.id)).rejects.toMatchObject({ status: 403 });
    await expect(reservations.cancelBooking(custodianId, mine.id)).resolves.toMatchObject({ state: "CANCELLED" });
    await expect(reservations.createStaffBooking(custodianId, booking([pc2], date, "08:00", "10:00"))).resolves.toMatchObject({ state: "CONFIRMED" });
  });

  it("refuses students, non-bookable items, the past, and an inverted window", async () => {
    const date = dayAhead(14);
    await expect(reservations.createStaffBooking(studentId, booking([pc1], date, "08:00", "09:00"))).rejects.toMatchObject({ status: 403 });
    await expect(reservations.createStaffBooking(staffId, booking([deskId], date, "08:00", "09:00"))).rejects.toMatchObject({ status: 400 });
    await expect(reservations.createStaffBooking(staffId, booking([pc1], dayAhead(-2), "08:00", "09:00"))).rejects.toMatchObject({ status: 400 });
    await expect(reservations.createStaffBooking(staffId, booking([pc1], date, "09:00", "08:00"))).rejects.toMatchObject({ status: 400 });
  });

  it("a lapsed hold stops blocking the moment anyone writes to that lab", async () => {
    const date = dayAhead(15);
    const probe = await reservations.previewBooking(custodianId, booking([pc1], date, "08:00", "09:00"));
    expect(probe.blocking).toEqual([]);
    // 08:00–09:00 in Addis Ababa.
    const s = new Date(`${date}T05:00:00.000Z`);
    const e = new Date(`${date}T06:00:00.000Z`);
    const hold = await prisma.reservation.create({
      data: { source: "EXTERNAL", state: "HELD", title: "Lapsed hold", labItemId: labId, startsAt: s, endsAt: e, holdExpiresAt: new Date(Date.now() - 60_000), resources: { create: [{ itemId: labId, startsAt: s, endsAt: e, blocking: true }] } },
    });
    const booked = await reservations.createStaffBooking(custodianId, booking([pc1], date, "08:00", "09:00"));
    expect(booked.state).toBe("CONFIRMED");
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: hold.id } })).state).toBe("EXPIRED");
  });
});

describe("weekly class series", () => {
  /** A 3-week range starting a week out, on the weekday of its first day. */
  function rule(startOffset: number) {
    const startDate = dayAhead(startOffset);
    return { weekdays: [weekdayOf(startDate)], startTimeLocal: "13:00", endTimeLocal: "15:00", startDate, endDate: addDays(startDate, 20), equipmentItemIds: [] as string[] };
  }

  it("generates one CONFIRMED occurrence per week at the local time, cancels a date as an exception that survives regeneration", async () => {
    const r = rule(21);
    const created = await series.createSeries(custodianId, { ...r, labItemId: labId, title: "SE301 Lab", section: "A", equipmentItemIds: [pc1] });
    expect(created.upcomingCount).toBe(3);
    expect(created.equipment.map((e) => e.name)).toEqual(["Sched PC 1"]);

    const calendar = await reservations.listCalendar(custodianId, labId, r.startDate, r.endDate);
    const occurrences = calendar.filter((c) => c.seriesId === created.id);
    expect(occurrences.map((o) => [o.date, o.start, o.end, o.state])).toEqual([
      [r.startDate, "13:00", "15:00", "CONFIRMED"],
      [addDays(r.startDate, 7), "13:00", "15:00", "CONFIRMED"],
      [addDays(r.startDate, 14), "13:00", "15:00", "CONFIRMED"],
    ]);

    // A machine inside the lab can't be booked during class.
    await expect(reservations.createStaffBooking(staffId, booking([pc2], r.startDate, "14:00", "14:30"))).rejects.toMatchObject({ status: 409 });

    const withException = await series.addException(custodianId, created.id, { date: addDays(r.startDate, 7), reason: "Public holiday" });
    expect(withException.upcomingCount).toBe(2);
    await expect(reservations.createStaffBooking(custodianId, booking([pc2], addDays(r.startDate, 7), "14:00", "14:30"))).resolves.toMatchObject({ state: "CONFIRMED" });

    const moved = await series.updateSeries(custodianId, created.id, { startTimeLocal: "15:00", endTimeLocal: "17:00" });
    expect([moved.generation, moved.upcomingCount, moved.exceptions.map((e) => e.date)]).toEqual([1, 2, [addDays(r.startDate, 7)]]);
    const after = (await reservations.listCalendar(custodianId, labId, r.startDate, r.endDate)).filter((c) => c.seriesId === created.id && c.state === "CONFIRMED");
    expect(after.map((o) => o.start)).toEqual(["15:00", "15:00"]);

    await series.removeSeries(custodianId, created.id);
    const gone = (await reservations.listCalendar(custodianId, labId, r.startDate, r.endDate)).filter((c) => c.seriesId === created.id);
    expect(gone).toEqual([]);
  });

  it("refuses and reports on a clash with an existing confirmed booking, writing nothing", async () => {
    const r = rule(49);
    const blocker = await reservations.createStaffBooking(custodianId, booking([pc2], addDays(r.startDate, 14), "14:00", "14:30", "Calibration"));
    const err = await series.createSeries(custodianId, { labItemId: labId, title: "Clashing class", ...r }).catch((e) => e);
    expect(err.status).toBe(409);
    expect(err.body.clashes).toHaveLength(1);
    expect(err.body.clashes[0]).toMatchObject({ title: "Calibration", date: addDays(r.startDate, 14) });
    expect(await prisma.scheduleSeries.count({ where: { labItemId: labId, title: "Clashing class" } })).toBe(0);
    expect(blocker.state).toBe("CONFIRMED");
  });

  it("only the room's custodian keeps its timetable", async () => {
    await expect(series.createSeries(staffId, { labItemId: labId, title: "Not mine", ...rule(35) })).rejects.toMatchObject({ status: 403 });
    await expect(series.createSeries(custodianId, { labItemId: pc1, title: "Not a room", ...rule(35) })).rejects.toMatchObject({ status: 400 });
  });
});
