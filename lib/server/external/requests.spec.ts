import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addDays, instantToCivil } from "@/lib/domain/civil-time";

/** DB-backed — the whole outside-request workflow against real Postgres, along the
 *  university's own line (2026-09-28): intake from a signed-in requester account, the AVP
 *  forwarding to a college, the dean to departments, the head asking custodians, holds
 *  that genuinely block the calendar (a room, or a machine for a sample analysis), the
 *  answers going back up (head → dean → AVP, with send-backs and declines), the quote,
 *  and quote expiry. Mail is mocked (nothing leaves the machine); the letter goes through
 *  the local storage driver and is removed afterwards. Every node/category/item is fresh. */
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
let deanId: string;
let headAId: string;
let headBId: string;
let custodianId: string;
let custodian2Id: string;
let staffId: string;
let requesterId: string;
let otherRequesterId: string;
let college: string;
let nodeA: string;
let nodeB: string;
let outsideDept: string;
let groupId: string;
let roomCategoryId: string;
let machineCategoryId: string;
let labId: string;
let lab2Id: string;
let machineId: string;
const createdUsers: string[] = [];
const createdRequests: string[] = [];
const createdNodes: string[] = [];

const dayAhead = (n: number) => addDays(instantToCivil(new Date()).date, n);
const SHEET = "https://docs.google.com/spreadsheets/d/abc";
const CONTACT = { name: "Ato Lab Contact", role: "Lab assistant", phone: "+251911111111" };

async function makeUser(suffix: string, roles: string[], extra: Record<string, unknown> = {}) {
  const email = `${testKey}-${suffix}@astu.edu.et`;
  const u = await prisma.user.create({ data: { email, emailLower: email, name: `Test ${suffix}`, status: "ACTIVE", roles: { create: roles.map((kind) => ({ kind: kind as never })) }, ...extra } });
  createdUsers.push(u.id);
  return u.id;
}

async function makeNode(name: string, kind: "UNIVERSITY" | "COLLEGE" | "DEPARTMENT", level: number, userId: string | null, parentId?: string) {
  const node = await prisma.orgNode.create({ data: { name: `${testKey}-${name}`, level, kind, active: true, userId } });
  createdNodes.push(node.id);
  if (parentId) await prisma.orgEdge.create({ data: { parentId, childId: node.id } });
  return node.id;
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    kind: "FACILITY",
    organizationName: "Test Institute of Data",
    contactName: "Ms. Requester",
    contactEmail: `${testKey}-contact@example.org`,
    contactPhone: "+251911000000",
    purpose: "A three-day data science workshop for 40 people.",
    windows: [{ date: dayAhead(30), start: "09:00", end: "12:00" }],
    lines: [{ description: "Workstations with internet", quantity: 40 }],
    ...overrides,
  };
}

let requesterSeq = 0;
/** Sent by `who`, or by a fresh requester account (each may send 3 a day). */
async function submit(overrides: Record<string, unknown> = {}, who?: string) {
  const by = who ?? (await makeUser(`req-auto-${++requesterSeq}`, ["EXTERNAL"]));
  const result = await requests.submitRequest(by, input(overrides) as never, { bytes: PDF, fileName: "letter.pdf" }, null);
  createdRequests.push(result.id);
  return { ...result, requesterId: by };
}

/** AVP → college → department A, with the head asking one custodian. */
async function downTheLine(id: string, custodians = [custodianId]) {
  await requests.forward(avpId, id, { orgNodeIds: [college] });
  let dto = await requests.getForActor(deanId, id);
  const collegePart = dto.assignments.find((a) => a.level === "COLLEGE")!;
  dto = await requests.forwardToDepartments(deanId, collegePart.id, { orgNodeIds: [nodeA] });
  const deptPart = dto.assignments.find((a) => a.orgNodeId === nodeA)!;
  await requests.assignCustodians(headAId, deptPart.id, { tasks: custodians.map((c) => ({ custodianId: c, want: "One lab with 20 workstations" })) });
  return { collegeId: collegePart.id, deptId: deptPart.id };
}

