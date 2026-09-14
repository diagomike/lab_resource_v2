import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addDays, instantToCivil } from "@/lib/domain/civil-time";

/** DB-backed — the whole outside-request workflow against real Postgres: intake with a
 *  real PDF check and throttle, AVP forwarding, custodian holds that genuinely block the
 *  calendar, head decisions, the quote, declines releasing holds, and quote expiry. Mail
 *  is mocked (nothing leaves the machine); the letter goes through the local storage
 *  driver and is removed afterwards. Every node/category/item is created fresh. */
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

const sent: Array<{ to: string; subject: string }> = [];
vi.mock("../mail/mail", () => ({ send: async (m: { to: string; subject: string }) => void sent.push({ to: m.to, subject: m.subject }) }));

type RequestsModule = typeof import("./requests");
type ReservationsModule = typeof import("../scheduling/reservations");
type PrismaModule = typeof import("../prisma");
type StorageModule = typeof import("../resources/storage");

let requests: RequestsModule;
let reservations: ReservationsModule;
let prisma: PrismaModule["prisma"];
let storage: StorageModule["storage"];

const testKey = `__test-external-${Date.now()}`;
const HOOK_TIMEOUT = 60_000;
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");

let avpId: string;
let headAId: string;
let headBId: string;
let custodianId: string;
let staffId: string;
let nodeA: string;
let nodeB: string;
let groupId: string;
let roomCategoryId: string;
let labId: string;
const createdUsers: string[] = [];
const createdRequests: string[] = [];
let testUniversityNode: string;

function dayAhead(n: number) {
  return addDays(instantToCivil(new Date()).date, n);
}

async function makeUser(suffix: string, roles: string[]) {
  const email = `${testKey}-${suffix}@astu.edu.et`;
  const u = await prisma.user.create({ data: { email, emailLower: email, name: `Test ${suffix}`, status: "ACTIVE", roles: { create: roles.map((kind) => ({ kind: kind as never })) } } });
  createdUsers.push(u.id);
  return u.id;
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    organizationName: "Test Institute of Data",
    contactName: "Ms. Requester",
    contactEmail: `${testKey}-${Math.random().toString(36).slice(2, 8)}@example.org`,
    contactPhone: "+251911000000",
    purpose: "A three-day data science workshop for 40 people.",
    windows: [{ date: dayAhead(30), start: "09:00", end: "12:00" }],
    lines: [{ description: "Workstations with internet", quantity: 40 }],
    ...overrides,
  };
}

async function submit(overrides: Record<string, unknown> = {}, ipHash: string | null = null) {
  const result = await requests.submitRequest(input(overrides) as never, { bytes: PDF, fileName: "letter.pdf" }, ipHash);
  const row = await prisma.externalRequest.findUniqueOrThrow({ where: { reference: result.reference } });
  createdRequests.push(row.id);
  return { ...result, id: row.id };
}

beforeAll(async () => {
  requests = await import("./requests");
  reservations = await import("../scheduling/reservations");
  ({ prisma } = await import("../prisma"));
  ({ storage } = await import("../resources/storage"));

  avpId = await makeUser("avp", ["MANAGER", "STAFF"]);
  headAId = await makeUser("head-a", ["MANAGER", "STAFF"]);
  headBId = await makeUser("head-b", ["MANAGER", "STAFF"]);
  custodianId = await makeUser("custodian", ["CUSTODIAN", "STAFF"]);
  staffId = await makeUser("staff", ["STAFF"]);

  // The AVP is "an occupant of an active UNIVERSITY node". A second, orphan one for the
  // test AVP is enough — the real root is never touched, so concurrently running spec
  // files that read the seeded chart are unaffected.
  testUniversityNode = (await prisma.orgNode.create({ data: { name: `${testKey}-uni`, level: 0, kind: "UNIVERSITY", active: true, userId: avpId } })).id;

  nodeA = (await prisma.orgNode.create({ data: { name: `${testKey}-dept-a`, level: 9, kind: "DEPARTMENT", active: true, userId: headAId } })).id;
  nodeB = (await prisma.orgNode.create({ data: { name: `${testKey}-dept-b`, level: 9, kind: "DEPARTMENT", active: true, userId: headBId } })).id;
  groupId = (await prisma.categoryGroup.create({ data: { name: testKey, sortOrder: 999 } })).id;
  roomCategoryId = (await prisma.resourceCategory.create({ data: { key: `${testKey}-room`, name: "Ext Room", iconKey: "Package", groupId, countingMode: "SERIALIZED", canBeRoot: true, bookingMode: "ROOM", publicListed: true } })).id;
  labId = (await prisma.item.create({ data: { name: "Ext Lab", categoryId: roomCategoryId, countingMode: "SERIALIZED", status: "WORKING", ownerOrgNodeId: nodeA, currentOrgNodeId: nodeA, custodianId } })).id;
}, HOOK_TIMEOUT);

