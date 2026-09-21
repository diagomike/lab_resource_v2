import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addDays, instantToCivil } from "@/lib/domain/civil-time";

/** DB-backed — payment verification against real Postgres with the fake verifier: a
 *  matching receipt books the request, receipts that don't pay the university (enough,
 *  in time) are refused, a receipt pays once, split payments add up, manual review, and
 *  a hold that lapsed and lost its slot before payment. Mail is mocked. Every node,
 *  category and item is created fresh and removed afterwards. */
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
process.env.VERIFIER_DRIVER = "fake";
process.env.PAYMENT_PROVIDERS = "CBE,TELEBIRR";
process.env.PAYMENT_CBE_RECEIVER_ACCOUNT = "1000123456789";
process.env.PAYMENT_CBE_RECEIVER_NAME = "";
process.env.PAYMENT_TELEBIRR_RECEIVER_ACCOUNT = "";
process.env.PAYMENT_TELEBIRR_RECEIVER_NAME = "Test University";

const sent: Array<{ to: string; subject: string }> = [];
vi.mock("../mail/mail", () => ({ send: async (m: { to: string; subject: string }) => void sent.push({ to: m.to, subject: m.subject }) }));

type VerifyModule = typeof import("./verify");
type FakeModule = typeof import("./verifier/fake-driver");
type RequestsModule = typeof import("../external/requests");
type ReservationsModule = typeof import("../scheduling/reservations");

let verify: VerifyModule;
let fake: FakeModule;
let requests: RequestsModule;
let reservations: ReservationsModule;
let prisma: (typeof import("../prisma"))["prisma"];
let storage: (typeof import("../resources/storage"))["storage"];
let hashToken: (typeof import("../auth/token"))["hashToken"];

const testKey = `__test-payments-${Date.now()}`;
const HOOK_TIMEOUT = 60_000;
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");

let avpId: string;
let headId: string;
let custodianId: string;
let nodeA: string;
let universityNode: string;
let groupId: string;
let roomCategoryId: string;
let labId: string;
const createdUsers: string[] = [];
const createdRequests: string[] = [];

const dayAhead = (n: number) => addDays(instantToCivil(new Date()).date, n);
const receiptNow = () => {
  const c = instantToCivil(new Date());
  return `${c.date} ${c.time}:00`;
};
let refSeq = 0;
const ref = (label: string) => `FT${Date.now().toString(36).toUpperCase()}${label}${++refSeq}`;

async function makeUser(suffix: string, roles: string[]) {
  const email = `${testKey}-${suffix}@astu.edu.et`;
  const u = await prisma.user.create({ data: { email, emailLower: email, name: `Test ${suffix}`, status: "ACTIVE", roles: { create: roles.map((kind) => ({ kind: kind as never })) } } });
  createdUsers.push(u.id);
  return u.id;
}

/** A request taken all the way to QUOTED, with one hold per slot; returns a fresh
 *  tracking token (the quote regenerated it and only emailed it). */
async function quoted(slots: Array<{ day: number; start: string; end: string }>, amountSantim = 1_000_000) {
  const result = await requests.submitRequest(
    {
      organizationName: "Payments Test Org",
      contactName: "Ms. Payer",
      contactEmail: `${testKey}-${Math.random().toString(36).slice(2, 8)}@example.org`,
      contactPhone: "+251911000000",
      purpose: "Testing payment verification end to end.",
      windows: slots.map((s) => ({ date: dayAhead(s.day), start: s.start, end: s.end })),
      lines: [{ description: "The lab", quantity: 1 }],
    },
    { bytes: PDF, fileName: "letter.pdf" },
    null,
  );
  const row = await prisma.externalRequest.findUniqueOrThrow({ where: { reference: result.reference } });
  createdRequests.push(row.id);
  await requests.forward(avpId, row.id, { orgNodeIds: [nodeA] });
  for (const s of slots) await requests.placeHold(custodianId, row.id, { itemIds: [labId], date: dayAhead(s.day), start: s.start, end: s.end });
  const assignment = await prisma.externalRequestAssignment.findFirstOrThrow({ where: { requestId: row.id } });
  await requests.decideAssignment(headId, assignment.id, { decision: "ACCEPT", sheetUrl: "https://docs.google.com/spreadsheets/d/t", amountSantim });
  await requests.sendQuote(avpId, row.id, { amountSantim, paymentDeadline: dayAhead(7) });
  const token = `test-token-${row.id}-${Math.random().toString(36).slice(2)}`;
  await prisma.externalRequest.update({ where: { id: row.id }, data: { trackingTokenHash: hashToken(token) } });
  return { id: row.id, reference: row.reference, token };
}