/** …then hold, report, and answer all the way back up to an approved college. */
async function upTheLine(id: string, parts: { collegeId: string; deptId: string }, date: string, amountSantim = 1_250_000) {
  await requests.placeHold(custodianId, id, { itemIds: [labId], date, start: "09:00", end: "12:00" });
  const task = (await requests.getForActor(custodianId, id)).assignments.find((a) => a.id === parts.deptId)!.tasks.find((t) => t.custodianId === custodianId)!;
  await requests.finishTask(custodianId, task.id, { outcome: "DONE" });
  await requests.submitDepartment(headAId, parts.deptId, { sheetUrl: SHEET, amountSantim, contacts: [CONTACT] });
  await requests.reviewAssignment(deanId, parts.deptId, { decision: "APPROVE" });
  await requests.submitCollege(deanId, parts.collegeId, {});
  return requests.reviewAssignment(avpId, parts.collegeId, { decision: "APPROVE" });
}

beforeAll(async () => {
  requests = await import("./requests");
  reservations = await import("../scheduling/reservations");
  ({ prisma } = await import("../prisma"));
  ({ storage } = await import("../resources/storage"));

  avpId = await makeUser("avp", ["MANAGER", "STAFF"]);
  deanId = await makeUser("dean", ["MANAGER"]);
  headAId = await makeUser("head-a", ["MANAGER", "STAFF"]);
  headBId = await makeUser("head-b", ["MANAGER", "STAFF"]);
  staffId = await makeUser("staff", ["STAFF"]);
  requesterId = await makeUser("requester", ["EXTERNAL"], { organisation: "Test Institute of Data" });
  otherRequesterId = await makeUser("requester-2", ["EXTERNAL"]);

  // The AVP is "an occupant of an active UNIVERSITY node". A second, orphan one for the
  // test AVP is enough — the real root is never touched, so concurrently running spec
  // files that read the seeded chart are unaffected.
  await makeNode("uni", "UNIVERSITY", 0, avpId);
  college = await makeNode("college", "COLLEGE", 1, deanId);
  nodeA = await makeNode("dept-a", "DEPARTMENT", 2, headAId, college);
  nodeB = await makeNode("dept-b", "DEPARTMENT", 2, headBId, college);
  outsideDept = await makeNode("dept-outside", "DEPARTMENT", 2, null);
  custodianId = await makeUser("custodian", ["CUSTODIAN", "STAFF"], { homeNodeId: nodeA });
  custodian2Id = await makeUser("custodian-2", ["CUSTODIAN", "STAFF"], { homeNodeId: nodeA });

  groupId = (await prisma.categoryGroup.create({ data: { name: testKey, sortOrder: 999 } })).id;
  roomCategoryId = (await prisma.resourceCategory.create({ data: { key: `${testKey}-room`, name: "Ext Room", iconKey: "Package", groupId, countingMode: "SERIALIZED", canBeRoot: true, bookingMode: "ROOM", publicListed: true } })).id;
  machineCategoryId = (await prisma.resourceCategory.create({ data: { key: `${testKey}-xrd`, name: "Ext XRD", iconKey: "Package", groupId, countingMode: "SERIALIZED", bookingMode: "EQUIPMENT", publicListed: true } })).id;
  labId = (await prisma.item.create({ data: { name: "Ext Lab", categoryId: roomCategoryId, countingMode: "SERIALIZED", status: "WORKING", ownerOrgNodeId: nodeA, currentOrgNodeId: nodeA, custodianId } })).id;
  lab2Id = (await prisma.item.create({ data: { name: "Ext Lab Two", categoryId: roomCategoryId, countingMode: "SERIALIZED", status: "WORKING", ownerOrgNodeId: nodeA, currentOrgNodeId: nodeA, custodianId: custodian2Id } })).id;
  machineId = (await prisma.item.create({ data: { name: "XRD-1", parentId: labId, categoryId: machineCategoryId, countingMode: "SERIALIZED", status: "WORKING", ownerOrgNodeId: nodeA, currentOrgNodeId: nodeA, custodianId } })).id;
}, HOOK_TIMEOUT);