afterAll(async () => {
  const rows = await prisma.externalRequest.findMany({ where: { id: { in: createdRequests } }, select: { letterStorageKey: true } });
  for (const r of rows) await storage.remove(r.letterStorageKey).catch(() => undefined);
  await prisma.reservation.deleteMany({ where: { labItemId: labId } });
  await prisma.externalRequest.deleteMany({ where: { id: { in: createdRequests } } });
  await prisma.item.deleteMany({ where: { id: labId } });
  await prisma.resourceCategory.deleteMany({ where: { id: roomCategoryId } });
  await prisma.categoryGroup.deleteMany({ where: { id: groupId } });
  await prisma.orgNode.deleteMany({ where: { id: { in: [nodeA, nodeB, testUniversityNode] } } });
  await prisma.userRole.deleteMany({ where: { userId: { in: createdUsers } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  await prisma.$disconnect();
}, HOOK_TIMEOUT);

describe("public intake", () => {
  it("accepts a real PDF, stores the letter, hashes the token, emails the requester and the AVP", async () => {
    sent.length = 0;
    const r = await submit();
    expect(r.reference).toMatch(/^EXT-\d{4}-\d{3}$/);
    const row = await prisma.externalRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.trackingTokenHash).not.toContain(r.trackingToken);
    expect(await storage.read(row.letterStorageKey)).toEqual(PDF);
    expect(sent.map((m) => m.subject)).toEqual([`Request ${r.reference} received`, `New external request ${r.reference}`]);

    const tracked = await requests.trackByToken(r.trackingToken);
    expect([tracked.status, tracked.windows[0].start, tracked.quote]).toEqual(["SUBMITTED", "09:00", null]);
    await expect(requests.trackByToken("not-a-real-token-at-all-xxxxxxxxxx")).rejects.toMatchObject({ status: 404 });
  });

  it("refuses a non-PDF letter, a honeypot, a date too soon, and too many requests from one address", async () => {
    await expect(requests.submitRequest(input() as never, { bytes: Buffer.from("<svg></svg>"), fileName: "letter.pdf" }, null)).rejects.toMatchObject({ status: 400 });
    await expect(requests.submitRequest(input({ website: "spam" }) as never, { bytes: PDF, fileName: "l.pdf" }, null)).rejects.toMatchObject({ status: 400 });
    await expect(requests.submitRequest(input({ windows: [{ date: dayAhead(0), start: "09:00", end: "10:00" }] }) as never, { bytes: PDF, fileName: "l.pdf" }, null)).rejects.toMatchObject({ status: 400 });

    const email = `${testKey}-throttle@example.org`;
    for (let i = 0; i < 3; i++) await submit({ contactEmail: email });
    await expect(requests.submitRequest(input({ contactEmail: email }) as never, { bytes: PDF, fileName: "l.pdf" }, null)).rejects.toMatchObject({ status: 429 });
  });
});

describe("the staff workflow", () => {
  it("forward → hold (blocks the calendar) → heads decide → quote → the requester sees it", async () => {
    const r = await submit({ windows: [{ date: dayAhead(31), start: "09:00", end: "12:00" }] });

    // Only the AVP forwards; nobody outside the request can even see it.
    await expect(requests.forward(headAId, r.id, { orgNodeIds: [nodeA] })).rejects.toMatchObject({ status: 403 });
    await expect(requests.getForActor(staffId, r.id)).rejects.toMatchObject({ status: 404 });

    sent.length = 0;
    let dto = await requests.forward(avpId, r.id, { orgNodeIds: [nodeA, nodeB], note: "Please check" });
    expect(dto.status).toBe("UNDER_REVIEW");
    expect(dto.assignments.map((a) => a.orgNodeName).sort()).toEqual([`${testKey}-dept-a`, `${testKey}-dept-b`]);

    // The custodian of a room in department A sees it and may hold a slot.
    dto = await requests.getForActor(custodianId, r.id);
    expect(dto.can.placeHold).toBe(true);
    expect(dto.holdRooms.map((x) => x.name)).toEqual(["Ext Lab"]);
    dto = await requests.placeHold(custodianId, r.id, { itemIds: [labId], date: dayAhead(31), start: "09:00", end: "12:00" });
    expect(dto.holds.map((h) => h.state)).toEqual(["HELD"]);

    // The hold really blocks the calendar.
    await expect(reservations.createStaffBooking(custodianId, { itemIds: [labId], date: dayAhead(31), start: "10:00", end: "11:00", title: "Clash" })).rejects.toMatchObject({ status: 409 });

    // A head can't accept without a sheet link; head B declines (no rooms), head A accepts.
    const [aA, aB] = [dto.assignments.find((a) => a.orgNodeId === nodeA)!, dto.assignments.find((a) => a.orgNodeId === nodeB)!];
    await expect(requests.decideAssignment(headBId, aA.id, { decision: "ACCEPT", sheetUrl: "https://docs.google.com/x", amountSantim: 100 })).rejects.toMatchObject({ status: 403 });
    await expect(requests.decideAssignment(headAId, aA.id, { decision: "ACCEPT", amountSantim: 100 })).rejects.toMatchObject({ status: 400 });
    await expect(requests.sendQuote(avpId, r.id, { amountSantim: 100, paymentDeadline: dayAhead(10) })).rejects.toMatchObject({ status: 409 });
    await requests.decideAssignment(headBId, aB.id, { decision: "DECLINE", note: "No capacity" });
    dto = await requests.decideAssignment(headAId, aA.id, { decision: "ACCEPT", sheetUrl: "https://docs.google.com/spreadsheets/d/abc", amountSantim: 1_250_000 });
    expect(dto.can.quote).toBe(false); // a head never quotes
    expect((await requests.getForActor(avpId, r.id)).can.quote).toBe(true);

    sent.length = 0;
    dto = await requests.sendQuote(avpId, r.id, { amountSantim: 1_250_000, paymentDeadline: dayAhead(10), note: "Includes lab assistants" });
    expect(dto.status).toBe("QUOTED");
    expect(new Date(dto.holds[0].holdExpiresAt!).getTime()).toBe(new Date(dto.paymentDeadline!).getTime());
    expect(sent.map((m) => m.subject)).toEqual([`Quote for request ${r.reference}`]);

    // The quote regenerated the tracking token: the old link is dead.
    await expect(requests.trackByToken(r.trackingToken)).rejects.toMatchObject({ status: 404 });
  });

  it("declining releases every hold, and the slot is free again", async () => {
    const r = await submit({ windows: [{ date: dayAhead(32), start: "09:00", end: "12:00" }] });
    await requests.forward(avpId, r.id, { orgNodeIds: [nodeA] });
    await requests.placeHold(custodianId, r.id, { itemIds: [labId], date: dayAhead(32), start: "09:00", end: "12:00" });
    const dto = await requests.closeRequest(avpId, r.id, { note: "Dates unavailable" });
    expect(dto.status).toBe("DECLINED");
    expect(dto.holds.map((h) => h.state)).toEqual(["CANCELLED"]);
    await expect(reservations.createStaffBooking(custodianId, { itemIds: [labId], date: dayAhead(32), start: "10:00", end: "11:00", title: "Now free" })).resolves.toMatchObject({ state: "CONFIRMED" });
  });

  it("only a room of an assigned (not declined) department can hold, and only by its custodian", async () => {
    const r = await submit({ windows: [{ date: dayAhead(33), start: "09:00", end: "12:00" }] });
    await requests.forward(avpId, r.id, { orgNodeIds: [nodeB] });
    await expect(requests.placeHold(custodianId, r.id, { itemIds: [labId], date: dayAhead(33), start: "09:00", end: "12:00" })).rejects.toMatchObject({ status: 403 });
    await requests.forward(avpId, r.id, { orgNodeIds: [nodeA] });
    await expect(requests.placeHold(staffId, r.id, { itemIds: [labId], date: dayAhead(33), start: "09:00", end: "12:00" })).rejects.toMatchObject({ status: 403 });
  });

  it("a quote past its payment deadline expires and releases its holds; the requester may cancel before paying", async () => {
    const r = await submit({ windows: [{ date: dayAhead(34), start: "09:00", end: "12:00" }] });
    await requests.forward(avpId, r.id, { orgNodeIds: [nodeA] });
    await requests.placeHold(custodianId, r.id, { itemIds: [labId], date: dayAhead(34), start: "09:00", end: "12:00" });
    const assignment = await prisma.externalRequestAssignment.findFirstOrThrow({ where: { requestId: r.id } });
    await requests.decideAssignment(headAId, assignment.id, { decision: "ACCEPT", sheetUrl: "https://docs.google.com/s", amountSantim: 500 });
    await requests.sendQuote(avpId, r.id, { amountSantim: 500, paymentDeadline: dayAhead(5) });
    await prisma.externalRequest.update({ where: { id: r.id }, data: { paymentDeadline: new Date(Date.now() - 60_000) } });

    expect(await requests.expireOverdueQuotes()).toBeGreaterThanOrEqual(1);
    const row = await prisma.externalRequest.findUniqueOrThrow({ where: { id: r.id }, include: { reservations: true } });
    expect([row.status, row.reservations.map((h) => h.state)]).toEqual(["EXPIRED", ["EXPIRED"]]);

    const other = await submit();
    const cancelled = await requests.cancelByToken(other.trackingToken);
    expect([cancelled.status, cancelled.canCancel]).toEqual(["CANCELLED", false]);
  });
});