function cbeReceipt(reference: string, amount: unknown, overrides: Record<string, unknown> = {}) {
  fake.registerFakeReceipt("CBE", { reference, amount, receiverAccount: "1****6789", receiverName: "Test University", date: receiptNow(), ...overrides });
}

const cbe = (reference: string) => ({ provider: "CBE" as const, reference, accountSuffix: "12345678" });

beforeAll(async () => {
  verify = await import("./verify");
  fake = await import("./verifier/fake-driver");
  requests = await import("../external/requests");
  reservations = await import("../scheduling/reservations");
  ({ prisma } = await import("../prisma"));
  ({ storage } = await import("../resources/storage"));
  ({ hashToken } = await import("../auth/token"));

  avpId = await makeUser("avp", ["MANAGER", "STAFF"]);
  headId = await makeUser("head", ["MANAGER", "STAFF"]);
  custodianId = await makeUser("custodian", ["CUSTODIAN", "STAFF"]);

  universityNode = (await prisma.orgNode.create({ data: { name: `${testKey}-uni`, level: 0, kind: "UNIVERSITY", active: true, userId: avpId } })).id;
  nodeA = (await prisma.orgNode.create({ data: { name: `${testKey}-dept`, level: 9, kind: "DEPARTMENT", active: true, userId: headId } })).id;
  groupId = (await prisma.categoryGroup.create({ data: { name: testKey, sortOrder: 999 } })).id;
  roomCategoryId = (await prisma.resourceCategory.create({ data: { key: `${testKey}-room`, name: "Pay Room", iconKey: "Package", groupId, countingMode: "SERIALIZED", canBeRoot: true, bookingMode: "ROOM" } })).id;
  labId = (await prisma.item.create({ data: { name: "Pay Lab", categoryId: roomCategoryId, countingMode: "SERIALIZED", status: "WORKING", ownerOrgNodeId: nodeA, currentOrgNodeId: nodeA, custodianId } })).id;
}, HOOK_TIMEOUT);