afterAll(async () => {
  const rows = await prisma.externalRequest.findMany({ where: { id: { in: createdRequests } }, select: { letterStorageKey: true } });
  for (const r of rows) await storage.remove(r.letterStorageKey).catch(() => undefined);
  await prisma.reservation.deleteMany({ where: { labItemId: { in: [labId, lab2Id] } } });
  await prisma.externalRequest.deleteMany({ where: { id: { in: createdRequests } } });
  await prisma.item.deleteMany({ where: { id: machineId } });
  await prisma.item.deleteMany({ where: { id: { in: [labId, lab2Id] } } });
  await prisma.resourceCategory.deleteMany({ where: { id: { in: [roomCategoryId, machineCategoryId] } } });
  await prisma.categoryGroup.deleteMany({ where: { id: groupId } });
  await prisma.orgNode.updateMany({ where: { id: { in: createdNodes } }, data: { userId: null } });
  await prisma.orgNode.deleteMany({ where: { id: { in: createdNodes } } });
  await prisma.userRole.deleteMany({ where: { userId: { in: createdUsers } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  await prisma.$disconnect();
}, HOOK_TIMEOUT);

describe("intake from a requester account", () => {
  it("accepts a real PDF from a signed-in requester, stores the letter, emails them and the AVP", async () => {
    sent.length = 0;
    const r = await submit({}, requesterId);
    expect(r.reference).toMatch(/^EXT-\d{4}-\d{3}$/);
    const row = await prisma.externalRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect([row.requesterId, row.kind, row.trackingTokenHash]).toEqual([requesterId, "FACILITY", null]);
    expect(await storage.read(row.letterStorageKey)).toEqual(PDF);
    expect(sent.map((m) => m.subject)).toContain(`Request ${r.reference} received`);

    const mine = await requests.viewForRequester(requesterId, r.id);
    expect([mine.status, mine.windows[0].start, mine.quote, mine.contacts]).toEqual(["SUBMITTED", "09:00", null, []]);
    expect((await requests.listForRequester(requesterId)).map((x) => x.id)).toContain(r.id);
    // Somebody else's request doesn't exist, as far as another requester can tell.
    await expect(requests.viewForRequester(otherRequesterId, r.id)).rejects.toMatchObject({ status: 404 });
  });

  it("refuses a staff account, a non-PDF letter, a honeypot, a date too soon, a room request with nothing listed, and too many in a day", async () => {
    await expect(requests.submitRequest(staffId, input() as never, { bytes: PDF, fileName: "l.pdf" }, null)).rejects.toMatchObject({ status: 403 });
    await expect(requests.submitRequest(otherRequesterId, input() as never, { bytes: Buffer.from("<svg></svg>"), fileName: "letter.pdf" }, null)).rejects.toMatchObject({ status: 400 });
    await expect(requests.submitRequest(otherRequesterId, input({ website: "spam" }) as never, { bytes: PDF, fileName: "l.pdf" }, null)).rejects.toMatchObject({ status: 400 });
    await expect(requests.submitRequest(otherRequesterId, input({ windows: [{ date: dayAhead(0), start: "09:00", end: "10:00" }] }) as never, { bytes: PDF, fileName: "l.pdf" }, null)).rejects.toMatchObject({ status: 400 });
    await expect(requests.submitRequest(otherRequesterId, input({ lines: [] }) as never, { bytes: PDF, fileName: "l.pdf" }, null)).rejects.toMatchObject({ status: 400 });
    await expect(requests.submitRequest(otherRequesterId, input({ kind: "SAMPLE_ANALYSIS", lines: [] }) as never, { bytes: PDF, fileName: "l.pdf" }, null)).rejects.toMatchObject({ status: 400 });

    const throttled = await makeUser("requester-throttled", ["EXTERNAL"]);
    for (let i = 0; i < 3; i++) await submit({}, throttled);
    await expect(requests.submitRequest(throttled, input() as never, { bytes: PDF, fileName: "l.pdf" }, null)).rejects.toMatchObject({ status: 429 });
  });
});

describe("down the line and back: AVP → dean → head → custodians → head → dean → AVP", () => {
  it("each level acts only in its turn and on its own part, and the quote shows the breakdown and the held rooms", async () => {
    const date = dayAhead(31);
    const r = await submit({ windows: [{ date, start: "09:00", end: "12:00" }] });

    // Only the AVP forwards, and only to colleges; nobody outside the request can see it.
    await expect(requests.forward(deanId, r.id, { orgNodeIds: [college] })).rejects.toMatchObject({ status: 403 });
    await expect(requests.forward(avpId, r.id, { orgNodeIds: [nodeA] })).rejects.toMatchObject({ status: 400 });
    await expect(requests.getForActor(staffId, r.id)).rejects.toMatchObject({ status: 404 });
    sent.length = 0;
    let dto = await requests.forward(avpId, r.id, { orgNodeIds: [college], note: "Please check" });
    expect(dto.status).toBe("UNDER_REVIEW");
    const dean = await prisma.user.findUniqueOrThrow({ where: { id: deanId } });
    expect(sent.filter((m) => m.to === dean.email).map((m) => m.subject)).toEqual([`External request ${r.reference} for ${testKey}-college`]);
    // The head isn't in it yet.
    await expect(requests.getForActor(headAId, r.id)).rejects.toMatchObject({ status: 404 });

    // The dean forwards to their own departments only.
    dto = await requests.getForActor(deanId, r.id);
    expect(dto.role).toBe("DEAN");
    expect(dto.forwardTargets.map((t) => t.id).sort()).toEqual([nodeA, nodeB].sort());
    const collegePart = dto.assignments.find((a) => a.level === "COLLEGE")!;
    await expect(requests.forwardToDepartments(deanId, collegePart.id, { orgNodeIds: [outsideDept] })).rejects.toMatchObject({ status: 400 });
    await expect(requests.forwardToDepartments(headAId, collegePart.id, { orgNodeIds: [nodeA] })).rejects.toMatchObject({ status: 403 });
    dto = await requests.forwardToDepartments(deanId, collegePart.id, { orgNodeIds: [nodeA, nodeB] });
    const [deptA, deptB] = [dto.assignments.find((a) => a.orgNodeId === nodeA)!, dto.assignments.find((a) => a.orgNodeId === nodeB)!];

    // The head asks two custodians — as many labs as it takes.
    dto = await requests.getForActor(headAId, r.id);
    expect(dto.role).toBe("HEAD");
    expect(dto.custodians.map((c) => c.id).sort()).toEqual([custodianId, custodian2Id].sort());
    await expect(requests.assignCustodians(headAId, deptA.id, { tasks: [{ custodianId: staffId, want: "a lab" }] })).rejects.toMatchObject({ status: 400 });
    await expect(requests.assignCustodians(headBId, deptA.id, { tasks: [{ custodianId, want: "a lab" }] })).rejects.toMatchObject({ status: 403 });
    dto = await requests.assignCustodians(headAId, deptA.id, { tasks: [{ custodianId, want: "Ext Lab, mornings" }, { custodianId: custodian2Id, want: "Ext Lab Two" }] });
    const tasks = dto.assignments.find((a) => a.id === deptA.id)!.tasks;

    // Custodians hold only rooms they keep, for the department that asked them.
    dto = await requests.getForActor(custodianId, r.id);
    expect([dto.role, dto.holdRooms.map((x) => x.name), dto.can.placeHold]).toEqual(["CUSTODIAN", ["Ext Lab"], true]);
    await expect(requests.placeHold(custodian2Id, r.id, { itemIds: [labId], date, start: "09:00", end: "12:00" })).rejects.toMatchObject({ status: 403 });
    await expect(requests.placeHold(staffId, r.id, { itemIds: [labId], date, start: "09:00", end: "12:00" })).rejects.toMatchObject({ status: 403 });
    dto = await requests.placeHold(custodianId, r.id, { itemIds: [labId], date, start: "09:00", end: "12:00" });
    expect(dto.holds.map((h) => h.state)).toEqual(["HELD"]);
    // The hold really blocks the calendar.
    await expect(reservations.createStaffBooking(custodianId, { itemIds: [labId], date, start: "10:00", end: "11:00", title: "Clash" })).rejects.toMatchObject({ status: 409 });

    // The head can't answer while a custodian still hasn't; "done" needs a hold.
    await expect(requests.submitDepartment(headAId, deptA.id, { sheetUrl: SHEET, amountSantim: 1_000_000, contacts: [CONTACT] })).rejects.toMatchObject({ status: 409 });
    const task2 = tasks.find((t) => t.custodianId === custodian2Id)!;
    await expect(requests.finishTask(custodian2Id, task2.id, { outcome: "DONE" })).rejects.toMatchObject({ status: 400 });
    await requests.finishTask(custodian2Id, task2.id, { outcome: "DECLINED", note: "Lab Two is under maintenance" });
    await requests.finishTask(custodianId, tasks.find((t) => t.custodianId === custodianId)!.id, { outcome: "DONE", note: "Held 09:00–12:00" });

    // Department B declines; A answers with the cost breakdown and the contact persons.
    await requests.declineAssignment(headBId, deptB.id, { note: "No capacity that week" });
    const deanRow = await prisma.user.findUniqueOrThrow({ where: { id: deanId } });
    sent.length = 0;
    dto = await requests.submitDepartment(headAId, deptA.id, { sheetUrl: SHEET, amountSantim: 1_250_000, contacts: [CONTACT] });
    expect(dto.assignments.find((a) => a.id === deptA.id)).toMatchObject({ status: "SUBMITTED", holdCount: 1, amountSantim: 1_250_000, contacts: [CONTACT] });
    expect(sent.filter((m) => m.to === deanRow.email).map((m) => m.subject)).toEqual([`${testKey}-dept-a answered ${r.reference}`]);

    // The AVP can't quote before the college has answered; the dean sends A back once, then approves.
    await expect(requests.sendQuote(avpId, r.id, { amountSantim: 100, paymentDeadline: dayAhead(10) })).rejects.toMatchObject({ status: 409 });
    await expect(requests.submitCollege(deanId, collegePart.id, {})).rejects.toMatchObject({ status: 409 });
    await requests.reviewAssignment(deanId, deptA.id, { decision: "RETURN", note: "Add the lab assistant's fee" });
    dto = await requests.submitDepartment(headAId, deptA.id, { sheetUrl: SHEET, amountSantim: 1_350_000, contacts: [CONTACT] });
    await requests.reviewAssignment(deanId, deptA.id, { decision: "APPROVE" });
    dto = await requests.submitCollege(deanId, collegePart.id, { note: "One department can host it" });
    expect(dto.assignments.find((a) => a.id === collegePart.id)).toMatchObject({ status: "SUBMITTED", amountSantim: 1_350_000 });

    // The AVP sends it back to the dean once; the dean resubmits; the AVP approves and quotes.
    await requests.reviewAssignment(avpId, collegePart.id, { decision: "RETURN", note: "Confirm the dates with the head" });
    await requests.submitCollege(deanId, collegePart.id, {});
    dto = await requests.reviewAssignment(avpId, collegePart.id, { decision: "APPROVE" });
    expect([dto.can.quote, dto.suggestedQuoteSantim]).toEqual([true, 1_350_000]);
    expect((await requests.getForActor(deanId, r.id)).can.quote).toBe(false);

    sent.length = 0;
    dto = await requests.sendQuote(avpId, r.id, { amountSantim: 1_350_000, paymentDeadline: dayAhead(10), note: "Includes lab assistants" });
    expect(dto.status).toBe("QUOTED");
    expect(new Date(dto.holds[0].holdExpiresAt!).getTime()).toBe(new Date(dto.paymentDeadline!).getTime());
    const requester = await prisma.user.findUniqueOrThrow({ where: { id: r.requesterId } });
    expect(sent.filter((m) => m.to === requester.email).map((m) => m.subject)).toEqual([`Quote for request ${r.reference}`]);

    // The requester sees the breakdown, the bank details slot, and what is held — not yet who to call.
    const mine = await requests.viewForRequester(r.requesterId, r.id);
    expect(mine.quote?.breakdown).toEqual([{ departmentName: `${testKey}-dept-a`, amountSantim: 1_350_000, sheetUrl: SHEET }]);
    expect(mine.bookings).toEqual([{ place: "Ext Lab", date, start: "09:00", end: "12:00", confirmed: false }]);
    expect(mine.contacts).toEqual([]);
  });

  it("a college that declines takes its departments with it and releases their holds", async () => {
    const date = dayAhead(32);
    const r = await submit({ windows: [{ date, start: "09:00", end: "12:00" }] });
    const parts = await downTheLine(r.id);
    await requests.placeHold(custodianId, r.id, { itemIds: [labId], date, start: "09:00", end: "12:00" });
    const dto = await requests.declineAssignment(deanId, parts.collegeId, { note: "The college can't host it" });
    expect(dto.assignments.map((a) => a.status)).toEqual(["DECLINED", "DECLINED"]);
    expect(dto.holds.map((h) => h.state)).toEqual(["CANCELLED"]);
    expect(dto.can.quote).toBe(false);
    await expect(reservations.createStaffBooking(custodianId, { itemIds: [labId], date, start: "10:00", end: "11:00", title: "Now free" })).resolves.toMatchObject({ state: "CONFIRMED" });
  });

  it("a sample analysis books a machine the same way, and the requester sees the machine", async () => {
    const date = dayAhead(33);
    const r = await submit({
      kind: "SAMPLE_ANALYSIS",
      lines: [],
      sample: { categoryId: machineCategoryId, sampleCount: 12, analysis: "X-ray diffraction of soil samples" },
      windows: [{ date, start: "09:00", end: "12:00" }],
    });
    const parts = await downTheLine(r.id);
    let dto = await requests.getForActor(custodianId, r.id);
    expect(dto.sample).toEqual({ sampleCount: 12, analysis: "X-ray diffraction of soil samples", categoryName: "Ext XRD" });
    expect(dto.holdRooms[0].equipment.map((m) => m.name)).toEqual(["XRD-1"]);
    await requests.placeHold(custodianId, r.id, { itemIds: [machineId], date, start: "09:00", end: "12:00" });
    const task = dto.assignments.find((a) => a.id === parts.deptId)!.tasks[0];
    await requests.finishTask(custodianId, task.id, { outcome: "DONE" });
    await requests.submitDepartment(headAId, parts.deptId, { sheetUrl: SHEET, amountSantim: 300_000, contacts: [CONTACT] });
    await requests.reviewAssignment(deanId, parts.deptId, { decision: "APPROVE" });
    await requests.submitCollege(deanId, parts.collegeId, {});
    await requests.reviewAssignment(avpId, parts.collegeId, { decision: "APPROVE" });
    dto = await requests.sendQuote(avpId, r.id, { amountSantim: 300_000, paymentDeadline: dayAhead(10) });
    expect(dto.status).toBe("QUOTED");
    expect((await requests.viewForRequester(r.requesterId, r.id)).bookings).toEqual([{ place: "XRD-1 — Ext Lab", date, start: "09:00", end: "12:00", confirmed: false }]);
  });
});

describe("holds and the quote's lifetime", () => {
  it("F-055: refuses a hold on a date the request never asked for", async () => {
    const r = await submit({ windows: [{ date: dayAhead(40), start: "09:00", end: "10:00" }] });
    await downTheLine(r.id);
    await expect(requests.placeHold(custodianId, r.id, { itemIds: [labId], date: dayAhead(41), start: "09:00", end: "10:00" })).rejects.toMatchObject({ status: 400 });
    // The right date at another hour still works — a same-day replacement hold needs that.
    await expect(requests.placeHold(custodianId, r.id, { itemIds: [labId], date: dayAhead(40), start: "11:00", end: "12:00" })).resolves.toMatchObject({ status: "UNDER_REVIEW" });
  });

  it("F-056: extendHolds cannot push a hold past the payment deadline", async () => {
    const date = dayAhead(42);
    const r = await submit({ windows: [{ date, start: "09:00", end: "12:00" }] });
    await upTheLine(r.id, await downTheLine(r.id), date, 500);
    await requests.sendQuote(avpId, r.id, { amountSantim: 500, paymentDeadline: dayAhead(5) });
    await expect(requests.extendHolds(avpId, r.id, dayAhead(365 * 4))).rejects.toMatchObject({ status: 400 });
    const dto = await requests.extendHolds(deanId, r.id, dayAhead(4));
    expect(new Date(dto.holds[0].holdExpiresAt!).getTime()).toBeLessThanOrEqual(new Date(dto.paymentDeadline!).getTime());
  });

  it("a quote past its payment deadline expires and releases its holds; the requester may cancel before paying", async () => {
    const date = dayAhead(34);
    const r = await submit({ windows: [{ date, start: "09:00", end: "12:00" }] });
    await upTheLine(r.id, await downTheLine(r.id), date, 500);
    await requests.sendQuote(avpId, r.id, { amountSantim: 500, paymentDeadline: dayAhead(5) });
    await prisma.externalRequest.update({ where: { id: r.id }, data: { paymentDeadline: new Date(Date.now() - 60_000) } });

    expect(await requests.expireOverdueQuotes()).toBeGreaterThanOrEqual(1);
    const row = await prisma.externalRequest.findUniqueOrThrow({ where: { id: r.id }, include: { reservations: true } });
    expect([row.status, row.reservations.map((h) => h.state)]).toEqual(["EXPIRED", ["EXPIRED"]]);

    const other = await submit({}, otherRequesterId);
    await expect(requests.cancelForRequester(r.requesterId, other.id)).rejects.toMatchObject({ status: 404 });
    const cancelled = await requests.cancelForRequester(otherRequesterId, other.id);
    expect([cancelled.status, cancelled.canCancel]).toEqual(["CANCELLED", false]);
  });

  it("the AVP declining releases every hold", async () => {
    const date = dayAhead(35);
    const r = await submit({ windows: [{ date, start: "09:00", end: "12:00" }] }, otherRequesterId);
    await downTheLine(r.id);
    await requests.placeHold(custodianId, r.id, { itemIds: [labId], date, start: "09:00", end: "12:00" });
    const dto = await requests.closeRequest(avpId, r.id, { note: "Dates unavailable" });
    expect([dto.status, dto.holds.map((h) => h.state)]).toEqual(["DECLINED", ["CANCELLED"]]);
  });
});
