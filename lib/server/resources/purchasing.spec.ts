import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** DB-backed — live chain resolution against real org nodes/heads (including a
 *  genuinely multi-parent department), vacancy/handoff behaviour, and the
 *  createItem/setQuantity seam into the register are not provable as pure logic
 *  (the pure half already lives in lib/domain/purchasing.spec.ts, 12 tests, and
 *  lib/domain/approvals.spec.ts, 45 tests, which this reuses unmodified).
 *
 *  Every org node here is a freshly created, ORPHAN node (no parent edges into the
 *  real shared chart) — the lesson Track 2's lab-drafts.spec.ts and Track 3's
 *  approvals.spec.ts already learned the hard way. The one exception this file has
 *  to handle that they didn't: `findProcurementOffice` resolves by NAME across the
 *  WHOLE org chart ("Procurement Office"), not by id, so if a real one already
 *  exists (e.g. from this track's own live-verification pass), this file's own test
 *  fixture would make the lookup ambiguous. Handled by temporarily deactivating any
 *  real one for the duration of this file's run and reactivating it in `afterAll` —
 *  a single boolean flip, not an occupancy change, and restored either way. */
function loadDotEnv(): void {
  if (process.env.DATABASE_URL) return;
  const envPath = path.resolve(process.cwd(), ".env");
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}
loadDotEnv();

type PurchasingModule = typeof import("./purchasing");
type CategoriesModule = typeof import("./categories");
type PrismaModule = typeof import("../prisma");

let purchasing: PurchasingModule;
let categories: CategoriesModule;
let prisma: PrismaModule["prisma"];

let sysAdminId: string;
let groupId: string;
let serializedCategoryId: string;
let bulkCategoryId: string;
let procurementNodeId: string;
let procurementUserId: string;
let realOfficeIdsToRestore: string[] = [];

const testKey = `__test-purchasing-${Date.now()}`;
const createdUserIds: string[] = [];
const createdNodeIds: string[] = [];
const createdItemIds: string[] = [];
const createdNeedIds: string[] = [];
const createdRequestIds: string[] = [];

let userCounter = 0;

async function makeUser(suffix: string, roles: string[] = []) {
  const email = `${testKey}-${suffix}-${userCounter++}@astu.edu.et`;
  const user = await prisma.user.create({
    data: { email, emailLower: email, name: `Test ${suffix}`, status: "ACTIVE", roles: { create: roles.map((kind) => ({ kind: kind as never })) } },
  });
  createdUserIds.push(user.id);
  return user.id;
}

/** A standalone, orphan node — no parent edges into the real shared org chart. */
async function makeNode(name: string, kind: "UNIVERSITY" | "COLLEGE" | "DEPARTMENT" | "OFFICE", level: number, headId: string | null) {
  const node = await prisma.orgNode.create({ data: { name: `${testKey}-${name}`, level, kind, active: true, userId: headId } });
  createdNodeIds.push(node.id);
  return node.id;
}

async function setHead(nodeId: string, headId: string | null) {
  await prisma.orgNode.update({ where: { id: nodeId }, data: { userId: headId } });
}

async function addEdge(parentId: string, childId: string) {
  await prisma.orgEdge.create({ data: { parentId, childId } });
}

/** dept → one college → an isolated university root. Only the department gets
 *  `headId` as its occupant — `OrgNode.userId` is unique, so one person can never
 *  occupy more than one node at once; college/university start headless (a
 *  deliberately vacant post, same convention Track 3's own fixtures use) and each
 *  test assigns whoever it needs via `setHead`. */
async function makeChain(prefix: string, headId: string) {
  const universityId = await makeNode(`${prefix}-university`, "UNIVERSITY", 0, null);
  const collegeId = await makeNode(`${prefix}-college`, "COLLEGE", 1, null);
  const deptId = await makeNode(`${prefix}-dept`, "DEPARTMENT", 2, headId);
  await addEdge(universityId, collegeId);
  await addEdge(collegeId, deptId);
  return { universityId, collegeId, deptId };
}

function compileInput(orgNodeId: string, over: Partial<{ title: string; lines: unknown[] }> = {}) {
  return {
    title: over.title ?? "Test purchase request",
    orgNodeId,
    lines: over.lines ?? [{ name: "Digital balance", qty: 1, unit: "Unit", fromNeedIds: [] }],
  } as never;
}

beforeAll(async () => {
  purchasing = await import("./purchasing");
  categories = await import("./categories");
  ({ prisma } = await import("../prisma"));

  const sysAdmin = await prisma.user.findFirstOrThrow({ where: { roles: { some: { kind: "SYS_ADMIN" } } } });
  sysAdminId = sysAdmin.id;

  const group = await prisma.categoryGroup.create({ data: { name: testKey, sortOrder: 999 } });
  groupId = group.id;
  const serialized = await categories.create(sysAdminId, {
    key: `${testKey}-ser`,
    name: "Purchasing Test Equipment",
    iconKey: "Package",
    groupId,
    countingMode: "SERIALIZED",
    impairRule: "ANY_CRITICAL",
    canBeRoot: false,
    placement: "ANYWHERE",
    allowedParentCategoryIds: [],
    fields: [],
    templateChildren: [],
  });
  serializedCategoryId = serialized.id;
  const bulk = await categories.create(sysAdminId, {
    key: `${testKey}-bulk`,
    name: "Purchasing Test Reagent",
    iconKey: "Package",
    groupId,
    countingMode: "BULK",
    impairRule: "NEVER",
    canBeRoot: false,
    placement: "ANYWHERE",
    allowedParentCategoryIds: [],
    fields: [],
    templateChildren: [],
  });
  bulkCategoryId = bulk.id;

  const realOffices = await prisma.orgNode.findMany({ where: { kind: "OFFICE", name: "Procurement Office", active: true } });
  if (realOffices.length) {
    realOfficeIdsToRestore = realOffices.map((o) => o.id);
    await prisma.orgNode.updateMany({ where: { id: { in: realOfficeIdsToRestore } }, data: { active: false } });
  }
  procurementUserId = await makeUser("procurement", ["PROCUREMENT"]);
  procurementNodeId = await makeNode("procurement-office", "OFFICE", 1, procurementUserId);
  // makeNode's own name is prefixed with testKey — rename to the exact string
  // findProcurementOffice looks for.
  await prisma.orgNode.update({ where: { id: procurementNodeId }, data: { name: "Procurement Office" } });
});

afterAll(async () => {
  await prisma.itemChange.deleteMany({ where: { OR: [{ itemId: { in: createdItemIds } }, { categoryId: { in: [serializedCategoryId, bulkCategoryId] } }] } });
  // Children (received stock) before parents (the store item itself) — Item.parentId
  // is RESTRICT, and a single deleteMany over both in one batch isn't guaranteed to
  // order itself child-first.
  await prisma.item.deleteMany({ where: { id: { in: createdItemIds }, parentId: { not: null } } });
  await prisma.item.deleteMany({ where: { id: { in: createdItemIds } } });
  await prisma.purchaseRequest.deleteMany({ where: { id: { in: createdRequestIds } } }); // cascades lines/events/steps
  await prisma.needLine.deleteMany({ where: { id: { in: createdNeedIds } } });
  await prisma.orgNode.deleteMany({ where: { id: { in: createdNodeIds } } });
  await prisma.resourceCategory.delete({ where: { id: serializedCategoryId } });
  await prisma.resourceCategory.delete({ where: { id: bulkCategoryId } });
  await prisma.categoryGroup.delete({ where: { id: groupId } });
  await prisma.userRole.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  if (realOfficeIdsToRestore.length) {
    await prisma.orgNode.updateMany({ where: { id: { in: realOfficeIdsToRestore } }, data: { active: true } });
  }
  await prisma.$disconnect();
});

describe("needs — raise, browse, decline", () => {
  it("raises a need at the actor's own home unit, and a head can decline it with a note", async () => {
    const headId = await makeUser("needs-head", ["MANAGER"]);
    const { deptId } = await makeChain("needs", headId);
    const staffId = await makeUser("needs-staff", ["STAFF"]);
    await setHead(deptId, headId);
    await prisma.user.update({ where: { id: staffId }, data: { homeNodeId: deptId } });

    const need = await purchasing.raiseNeed(staffId, { name: "Digital balance", qty: 1, reason: "Ours is broken" });
    createdNeedIds.push(need.id);
    expect(need.status).toBe("OPEN");
    expect(need.orgNodeId).toBe(deptId);

    const open = await purchasing.listOpenNeeds(headId, deptId);
    expect(open.map((n) => n.id)).toContain(need.id);

    const declined = await purchasing.declineNeed(headId, need.id, { note: "Not this quarter" });
    expect(declined.status).toBe("DECLINED");
    expect(declined.note).toBe("Not this quarter");
  });

  it("a student may not raise a need", async () => {
    const studentId = await makeUser("needs-student", ["STUDENT"]);
    const { deptId } = await makeChain("needs-student-chain", studentId);
    await prisma.user.update({ where: { id: studentId }, data: { homeNodeId: deptId } });
    await expect(purchasing.raiseNeed(studentId, { name: "x", qty: 1, reason: "y" })).rejects.toMatchObject({ status: 403 });
  });
});

describe("compilePurchaseRequest — the org chart as the ladder", () => {
  it("refuses when no Procurement Office is on the org chart", async () => {
    await prisma.orgNode.update({ where: { id: procurementNodeId }, data: { active: false } });
    try {
      const headId = await makeUser("noproc-head", ["MANAGER"]);
      const { deptId } = await makeChain("noproc", headId);
      await expect(purchasing.compilePurchaseRequest(headId, compileInput(deptId))).rejects.toMatchObject({ status: 400 });
    } finally {
      await prisma.orgNode.update({ where: { id: procurementNodeId }, data: { active: true } });
    }
  });

  it("refuses a non-head, and refuses a head compiling for a unit they don't head", async () => {
    const headId = await makeUser("wronghead-head", ["MANAGER"]);
    const otherHeadId = await makeUser("wronghead-other", ["MANAGER"]);
    const { deptId } = await makeChain("wronghead", headId);
    await expect(purchasing.compilePurchaseRequest(otherHeadId, compileInput(deptId))).rejects.toMatchObject({ status: 403 });
  });

  it("a single-college department's request walks head, dean, AVP, then Procurement, in order", async () => {
    const deptHeadId = await makeUser("chain-dept-head", ["MANAGER"]);
    const collegeHeadId = await makeUser("chain-college-head");
    const universityHeadId = await makeUser("chain-university-head");
    const { universityId, collegeId, deptId } = await makeChain("single", deptHeadId);
    await setHead(collegeId, collegeHeadId);
    await setHead(universityId, universityHeadId);

    const result = await purchasing.compilePurchaseRequest(deptHeadId, compileInput(deptId));
    createdRequestIds.push(result.id);

    expect(result.stage).toBe("APPROVING");
    expect(result.steps.map((s) => s.selector)).toEqual(["OWNER_HEAD", "HIERARCHY", "HIERARCHY", "NODE_OCCUPANT"]);
    expect(result.steps[0].approverId).toBe(deptHeadId);
    expect(result.steps[1].approverId).toBe(collegeHeadId);
    expect(result.steps[2].approverId).toBe(universityHeadId);
    expect(result.steps[3].approverId).toBe(procurementUserId);
  });

  it("a two-college (multi-parent) department requires BOTH deans, sequentially, before reaching the university level", async () => {
    const deptHeadId = await makeUser("multi-dept-head", ["MANAGER"]);
    const deanAId = await makeUser("multi-dean-a");
    const deanBId = await makeUser("multi-dean-b");
    const universityHeadId = await makeUser("multi-university-head");

    const universityId = await makeNode("multi-university", "UNIVERSITY", 0, universityHeadId);
    const collegeAId = await makeNode("multi-college-a", "COLLEGE", 1, deanAId);
    const collegeBId = await makeNode("multi-college-b", "COLLEGE", 1, deanBId);
    const deptId = await makeNode("multi-dept", "DEPARTMENT", 2, deptHeadId);
    await addEdge(universityId, collegeAId);
    await addEdge(universityId, collegeBId);
    await addEdge(collegeAId, deptId);
    await addEdge(collegeBId, deptId);

    const result = await purchasing.compilePurchaseRequest(deptHeadId, compileInput(deptId));
    createdRequestIds.push(result.id);

    // Both colleges get a real, required step before the walk reaches the
    // university level — not a choice between them (org-chain.ts's own contract).
    const approverIds = result.steps.map((s) => s.approverId);
    expect(approverIds.slice(0, 3)).toEqual(expect.arrayContaining([deptHeadId, deanAId, deanBId]));
    expect(approverIds[3]).toBe(universityHeadId);
    expect(approverIds[4]).toBe(procurementUserId);
    // The dept head's own OWNER_HEAD step self-skips (they occupy the department
    // and raised the request); every other step is live and waiting its turn.
    expect(result.steps[0].status).toBe("SKIPPED");
    expect(result.steps.slice(1).every((s) => s.status === "PENDING" || s.status === "WAITING")).toBe(true);
  });

  it("carries a referenced OPEN need into the new line, marking it CARRIED", async () => {
    const headId = await makeUser("carry-head", ["MANAGER"]);
    const { deptId } = await makeChain("carry", headId);
    await prisma.user.update({ where: { id: headId }, data: { homeNodeId: deptId } });
    const need = await purchasing.raiseNeed(headId, { name: "Fume hood", qty: 1, reason: "None in the lab" });
    createdNeedIds.push(need.id);

    const result = await purchasing.compilePurchaseRequest(headId, compileInput(deptId, { lines: [{ name: "Fume hood", qty: 1, unit: "Unit", fromNeedIds: [need.id] }] }));
    createdRequestIds.push(result.id);

    expect(result.lines[0].fromNeedIds).toEqual([need.id]);
    const refreshedNeed = await prisma.needLine.findUniqueOrThrow({ where: { id: need.id } });
    expect(refreshedNeed.status).toBe("CARRIED");
    expect(refreshedNeed.purchaseLineId).toBe(result.lines[0].id);
  });
});

describe("decideStep — vacancy, handoff, reject, revise", () => {
  async function setUpChain(prefix: string) {
    const deptHeadId = await makeUser(`${prefix}-dept-head`, ["MANAGER"]);
    const collegeHeadId = await makeUser(`${prefix}-college-head`);
    const universityHeadId = await makeUser(`${prefix}-university-head`);
    const { universityId, collegeId, deptId } = await makeChain(prefix, deptHeadId);
    await setHead(collegeId, collegeHeadId);
    await setHead(universityId, universityHeadId);

    const result = await purchasing.compilePurchaseRequest(deptHeadId, compileInput(deptId));
    createdRequestIds.push(result.id);
    return { requestId: result.id, deptHeadId, collegeHeadId, universityHeadId, universityId, collegeId, deptId };
  }

  it("a vacant college deanship blocks — undecidable by anyone — and appointing someone unblocks it immediately", async () => {
    // The compiling head's own OWNER_HEAD step is already self-skipped (they occupy
    // the department AND raised the request) — the college HIERARCHY step is the
    // first genuinely PENDING one from the moment the request is compiled.
    const { requestId, deptHeadId, collegeHeadId, collegeId } = await setUpChain("vacancy");
    await setHead(collegeId, null);

    await expect(purchasing.decideStep(collegeHeadId, requestId, "APPROVE")).rejects.toMatchObject({ status: 403 });
    // Read as the original requester — always a party, unlike a vacated step's
    // former occupant, whose live-resolved approverId is now null (same "party"
    // check Track 3's own getRequest uses).
    const req = await purchasing.getRequest(deptHeadId, requestId);
    expect(req.steps.find((s) => s.status === "PENDING")?.approverId).toBeNull();

    const newDeanId = await makeUser("vacancy-new-dean");
    await setHead(collegeId, newDeanId);
    const decided = await purchasing.decideStep(newDeanId, requestId, "APPROVE");
    expect(decided.steps.find((s) => s.selector === "HIERARCHY" && s.decidedById === newDeanId)).toBeTruthy();
  });

  it("REJECT ends the request outright", async () => {
    const { requestId, collegeHeadId } = await setUpChain("reject");
    const decided = await purchasing.decideStep(collegeHeadId, requestId, "REJECT", "not now");
    expect(decided.stage).toBe("REJECTED");
    expect(decided.feedback).toBe("not now");
    await expect(purchasing.decideStep(collegeHeadId, requestId, "APPROVE")).rejects.toMatchObject({ status: 409 });
  });

  it("REVISE sends it back to REVISING with the chain cleared, and resubmitting rebuilds it fresh", async () => {
    const { requestId, deptHeadId, collegeHeadId, deptId } = await setUpChain("revise");
    const revised = await purchasing.decideStep(collegeHeadId, requestId, "REVISE", "add a justification");
    expect(revised.stage).toBe("REVISING");
    expect(revised.steps).toHaveLength(0);

    const resubmitted = await purchasing.reviseAndResubmit(deptHeadId, requestId, compileInput(deptId, { title: "Revised title" }));
    expect(resubmitted.stage).toBe("APPROVING");
    expect(resubmitted.title).toBe("Revised title");
    expect(resubmitted.steps).toHaveLength(4);
  });

  it("the full happy path settles at ORDER_PLACED once every remaining step approves — dept head, dean, AVP, then Procurement", async () => {
    const { requestId, collegeHeadId, universityHeadId } = await setUpChain("happy");
    let decided = await purchasing.decideStep(collegeHeadId, requestId, "APPROVE");
    expect(decided.stage).toBe("APPROVING"); // still waiting on the university/AVP and Procurement steps
    decided = await purchasing.decideStep(universityHeadId, requestId, "APPROVE");
    expect(decided.stage).toBe("APPROVING"); // still waiting on Procurement
    decided = await purchasing.decideStep(procurementUserId, requestId, "APPROVE");
    expect(decided.stage).toBe("ORDER_PLACED");
    expect(decided.history.some((h) => h.stage === "ORDER_PLACED")).toBe(true);
  });
});

describe("cancelPurchaseRequest", () => {
  it("the requester may cancel their own unfinished request; a non-requester may not", async () => {
    const headId = await makeUser("cancel-head", ["MANAGER"]);
    const { deptId } = await makeChain("cancel", headId);
    const result = await purchasing.compilePurchaseRequest(headId, compileInput(deptId));
    createdRequestIds.push(result.id);

    const outsiderId = await makeUser("cancel-outsider");
    await expect(purchasing.cancelPurchaseRequest(outsiderId, result.id)).rejects.toMatchObject({ status: 403 });
    await purchasing.cancelPurchaseRequest(headId, result.id);
    const req = await purchasing.getRequest(headId, result.id);
    expect(req.stage).toBe("CANCELLED");
  });

  it("F-047: the raiser cannot cancel after ORDER_PLACED — only procurement can, and only with a note", async () => {
    const deptHeadId = await makeUser("f047-dept-head", ["MANAGER"]);
    const collegeHeadId = await makeUser("f047-college-head");
    const universityHeadId = await makeUser("f047-university-head");
    const { universityId, collegeId, deptId } = await makeChain("f047", deptHeadId);
    await setHead(collegeId, collegeHeadId);
    await setHead(universityId, universityHeadId);

    const result = await purchasing.compilePurchaseRequest(deptHeadId, compileInput(deptId));
    createdRequestIds.push(result.id);
    await purchasing.decideStep(collegeHeadId, result.id, "APPROVE");
    await purchasing.decideStep(universityHeadId, result.id, "APPROVE");
    const decided = await purchasing.decideStep(procurementUserId, result.id, "APPROVE");
    expect(decided.stage).toBe("ORDER_PLACED");

    await expect(purchasing.cancelPurchaseRequest(deptHeadId, result.id)).rejects.toMatchObject({ status: 409 });

    const outsiderId = await makeUser("f047-outsider");
    await expect(purchasing.cancelPurchaseRequest(outsiderId, result.id, "trying anyway")).rejects.toMatchObject({ status: 403 });

    await expect(purchasing.cancelPurchaseRequest(procurementUserId, result.id)).rejects.toMatchObject({ status: 400 });

    const cancelled = await purchasing.cancelPurchaseRequest(procurementUserId, result.id, "Supplier withdrew the offer").then(() => purchasing.getRequest(procurementUserId, result.id));
    expect(cancelled.stage).toBe("CANCELLED");
    expect(cancelled.history.at(-1)?.note).toContain("Supplier withdrew the offer");
  });

  it("F-046: rejecting or cancelling a request reopens the needs it carried", async () => {
    const staffId = await makeUser("f046-staff", ["STAFF"]);
    const headId = await makeUser("f046-head", ["MANAGER"]);
    const collegeHeadId = await makeUser("f046-college-head");
    const { collegeId, deptId } = await makeChain("f046", headId);
    await setHead(collegeId, collegeHeadId);
    await prisma.user.update({ where: { id: staffId }, data: { homeNodeId: deptId } });

    const need = await purchasing.raiseNeed(staffId, { name: "F046 Projector", qty: 1, reason: "Ours broke" });
    createdNeedIds.push(need.id);

    const rejected = await purchasing.compilePurchaseRequest(headId, compileInput(deptId, { lines: [{ name: "F046 Projector", qty: 1, unit: "Unit", fromNeedIds: [need.id] }] }));
    createdRequestIds.push(rejected.id);
    let need1 = await purchasing.listMyNeeds(staffId).then((ns) => ns.find((n) => n.id === need.id)!);
    expect(need1.status).toBe("CARRIED");

    // The dept head's own OWNER_HEAD step is self-skipped (they raised it and occupy
    // the dept); the college HIERARCHY step is the first genuinely PENDING one.
    await purchasing.decideStep(collegeHeadId, rejected.id, "REJECT", "not this quarter");
    need1 = await purchasing.listMyNeeds(staffId).then((ns) => ns.find((n) => n.id === need.id)!);
    expect(need1.status).toBe("OPEN");
    expect(need1.note).toContain(rejected.reference);

    // Carry it again into a second request, then cancel that one too (still
    // APPROVING, so the raiser's own withdrawal applies).
    const cancelled = await purchasing.compilePurchaseRequest(headId, compileInput(deptId, { lines: [{ name: "F046 Projector", qty: 1, unit: "Unit", fromNeedIds: [need.id] }] }));
    createdRequestIds.push(cancelled.id);
    need1 = await purchasing.listMyNeeds(staffId).then((ns) => ns.find((n) => n.id === need.id)!);
    expect(need1.status).toBe("CARRIED");

    await purchasing.cancelPurchaseRequest(headId, cancelled.id);
    need1 = await purchasing.listMyNeeds(staffId).then((ns) => ns.find((n) => n.id === need.id)!);
    expect(need1.status).toBe("OPEN");
    expect(need1.note).toContain(cancelled.reference);
  });
});

describe("the reporting pipeline and receiving", () => {
  /** Walks a fresh request all the way to ORDER_PLACED via real decisions — the
   *  compiling head's own step self-skips, so college dean → university/AVP →
   *  Procurement are the three that actually have to approve. */
  async function setUpAtOrderPlaced(prefix: string, lines?: unknown[]) {
    const deptHeadId = await makeUser(`${prefix}-dept-head`, ["MANAGER"]);
    const collegeHeadId = await makeUser(`${prefix}-college-head`);
    const universityHeadId = await makeUser(`${prefix}-university-head`);
    const { universityId, collegeId, deptId } = await makeChain(prefix, deptHeadId);
    await setHead(collegeId, collegeHeadId);
    await setHead(universityId, universityHeadId);

    const result = await purchasing.compilePurchaseRequest(deptHeadId, compileInput(deptId, { lines: lines ?? [{ name: "Balance", qty: 3, unit: "Unit", fromNeedIds: [] }] }));
    createdRequestIds.push(result.id);

    await purchasing.decideStep(collegeHeadId, result.id, "APPROVE");
    await purchasing.decideStep(universityHeadId, result.id, "APPROVE");
    const settled = await purchasing.decideStep(procurementUserId, result.id, "APPROVE");
    expect(settled.stage).toBe("ORDER_PLACED");
    return { requestId: result.id, deptId, lineId: result.lines[0].id };
  }

  it("advanceStage walks the four pipeline stages in order, PROCUREMENT-only, and refuses past the end", async () => {
    const { requestId } = await setUpAtOrderPlaced("pipeline");
    const nonProcId = await makeUser("pipeline-non-proc");
    await expect(purchasing.advanceStage(nonProcId, requestId, {})).rejects.toMatchObject({ status: 403 });

    let req = await purchasing.advanceStage(procurementUserId, requestId, {});
    expect(req.stage).toBe("BUYER_FOUND");
    req = await purchasing.advanceStage(procurementUserId, requestId, {});
    expect(req.stage).toBe("ON_DELIVERY");
    req = await purchasing.advanceStage(procurementUserId, requestId, {});
    expect(req.stage).toBe("IN_STORE");
    await expect(purchasing.advanceStage(procurementUserId, requestId, {})).rejects.toMatchObject({ status: 400 });

    const receivingId = await makeUser("pipeline-receiving-keeper", ["STORE_KEEPER"]);
    const receiving = await purchasing.listForActor(receivingId, "receiving");
    expect(receiving.map((r) => r.id)).toContain(requestId);
    await expect(purchasing.listForActor(nonProcId, "pipeline")).rejects.toMatchObject({ status: 403 });
    await expect(purchasing.listForActor(receivingId, "pipeline")).rejects.toMatchObject({ status: 403 });
  });

  it("receivePurchaseLine (SERIALIZED) creates real Items, is cumulative, and auto-closes once fully received", async () => {
    const { requestId, deptId, lineId } = await setUpAtOrderPlaced("receive-ser");
    await purchasing.advanceStage(procurementUserId, requestId, {});
    await purchasing.advanceStage(procurementUserId, requestId, {});
    await purchasing.advanceStage(procurementUserId, requestId, {}); // now IN_STORE

    const storeKeeperId = await makeUser("receive-ser-keeper", ["STORE_KEEPER"]);
    const storeItem = await prisma.item.create({
      data: { categoryId: serializedCategoryId, name: "Test Store", countingMode: "SERIALIZED", status: "WORKING", ownerOrgNodeId: deptId, currentOrgNodeId: deptId, custodianId: storeKeeperId },
    });
    createdItemIds.push(storeItem.id);

    const nonKeeperId = await makeUser("receive-ser-nonkeeper");
    await expect(purchasing.receivePurchaseLine(nonKeeperId, requestId, { lineId, qty: 1, categoryId: serializedCategoryId, storeParentId: storeItem.id })).rejects.toMatchObject({ status: 403 });

    const partial = await purchasing.receivePurchaseLine(storeKeeperId, requestId, { lineId, qty: 2, categoryId: serializedCategoryId, storeParentId: storeItem.id });
    expect(partial.stage).toBe("IN_STORE");
    expect(partial.lines[0].receivedQty).toBe(2);

    const createdSoFar = await prisma.item.findMany({ where: { parentId: storeItem.id } });
    createdItemIds.push(...createdSoFar.map((i) => i.id));
    expect(createdSoFar).toHaveLength(2);
    // The received item is named after what was actually ordered, not left at the
    // category's own generic auto-numbered default.
    expect(createdSoFar.every((i) => i.name.startsWith("Balance"))).toBe(true);

    const complete = await purchasing.receivePurchaseLine(storeKeeperId, requestId, { lineId, qty: 1, categoryId: serializedCategoryId, storeParentId: storeItem.id });
    expect(complete.stage).toBe("CLOSED");
    expect(complete.lines[0].receivedQty).toBe(3);

    const allCreated = await prisma.item.findMany({ where: { parentId: storeItem.id } });
    createdItemIds.push(...allCreated.filter((i) => !createdItemIds.includes(i.id)).map((i) => i.id));
    expect(allCreated).toHaveLength(3);
  });

  it("receivePurchaseLine (BULK) creates one root item and sets its quantity via the ordinary setQuantity path", async () => {
    const { requestId, deptId, lineId } = await setUpAtOrderPlaced("receive-bulk", [{ name: "Ethanol", qty: 5, unit: "L", fromNeedIds: [] }]);
    await purchasing.advanceStage(procurementUserId, requestId, {});
    await purchasing.advanceStage(procurementUserId, requestId, {});
    await purchasing.advanceStage(procurementUserId, requestId, {});

    const storeKeeperId = await makeUser("receive-bulk-keeper", ["STORE_KEEPER"]);
    const storeItem = await prisma.item.create({
      data: { categoryId: bulkCategoryId, name: "Test Bulk Store", countingMode: "BULK", status: "WORKING", ownerOrgNodeId: deptId, currentOrgNodeId: deptId, custodianId: storeKeeperId },
    });
    createdItemIds.push(storeItem.id);

    const received = await purchasing.receivePurchaseLine(storeKeeperId, requestId, { lineId, qty: 5, categoryId: bulkCategoryId, storeParentId: storeItem.id });
    expect(received.stage).toBe("CLOSED");

    const created = await prisma.item.findMany({ where: { parentId: storeItem.id } });
    createdItemIds.push(...created.map((i) => i.id));
    expect(created).toHaveLength(1);
    expect(Number(created[0].qty)).toBe(5);
    expect(created[0].name.startsWith("Ethanol")).toBe(true);
  });

  it("F-045: refuses a category that doesn't match what the line ordered", async () => {
    const { requestId, deptId, lineId } = await setUpAtOrderPlaced("f045-category", [{ name: "Oscilloscope", qty: 1, unit: "Unit", categoryId: serializedCategoryId, fromNeedIds: [] }]);
    await purchasing.advanceStage(procurementUserId, requestId, {});
    await purchasing.advanceStage(procurementUserId, requestId, {});
    await purchasing.advanceStage(procurementUserId, requestId, {});

    const storeKeeperId = await makeUser("f045-category-keeper", ["STORE_KEEPER"]);
    const storeItem = await prisma.item.create({
      data: { categoryId: serializedCategoryId, name: "F045 Category Store", countingMode: "SERIALIZED", status: "WORKING", ownerOrgNodeId: deptId, currentOrgNodeId: deptId, custodianId: storeKeeperId },
    });
    createdItemIds.push(storeItem.id);

    await expect(purchasing.receivePurchaseLine(storeKeeperId, requestId, { lineId, qty: 1, categoryId: bulkCategoryId, storeParentId: storeItem.id })).rejects.toMatchObject({ status: 400 });
    const untouched = await purchasing.getRequest(storeKeeperId, requestId);
    expect(untouched.lines[0].receivedQty).toBeNull();
  });

  it("F-045: refuses receiving more than what remains on the line", async () => {
    const { requestId, deptId, lineId } = await setUpAtOrderPlaced("f045-over", [{ name: "Balance", qty: 10, unit: "L", fromNeedIds: [] }]);
    await purchasing.advanceStage(procurementUserId, requestId, {});
    await purchasing.advanceStage(procurementUserId, requestId, {});
    await purchasing.advanceStage(procurementUserId, requestId, {});

    const storeKeeperId = await makeUser("f045-over-keeper", ["STORE_KEEPER"]);
    const storeItem = await prisma.item.create({
      data: { categoryId: bulkCategoryId, name: "F045 Over Store", countingMode: "BULK", status: "WORKING", ownerOrgNodeId: deptId, currentOrgNodeId: deptId, custodianId: storeKeeperId },
    });
    createdItemIds.push(storeItem.id);

    await expect(purchasing.receivePurchaseLine(storeKeeperId, requestId, { lineId, qty: 500, categoryId: bulkCategoryId, storeParentId: storeItem.id })).rejects.toMatchObject({ status: 409 });
    const untouched = await purchasing.getRequest(storeKeeperId, requestId);
    expect(untouched.lines[0].receivedQty).toBeNull();
    expect(untouched.stage).toBe("IN_STORE"); // never closed on the strength of an over-receipt
  });

  it("F-045: parallel receipts on the same line sum correctly, no lost update", async () => {
    const { requestId, deptId, lineId } = await setUpAtOrderPlaced("f045-parallel", [{ name: "Ethanol", qty: 10, unit: "L", fromNeedIds: [] }]);
    await purchasing.advanceStage(procurementUserId, requestId, {});
    await purchasing.advanceStage(procurementUserId, requestId, {});
    await purchasing.advanceStage(procurementUserId, requestId, {});

    const storeKeeperId = await makeUser("f045-parallel-keeper", ["STORE_KEEPER"]);
    const storeItem = await prisma.item.create({
      data: { categoryId: bulkCategoryId, name: "F045 Parallel Store", countingMode: "BULK", status: "WORKING", ownerOrgNodeId: deptId, currentOrgNodeId: deptId, custodianId: storeKeeperId },
    });
    createdItemIds.push(storeItem.id);

    const results = await Promise.allSettled([
      purchasing.receivePurchaseLine(storeKeeperId, requestId, { lineId, qty: 1, categoryId: bulkCategoryId, storeParentId: storeItem.id }),
      purchasing.receivePurchaseLine(storeKeeperId, requestId, { lineId, qty: 1, categoryId: bulkCategoryId, storeParentId: storeItem.id }),
    ]);
    for (const r of results) if (r.status === "rejected") throw r.reason;

    const after = await purchasing.getRequest(storeKeeperId, requestId);
    expect(after.lines[0].receivedQty).toBe(2); // not 1 — the pre-fix lost-update bug (B-10)

    const createdItems = await prisma.item.findMany({ where: { parentId: storeItem.id } });
    createdItemIds.push(...createdItems.map((i) => i.id));
    expect(createdItems).toHaveLength(2);
  });

  it("F-045: rejects a fractional quantity ordered against a SERIALIZED category, at compile time", async () => {
    const headId = await makeUser("f045-fraction-head", ["MANAGER"]);
    const { deptId } = await makeChain("f045-fraction", headId);
    await expect(
      purchasing.compilePurchaseRequest(headId, compileInput(deptId, { lines: [{ name: "Computer", qty: 2.5, unit: "Unit", categoryId: serializedCategoryId, fromNeedIds: [] }] })),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("history and visibility — every send-back is kept, everyone involved can follow it", () => {
  /** makeChain adds edges only; readableRequestWhere reads OrgClosure, so this block
   *  writes the closure rows the real org module would have (cascade-deleted with
   *  the orphan nodes in afterAll). */
  async function addClosure(universityId: string, collegeId: string, deptId: string) {
    await prisma.orgClosure.createMany({
      data: [
        { ancestorId: universityId, descendantId: universityId, depth: 0 },
        { ancestorId: collegeId, descendantId: collegeId, depth: 0 },
        { ancestorId: deptId, descendantId: deptId, depth: 0 },
        { ancestorId: universityId, descendantId: collegeId, depth: 1 },
        { ancestorId: collegeId, descendantId: deptId, depth: 1 },
        { ancestorId: universityId, descendantId: deptId, depth: 2 },
      ],
    });
  }

  it("records submit, every decision with its note, and every resubmit — surviving REVISE clearing the steps", async () => {
    const deptHeadId = await makeUser("hist-dept-head", ["MANAGER"]);
    const deanId = await makeUser("hist-dean");
    const avpId = await makeUser("hist-avp");
    const { universityId, collegeId, deptId } = await makeChain("hist", deptHeadId);
    await setHead(collegeId, deanId);
    await setHead(universityId, avpId);

    const lines = [{ name: "Computer", qty: 6, unit: "pcs", fromNeedIds: [] }];
    const compiled = await purchasing.compilePurchaseRequest(deptHeadId, compileInput(deptId, { lines }));
    createdRequestIds.push(compiled.id);

    await purchasing.decideStep(deanId, compiled.id, "REVISE", "Reduce computers by 2");
    await purchasing.reviseAndResubmit(deptHeadId, compiled.id, compileInput(deptId, { lines: [{ ...lines[0], qty: 4 }] }));
    await purchasing.decideStep(deanId, compiled.id, "APPROVE");
    await purchasing.decideStep(avpId, compiled.id, "REVISE", "Add unit costs");
    await purchasing.reviseAndResubmit(deptHeadId, compiled.id, compileInput(deptId, { lines: [{ ...lines[0], qty: 4, estimatedUnitCost: 900 }] }));
    await purchasing.decideStep(deanId, compiled.id, "APPROVE");
    await purchasing.decideStep(avpId, compiled.id, "APPROVE");
    const final = await purchasing.decideStep(procurementUserId, compiled.id, "APPROVE", "Budget line confirmed");

    expect(final.stage).toBe("ORDER_PLACED");
    expect(final.history.map((h) => [h.stage, h.byId])).toEqual([
      ["APPROVING", deptHeadId], // submitted
      ["REVISING", deanId],
      ["APPROVING", deptHeadId], // resubmitted
      ["APPROVING", deanId], // approved
      ["REVISING", avpId],
      ["APPROVING", deptHeadId], // resubmitted
      ["APPROVING", deanId],
      ["APPROVING", avpId],
      ["APPROVING", procurementUserId],
      ["ORDER_PLACED", procurementUserId],
    ]);
    expect(final.history[1].note).toMatch(/^(?!Sent back).+: Reduce computers by 2$/);
    expect(final.history[4].note).toMatch(/Add unit costs$/);
    expect(final.history[8].note).toMatch(/^Approved — .+: Budget line confirmed$/);
  });

  it("the raising unit's members, the offices above it, need raisers and the store can read it; an unrelated head cannot", async () => {
    const deptHeadId = await makeUser("vis-dept-head", ["MANAGER"]);
    const deanId = await makeUser("vis-dean");
    const avpId = await makeUser("vis-avp");
    const { universityId, collegeId, deptId } = await makeChain("vis", deptHeadId);
    await setHead(collegeId, deanId);
    await setHead(universityId, avpId);
    await addClosure(universityId, collegeId, deptId);

    const memberId = await makeUser("vis-member", ["CUSTODIAN"]);
    await prisma.user.update({ where: { id: memberId }, data: { homeNodeId: deptId } });
    const storeKeeperId = await makeUser("vis-store", ["STORE_KEEPER"]);
    const otherHeadId = await makeUser("vis-other-head", ["MANAGER"]);
    await makeNode("vis-other-dept", "DEPARTMENT", 2, otherHeadId);
    const otherMemberId = await makeUser("vis-other-member", ["CUSTODIAN"]);

    const need = await purchasing.raiseNeed(memberId, { name: "Oscilloscope", qty: 1, reason: "Signals course" });
    createdNeedIds.push(need.id);
    const compiled = await purchasing.compilePurchaseRequest(deptHeadId, compileInput(deptId, { lines: [{ name: "Oscilloscope", qty: 1, fromNeedIds: [need.id] }] }));
    createdRequestIds.push(compiled.id);

    // A dean still following it after sending it back — no live step names them any more.
    await purchasing.decideStep(deanId, compiled.id, "REVISE", "Get a second quote");

    for (const readerId of [deptHeadId, memberId, deanId, avpId, procurementUserId, storeKeeperId, sysAdminId]) {
      const box = await purchasing.listForActor(readerId, "tracking");
      expect(box.map((r) => r.id)).toContain(compiled.id);
      await expect(purchasing.getRequest(readerId, compiled.id)).resolves.toMatchObject({ id: compiled.id, stage: "REVISING" });
    }
    for (const outsiderId of [otherHeadId, otherMemberId]) {
      const box = await purchasing.listForActor(outsiderId, "tracking");
      expect(box.map((r) => r.id)).not.toContain(compiled.id);
      await expect(purchasing.getRequest(outsiderId, compiled.id)).rejects.toMatchObject({ status: 404 });
    }

    const [mine] = (await purchasing.listMyNeeds(memberId)).filter((n) => n.id === need.id);
    expect([mine.status, mine.purchaseReference, mine.purchaseStage]).toEqual(["CARRIED", compiled.reference, "REVISING"]);
  });
});

describe("F-048 — estimated costs follow the same rule as item costs", () => {
  it("a unit's plain custodian sees the request but not the price; the head, the raiser and the purchasing roles do", async () => {
    const deptHeadId = await makeUser("cost-dept-head", ["MANAGER"]);
    const { deptId } = await makeChain("cost", deptHeadId);
    const memberId = await makeUser("cost-member", ["CUSTODIAN"]);
    await prisma.user.update({ where: { id: memberId }, data: { homeNodeId: deptId } });
    const storeKeeperId = await makeUser("cost-store", ["STORE_KEEPER"]);

    const compiled = await purchasing.compilePurchaseRequest(
      deptHeadId,
      compileInput(deptId, { lines: [{ name: "Digital balance", qty: 2, unit: "Unit", estimatedUnitCost: 45000, fromNeedIds: [] }] }),
    );
    createdRequestIds.push(compiled.id);

    const costSeenBy = async (readerId: string) => (await purchasing.getRequest(readerId, compiled.id)).lines[0].estimatedUnitCost;
    expect(await costSeenBy(memberId)).toBeNull();
    expect((await purchasing.listForActor(memberId, "tracking")).find((r) => r.id === compiled.id)!.lines[0].estimatedUnitCost).toBeNull();
    for (const readerId of [deptHeadId, procurementUserId, storeKeeperId, sysAdminId]) expect(await costSeenBy(readerId)).toBe(45000);

    // the raiser keeps the figure they typed, even without any cost-seeing role
    const raiserId = await makeUser("cost-raiser", ["CUSTODIAN"]);
    await setHead(deptId, raiserId); // occupancy makes them a head for this unit's compile
    const own = await purchasing.compilePurchaseRequest(raiserId, compileInput(deptId, { lines: [{ name: "Fume hood", qty: 1, unit: "Unit", estimatedUnitCost: 90000, fromNeedIds: [] }] }));
    createdRequestIds.push(own.id);
    expect(own.lines[0].estimatedUnitCost).toBe(90000);
    await setHead(deptId, deptHeadId);
  });
});