afterAll(async () => {
  fake.clearFakeReceipts();
  const rows = await prisma.externalRequest.findMany({ where: { id: { in: createdRequests } }, select: { letterStorageKey: true } });
  for (const r of rows) await storage.remove(r.letterStorageKey).catch(() => undefined);
  await prisma.reservation.deleteMany({ where: { labItemId: labId } });
  await prisma.externalRequest.deleteMany({ where: { id: { in: createdRequests } } });
  await prisma.item.deleteMany({ where: { id: labId } });
  await prisma.resourceCategory.deleteMany({ where: { id: roomCategoryId } });
  await prisma.categoryGroup.deleteMany({ where: { id: groupId } });
  await prisma.orgNode.deleteMany({ where: { id: { in: [nodeA, universityNode] } } });
  await prisma.userRole.deleteMany({ where: { userId: { in: createdUsers } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  await prisma.$disconnect();
}, HOOK_TIMEOUT);

describe("automatic verification", () => {
  it("a receipt paying the university the full amount books the request and tells everyone", async () => {
    const r = await quoted([{ day: 40, start: "09:00", end: "12:00" }]);
    const reference = ref("FULL");
    cbeReceipt(reference, "ETB 10,000.00");

    sent.length = 0;
    const result = await verify.submitPayment(r.token, cbe(reference.toLowerCase()));
    expect([result.outcome, result.tracking.status, result.tracking.payment?.paidSantim]).toEqual(["VERIFIED", "SCHEDULED", 1_000_000]);
    expect(result.tracking.timeline.map((t) => t.label)).toEqual(expect.arrayContaining(["Payment confirmed", "Booking confirmed"]));

    const holds = await prisma.reservation.findMany({ where: { externalRequestId: r.id }, include: { resources: true } });
    expect(holds.map((h) => [h.state, h.holdExpiresAt, h.resources.every((x) => x.blocking)])).toEqual([["CONFIRMED", null, true]]);
    expect(sent.map((m) => m.subject)).toEqual([`Booking confirmed — ${r.reference}`, `Booking confirmed on your calendar — ${r.reference}`, `${r.reference} is paid and booked`]);
    expect(sent[1].to).toBe(`${testKey}-custodian@astu.edu.et`);

    // One receipt pays once — here or anywhere else.
    const other = await quoted([{ day: 41, start: "09:00", end: "12:00" }]);
    await expect(verify.submitPayment(other.token, cbe(reference))).rejects.toMatchObject({ status: 409, message: "This payment reference has already been used." });
    // A booked request takes no more payments, and its confirmation can't be re-run.
    await expect(verify.submitPayment(r.token, cbe(ref("MORE")))).rejects.toMatchObject({ status: 409 });
    await expect(verify.confirmBooking(avpId, r.id)).rejects.toMatchObject({ status: 409 });
  });

  it("refuses receipts that paid someone else, too early, not at all — and a refused reference can be tried again", async () => {
    const r = await quoted([{ day: 42, start: "09:00", end: "12:00" }]);

    const wrong = ref("WRONG");
    cbeReceipt(wrong, 10_000, { receiverAccount: "1****0000" });
    let result = await verify.submitPayment(r.token, cbe(wrong));
    expect([result.outcome, result.reason]).toEqual(["REJECTED", "This payment was not made to the university's account."]);

    const early = ref("EARLY");
    cbeReceipt(early, 10_000, { date: `${dayAhead(-2)} 10:00:00` });
    expect((await verify.submitPayment(r.token, cbe(early))).reason).toBe("This payment was made before the quote was sent.");

    const pending = ref("PENDING");
    cbeReceipt(pending, 10_000, { status: "Pending" });
    expect((await verify.submitPayment(r.token, cbe(pending))).reason).toBe("The bank does not show this payment as completed.");

    result = await verify.submitPayment(r.token, cbe(ref("UNKNOWN")));
    expect([result.outcome, result.unavailable, result.tracking.status]).toEqual(["REJECTED", false, "QUOTED"]);
    expect(result.tracking.payment?.attempts.map((a) => a.status)).toEqual(["REJECTED", "REJECTED", "REJECTED", "REJECTED"]);

    // Providers not offered, and missing inputs, are refused before asking any bank.
    await expect(verify.submitPayment(r.token, { provider: "DASHEN", reference: ref("D") })).rejects.toMatchObject({ status: 400 });
    await expect(verify.submitPayment(r.token, { provider: "CBE", reference: ref("NOSUFFIX") })).rejects.toMatchObject({ status: 400 });

    // The mistyped attempt didn't claim its reference: the real receipt still counts.
    cbeReceipt(wrong, 10_000);
    expect((await verify.submitPayment(r.token, cbe(wrong))).tracking.status).toBe("SCHEDULED");
  });

  it("split payments add up; a receipt matched by name works for a name-configured provider", async () => {
    const r = await quoted([{ day: 43, start: "09:00", end: "12:00" }], 1_000_050);
    const first = ref("HALF");
    cbeReceipt(first, "5000.00");

    sent.length = 0;
    let result = await verify.submitPayment(r.token, cbe(first));
    expect([result.outcome, result.tracking.status, result.tracking.payment?.paidSantim, result.tracking.canCancel]).toEqual(["VERIFIED", "QUOTED", 500_000, false]);
    expect(sent.map((m) => m.subject)).toEqual([`Payment received for ${r.reference}`]);

    const second = ref("REST");
    fake.registerFakeReceipt("TELEBIRR", { reference: second, amount: "5000.50", receiverName: "TEST UNIVERSITY", date: receiptNow(), status: "Completed" });
    result = await verify.submitPayment(r.token, { provider: "TELEBIRR", reference: second });
    expect([result.outcome, result.tracking.status, result.tracking.payment?.paidSantim]).toEqual(["VERIFIED", "SCHEDULED", 1_000_050]);
  });

  it("two full receipts at once: exactly one is taken, the booking is confirmed once", async () => {
    const r = await quoted([{ day: 44, start: "09:00", end: "12:00" }]);
    const [a, b] = [ref("RACEA"), ref("RACEB")];
    cbeReceipt(a, 10_000);
    cbeReceipt(b, 10_000);
    const settled = await Promise.allSettled([verify.submitPayment(r.token, cbe(a)), verify.submitPayment(r.token, cbe(b))]);
    expect(settled.map((s) => s.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(await prisma.externalRequestEvent.count({ where: { requestId: r.id, kind: "SCHEDULED" } })).toBe(1);
    expect(await prisma.paymentVerification.count({ where: { requestId: r.id, status: "VERIFIED" } })).toBe(1);
  });

  it("refuses payment after the deadline, and before a quote", async () => {
    const r = await quoted([{ day: 45, start: "09:00", end: "12:00" }]);
    await prisma.externalRequest.update({ where: { id: r.id }, data: { paymentDeadline: new Date(Date.now() - 60_000) } });
    const late = ref("LATE");
    cbeReceipt(late, 10_000);
    await expect(verify.submitPayment(r.token, cbe(late))).rejects.toMatchObject({ status: 409 });

    const unquoted = await requests.submitRequest(
      { organizationName: "Early Bird", contactName: "Mr. Early", contactEmail: `${testKey}-early@example.org`, contactPhone: "+251911000001", purpose: "Paying before any quote exists.", windows: [{ date: dayAhead(46), start: "09:00", end: "10:00" }], lines: [{ description: "x", quantity: 1 }] },
      { bytes: PDF, fileName: "l.pdf" },
      null,
    );
    createdRequests.push((await prisma.externalRequest.findUniqueOrThrow({ where: { reference: unquoted.reference } })).id);
    await expect(verify.submitPayment(unquoted.trackingToken, cbe(late))).rejects.toMatchObject({ status: 409 });
  });
});

describe("manual review", () => {
  it("when the verifier is down, the requester asks a person; only the AVP decides", async () => {
    const r = await quoted([{ day: 47, start: "09:00", end: "12:00" }]);
    const reference = ref("MANUAL");
    fake.registerFakeOutage("CBE", reference);

    let result = await verify.submitPayment(r.token, cbe(reference));
    expect([result.outcome, result.unavailable]).toEqual(["REJECTED", true]);

    sent.length = 0;
    await expect(verify.submitPayment(r.token, { ...cbe(reference), manualReview: true })).rejects.toMatchObject({ status: 400 });
    result = await verify.submitPayment(r.token, { ...cbe(reference), manualReview: true, amountSantim: 1_000_000, note: "Paid at the branch" });
    expect([result.outcome, result.tracking.status, result.tracking.payment?.pendingCount]).toEqual(["PENDING_REVIEW", "PAYMENT_SUBMITTED", 1]);
    expect(sent.map((m) => m.subject)).toEqual([`Payment to check for ${r.reference}`]);
    await expect(verify.submitPayment(r.token, { ...cbe(reference), manualReview: true, amountSantim: 1 })).rejects.toMatchObject({ status: 409 });

    const pendingId = (await prisma.paymentVerification.findFirstOrThrow({ where: { requestId: r.id, status: "PENDING_REVIEW" } })).id;
    let dto = await requests.getForActor(headId, r.id);
    expect([dto.payments, dto.paidSantim]).toEqual([[], 0]);
    await expect(verify.reviewPayment(headId, pendingId, { decision: "APPROVE" })).rejects.toMatchObject({ status: 403 });
    await expect(verify.reviewPayment(avpId, pendingId, { decision: "REJECT" })).rejects.toMatchObject({ status: 400 });

    dto = await verify.reviewPayment(avpId, pendingId, { decision: "APPROVE", note: "Seen on the bank statement" });
    expect([dto.status, dto.paidSantim, dto.payments.find((p) => p.id === pendingId)?.status]).toEqual(["SCHEDULED", 1_000_000, "MANUAL_VERIFIED"]);
    await expect(verify.reviewPayment(avpId, pendingId, { decision: "REJECT", note: "again" })).rejects.toMatchObject({ status: 409 });
  });

  it("a rejected review frees the reference and returns the request to awaiting payment", async () => {
    const r = await quoted([{ day: 48, start: "09:00", end: "12:00" }]);
    const reference = ref("REVIEWNO");
    await verify.submitPayment(r.token, { ...cbe(reference), manualReview: true, amountSantim: 1_000_000 });
    const pending = await prisma.paymentVerification.findFirstOrThrow({ where: { requestId: r.id } });
    sent.length = 0;
    const dto = await verify.reviewPayment(avpId, pending.id, { decision: "REJECT", note: "Not on the statement" });
    expect([dto.status, dto.payments[0].status]).toEqual(["QUOTED", "MANUAL_REJECTED"]);
    expect(sent.map((m) => m.subject)).toEqual([`Payment for ${r.reference} not accepted`]);
    cbeReceipt(reference, 10_000);
    expect((await verify.submitPayment(r.token, cbe(reference))).tracking.status).toBe("SCHEDULED");
  });
});

describe("confirmation", () => {
  it("a lapsed hold is revived if still free; one whose slot was taken is released and flagged, and a re-hold confirms", async () => {
    const r = await quoted([
      { day: 50, start: "09:00", end: "12:00" },
      { day: 51, start: "09:00", end: "12:00" },
    ]);
    // Both holds lapse (a manual review ran long); meanwhile a class takes day 50's slot.
    await prisma.reservation.updateMany({ where: { externalRequestId: r.id }, data: { holdExpiresAt: new Date(Date.now() - 60_000) } });
    await reservations.createStaffBooking(custodianId, { itemIds: [labId], date: dayAhead(50), start: "10:00", end: "11:00", title: "Took the slot" });

    const reference = ref("LAPSED");
    cbeReceipt(reference, 10_000);
    sent.length = 0;
    const result = await verify.submitPayment(r.token, cbe(reference));
    expect(result.tracking.status).toBe("PAID");

    const holds = await prisma.reservation.findMany({ where: { externalRequestId: r.id }, orderBy: { startsAt: "asc" } });
    expect(holds.map((h) => h.state)).toEqual(["CANCELLED", "CONFIRMED"]);
    const conflict = await prisma.externalRequestEvent.findFirstOrThrow({ where: { requestId: r.id, kind: "CONFIRMATION_CONFLICT" } });
    expect(conflict.note).toContain("now taken by Took the slot");
    expect(sent.map((m) => m.subject)).toEqual(expect.arrayContaining([`Payment complete — ${r.reference}`, `${r.reference} is paid but a slot was lost`, `Booking confirmed on your calendar — ${r.reference}`]));

    // The custodian holds a replacement; the AVP confirms again.
    let dto = await requests.getForActor(avpId, r.id);
    expect(dto.can.confirm).toBe(true);
    await expect(verify.confirmBooking(headId, r.id)).rejects.toMatchObject({ status: 403 });
    await requests.placeHold(custodianId, r.id, { itemIds: [labId], date: dayAhead(50), start: "13:00", end: "16:00" });
    dto = await verify.confirmBooking(avpId, r.id);
    expect([dto.status, dto.holds.map((h) => h.state)]).toEqual(["SCHEDULED", ["CANCELLED", "CONFIRMED", "CONFIRMED"]]);
  });
});
