import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** Approval notifications (lib/server/mail/notify.ts), captured instead of sent. */
const sent: { to: string; subject: string }[] = [];
vi.mock("../mail/mail", () => ({ send: async (m: { to: string; subject: string }) => void sent.push({ to: m.to, subject: m.subject }) }));

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
type ImportsModule = typeof import("./imports");
type AttachmentsModule = typeof import("./purchase-attachments");
type CategoriesModule = typeof import("./categories");
type PrismaModule = typeof import("../prisma");

let purchasing: PurchasingModule;
let imports: ImportsModule;
let procurements: typeof import("./procurements");
let attachments: AttachmentsModule;
let categories: CategoriesModule;
let prisma: PrismaModule["prisma"];

let sysAdminId: string;
let groupId: string;
let serializedCategoryId: string;
let bulkCategoryId: string;
/** Labs and stores are places; what they hold is a thing. */
let placeCategoryId: string;
let procurementNodeId: string;
let procurementUserId: string;
let realOfficeIdsToRestore: string[] = [];
/** A College Managing Director office this file owns — inactive unless a test turns it
 *  on, so every other test sees the shorter ladder whatever the shared DB holds. */
let cmdNodeId: string;
let cmdUserId: string;
let realCmdIdsToRestore: string[] = [];

const testKey = `__test-purchasing-${Date.now()}`;
const createdUserIds: string[] = [];
const createdNodeIds: string[] = [];
const createdItemIds: string[] = [];
const createdNeedIds: string[] = [];
const createdRequestIds: string[] = [];
const createdImportIds: string[] = [];

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
/** A lab owned by `ownerOrgNodeId` and run by `custodianId` — needs are raised for one. */
async function makeLab(ownerOrgNodeId: string, custodianId: string, name = "Purchasing Spec Lab"): Promise<string> {
  const lab = await prisma.item.create({
    data: { categoryId: placeCategoryId, name, countingMode: "SERIALIZED", status: "WORKING", ownerOrgNodeId, currentOrgNodeId: ownerOrgNodeId, custodianId },
  });
  createdItemIds.push(lab.id);
  return lab.id;
}

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

function compileInput(orgNodeId: string, over: Partial<{ title: string; lines: unknown[]; attachmentIds: string[] }> = {}) {
  return {
    title: over.title ?? "Test purchase request",
    orgNodeId,
    lines: over.lines ?? [{ name: "Digital balance", qty: 1, unit: "Unit", fromNeedIds: [] }],
    attachmentIds: over.attachmentIds ?? [],
  } as never;
}

beforeAll(async () => {
  purchasing = await import("./purchasing");
  imports = await import("./imports");
  procurements = await import("./procurements");
  attachments = await import("./purchase-attachments");
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
    isPlace: false,
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
    isPlace: false,
    fields: [],
    templateChildren: [],
  });
  bulkCategoryId = bulk.id;
  placeCategoryId = (
    await categories.create(sysAdminId, { key: `${testKey}-place`, name: "Purchasing Test Place", iconKey: "Warehouse", groupId, countingMode: "SERIALIZED", impairRule: "NEVER", isPlace: true, fields: [], templateChildren: [] })
  ).id;

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

  // Same for the College Managing Director: park any real one (by code or exact name),
  // then add this file's own under the exact name findCmdOffice falls back to.
  const realCmd = await prisma.orgNode.findMany({ where: { kind: "OFFICE", active: true, OR: [{ code: "CMD" }, { name: "College Managing Director" }] } });
  if (realCmd.length) {
    realCmdIdsToRestore = realCmd.map((o) => o.id);
    await prisma.orgNode.updateMany({ where: { id: { in: realCmdIdsToRestore } }, data: { active: false } });
  }
  cmdUserId = await makeUser("cmd", ["MANAGER"]);
  cmdNodeId = await makeNode("cmd-office", "OFFICE", 1, cmdUserId);
  await prisma.orgNode.update({ where: { id: cmdNodeId }, data: { name: "College Managing Director", active: false } });
});

/** Subjects mailed to this user since `from` (an index into `sent`). */
async function mailedTo(userId: string, from: number): Promise<string[]> {
  const { email } = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
  return sent.slice(from).filter((m) => m.to === email).map((m) => m.subject);
}

/** Runs `fn` with this file's College Managing Director office active. */
async function withCmdOffice<T>(fn: () => Promise<T>): Promise<T> {
  await prisma.orgNode.update({ where: { id: cmdNodeId }, data: { active: true } });
  try {
    return await fn();
  } finally {
    await prisma.orgNode.update({ where: { id: cmdNodeId }, data: { active: false } });
  }
}

afterAll(async () => {
  // Attachment bytes live in storage, not the database: remove them before their rows go
  // (with their requests, or as unsent files of test users, whose deletion they'd block).
  const { attachmentStorage } = await import("./storage");
  const files = await prisma.purchaseAttachment.findMany({ where: { OR: [{ uploadedById: { in: createdUserIds } }, { purchaseId: { in: createdRequestIds } }] } });
  for (const f of files) await attachmentStorage.remove(f.storageKey);
  await prisma.purchaseAttachment.deleteMany({ where: { id: { in: files.map((f) => f.id) } } });
  // Import records first: their lines hold the test categories and their creators are test users.
  await prisma.importRecord.deleteMany({ where: { OR: [{ id: { in: createdImportIds } }, { createdById: { in: createdUserIds } }] } });
  // Procurements started by the test procurement office (their lines, links and events cascade).
  await prisma.procurement.deleteMany({ where: { createdById: { in: createdUserIds } } });
  // Stock loaded into a test store that a failed assertion never got to record.
  const strays = await prisma.item.findMany({ where: { parentId: { in: createdItemIds } }, select: { id: true } });
  createdItemIds.push(...strays.map((i) => i.id).filter((id) => !createdItemIds.includes(id)));
  await prisma.itemChange.deleteMany({ where: { OR: [{ itemId: { in: createdItemIds } }, { categoryId: { in: [serializedCategoryId, bulkCategoryId, placeCategoryId] } }] } });
  // Children (received stock) before parents (the store item itself) — Item.parentId
  // is RESTRICT, and a single deleteMany over both in one batch isn't guaranteed to
  // order itself child-first.
  await prisma.item.deleteMany({ where: { id: { in: createdItemIds }, parentId: { not: null } } });
  await prisma.item.deleteMany({ where: { id: { in: createdItemIds } } });
  await prisma.purchaseRequest.deleteMany({ where: { id: { in: createdRequestIds } } }); // cascades lines/events/steps
  await prisma.needLine.deleteMany({ where: { id: { in: createdNeedIds } } });
  await prisma.orgNode.deleteMany({ where: { id: { in: createdNodeIds } } });
  await prisma.resourceCategory.deleteMany({ where: { id: { in: [serializedCategoryId, bulkCategoryId, placeCategoryId] } } });
  await prisma.categoryGroup.delete({ where: { id: groupId } });
  await prisma.userRole.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  if (realOfficeIdsToRestore.length) {
    await prisma.orgNode.updateMany({ where: { id: { in: realOfficeIdsToRestore } }, data: { active: true } });
  }
  if (realCmdIdsToRestore.length) {
    await prisma.orgNode.updateMany({ where: { id: { in: realCmdIdsToRestore } }, data: { active: true } });
  }
  await prisma.$disconnect();
});

describe("needs: raise, browse, decline", () => {
  it("raises a need at the actor's own home unit, and a head can decline it with a note", async () => {
    const headId = await makeUser("needs-head", ["MANAGER"]);
    const { deptId } = await makeChain("needs", headId);
    const staffId = await makeUser("needs-staff", ["CUSTODIAN"]);
    await setHead(deptId, headId);
    await prisma.user.update({ where: { id: staffId }, data: { homeNodeId: deptId } });

    const need = await purchasing.raiseNeed(staffId, { labItemId: await makeLab(deptId, staffId), name: "Digital balance", qty: 1, reason: "Ours is broken", priority: "ESSENTIAL", kind: "NEW" });
    createdNeedIds.push(need.id);
    expect(need.status).toBe("OPEN");
    expect(need.orgNodeId).toBe(deptId);

    const open = await purchasing.listOpenNeeds(headId, deptId);
    expect(open.map((n) => n.id)).toContain(need.id);

    const declined = await purchasing.declineNeed(headId, need.id, { note: "Not this quarter" });
    expect(declined.status).toBe("DECLINED");
    expect(declined.note).toBe("Not this quarter");
  });

  it("only a custodian raises a need, and only for a lab they run", async () => {
    const studentId = await makeUser("needs-not-custodian", ["MANAGER"]);
    const { deptId } = await makeChain("needs-student-chain", studentId);
    await prisma.user.update({ where: { id: studentId }, data: { homeNodeId: deptId } });
    const labId = await makeLab(deptId, studentId);
    await expect(purchasing.raiseNeed(studentId, { labItemId: labId, name: "x", qty: 1, reason: "y", priority: "IMPORTANT", kind: "NEW" })).rejects.toMatchObject({ status: 403 });

    const otherCustodianId = await makeUser("needs-other-custodian", ["CUSTODIAN"]);
    await prisma.user.update({ where: { id: otherCustodianId }, data: { homeNodeId: deptId } });
    await expect(purchasing.raiseNeed(otherCustodianId, { labItemId: labId, name: "x", qty: 1, reason: "y", priority: "IMPORTANT", kind: "NEW" })).rejects.toMatchObject({ status: 404 });
  });

  it("a broken item is suggested for replacement until one is asked for, and an unhandled need can be withdrawn", async () => {
    const headId = await makeUser("repl-head", ["MANAGER"]);
    const { deptId } = await makeChain("repl", headId);
    await setHead(deptId, headId);
    const custodianId = await makeUser("repl-custodian", ["CUSTODIAN"]);
    await prisma.user.update({ where: { id: custodianId }, data: { homeNodeId: deptId } });
    const labId = await makeLab(deptId, custodianId, "Replacement Lab");
    const broken = await prisma.item.create({
      data: { categoryId: serializedCategoryId, name: "Balance 02", countingMode: "SERIALIZED", status: "BROKEN", parentId: labId, ownerOrgNodeId: deptId, currentOrgNodeId: deptId, custodianId },
    });
    createdItemIds.push(broken.id);

    const suggested = (rows: Awaited<ReturnType<typeof purchasing.replacementSuggestions>>) => rows.flatMap((r) => r.items.map((i) => i.id));
    expect(suggested(await purchasing.replacementSuggestions(custodianId))).toContain(broken.id);
    expect(suggested(await purchasing.replacementSuggestions(headId, deptId))).toContain(broken.id);

    const need = await purchasing.raiseNeed(custodianId, { labItemId: labId, name: "Analytical balance", qty: 1, reason: "Balance 02 is broken", priority: "ESSENTIAL", kind: "REPLACEMENT", replacesItemIds: [broken.id] });
    createdNeedIds.push(need.id);
    expect(need).toMatchObject({ kind: "REPLACEMENT", replacesItems: [{ id: broken.id, name: "Balance 02" }], categoryId: serializedCategoryId, labName: "Replacement Lab" });
    expect(suggested(await purchasing.replacementSuggestions(custodianId))).not.toContain(broken.id);
    await expect(purchasing.raiseNeed(custodianId, { labItemId: labId, name: "Again", qty: 1, reason: "y", priority: "IMPORTANT", kind: "REPLACEMENT", replacesItemIds: [broken.id] })).rejects.toMatchObject({ status: 409 });

    await expect(purchasing.withdrawNeed(headId, need.id)).rejects.toMatchObject({ status: 404 });
    await purchasing.withdrawNeed(custodianId, need.id);
    expect(await prisma.needLine.findUnique({ where: { id: need.id } })).toBeNull();
  });
});

describe("compilePurchaseRequest: the org chart as the ladder", () => {
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
    expect(result.steps.map((s) => s.selector)).toEqual(["OWNER_HEAD", "HIERARCHY", "OWNER_ANCESTOR", "NODE_OCCUPANT"]);
    expect(result.steps[0].approverId).toBe(deptHeadId);
    expect(result.steps[1].approverId).toBe(collegeHeadId);
    expect(result.steps[2].approverId).toBe(universityHeadId);
    expect(result.steps[3].approverId).toBe(procurementUserId);
  });

  it("with a College Managing Director office, the ladder is head, dean, CMD, AVP, then Procurement", async () => {
    await withCmdOffice(async () => {
      const deptHeadId = await makeUser("cmd-chain-dept-head", ["MANAGER"]);
      const deanId = await makeUser("cmd-chain-dean");
      const avpId = await makeUser("cmd-chain-avp");
      const { universityId, collegeId, deptId } = await makeChain("cmd-chain", deptHeadId);
      await setHead(collegeId, deanId);
      await setHead(universityId, avpId);

      let mark = sent.length;
      const result = await purchasing.compilePurchaseRequest(deptHeadId, compileInput(deptId));
      createdRequestIds.push(result.id);
      // Each approver is told when the request reaches them — and only then.
      expect(await mailedTo(deanId, mark)).toEqual([`${result.reference} is waiting for your approval`]);
      expect(await mailedTo(cmdUserId, mark)).toEqual([]);
      expect(await mailedTo(deptHeadId, mark)).toEqual([]); // not about their own action
      expect(result.steps.map((s) => s.selector)).toEqual(["OWNER_HEAD", "HIERARCHY", "NODE_OCCUPANT", "OWNER_ANCESTOR", "NODE_OCCUPANT"]);
      expect(result.steps.map((s) => s.approverId)).toEqual([deptHeadId, deanId, cmdUserId, avpId, procurementUserId]);
      expect(result.steps[2].label).toBe("College Managing Director");

      // The CMD decides only in turn: after the dean, and before the AVP.
      await expect(purchasing.decideStep(cmdUserId, result.id, "APPROVE")).rejects.toMatchObject({ status: 403 });
      mark = sent.length;
      await purchasing.decideStep(deanId, result.id, "APPROVE");
      expect(await mailedTo(cmdUserId, mark)).toEqual([`${result.reference} is waiting for your approval`]);
      // Named on the chain, so the CMD can follow it, and it is in their inbox now.
      expect((await purchasing.getRequest(cmdUserId, result.id)).id).toBe(result.id);
      expect((await purchasing.listForActor(cmdUserId, "inbox")).map((r) => r.id)).toContain(result.id);
      await expect(purchasing.decideStep(avpId, result.id, "APPROVE")).rejects.toMatchObject({ status: 403 });

      mark = sent.length;
      const afterCmd = await purchasing.decideStep(cmdUserId, result.id, "APPROVE", "Within the college budget");
      expect(await mailedTo(avpId, mark)).toEqual([`${result.reference} is waiting for your approval`]);
      expect(afterCmd.stage).toBe("APPROVING");
      expect(afterCmd.steps[2]).toMatchObject({ status: "APPROVED", decidedById: cmdUserId });
      await expect(purchasing.decideStep(procurementUserId, result.id, "APPROVE")).rejects.toMatchObject({ status: 403 });

      mark = sent.length;
      await purchasing.decideStep(avpId, result.id, "APPROVE");
      expect(await mailedTo(procurementUserId, mark)).toEqual([`${result.reference} is waiting for your approval`]);
      mark = sent.length;
      const done = await purchasing.decideStep(procurementUserId, result.id, "APPROVE");
      expect(done.stage).toBe("WITH_PROCUREMENT");
      // Procurement's approval starts the purchase: the head hears that, once.
      expect(await mailedTo(deptHeadId, mark)).toEqual([`${done.procurement!.reference}: procurement started buying your request`]);
    });
  });

  it("a CMD send-back returns the request to the head, and resubmitting starts again at the dean", async () => {
    await withCmdOffice(async () => {
      const deptHeadId = await makeUser("cmd-revise-dept-head", ["MANAGER"]);
      const deanId = await makeUser("cmd-revise-dean");
      const avpId = await makeUser("cmd-revise-avp");
      const { universityId, collegeId, deptId } = await makeChain("cmd-revise", deptHeadId);
      await setHead(collegeId, deanId);
      await setHead(universityId, avpId);
      const compiled = await purchasing.compilePurchaseRequest(deptHeadId, compileInput(deptId));
      createdRequestIds.push(compiled.id);
      await purchasing.decideStep(deanId, compiled.id, "APPROVE");

      const mark = sent.length;
      const revised = await purchasing.decideStep(cmdUserId, compiled.id, "REVISE", "Split the order by quarter");
      expect(revised.stage).toBe("REVISING");
      expect(await mailedTo(deptHeadId, mark)).toEqual([`${compiled.reference} was sent back for revision`]);
      const again = await purchasing.reviseAndResubmit(deptHeadId, compiled.id, compileInput(deptId, { title: "Split by quarter" }));
      expect(again.stage).toBe("APPROVING");
      expect(again.steps).toHaveLength(5);
      expect(again.steps.find((s) => s.status === "PENDING")?.approverId).toBe(deanId);
    });
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
    const carryCustodianId = await makeUser("carry-custodian", ["CUSTODIAN"]);
    await prisma.user.update({ where: { id: carryCustodianId }, data: { homeNodeId: deptId } });
    const need = await purchasing.raiseNeed(carryCustodianId, { labItemId: await makeLab(deptId, carryCustodianId), name: "Fume hood", qty: 1, reason: "None in the lab", priority: "IMPORTANT", kind: "NEW" });
    createdNeedIds.push(need.id);

    const result = await purchasing.compilePurchaseRequest(headId, compileInput(deptId, { lines: [{ name: "Fume hood", qty: 1, unit: "Unit", fromNeedIds: [need.id] }] }));
    createdRequestIds.push(result.id);

    expect(result.lines[0].fromNeedIds).toEqual([need.id]);
    const refreshedNeed = await prisma.needLine.findUniqueOrThrow({ where: { id: need.id } });
    expect(refreshedNeed.status).toBe("CARRIED");
    expect(refreshedNeed.purchaseLineId).toBe(result.lines[0].id);
  });
});

describe("decideStep: vacancy, handoff, reject, revise", () => {
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

  it("a vacant college deanship blocks (undecidable by anyone) and appointing someone unblocks it immediately", async () => {
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

  it("the full happy path settles with procurement once every remaining step approves: dept head, dean, AVP, then Procurement", async () => {
    const { requestId, collegeHeadId, universityHeadId } = await setUpChain("happy");
    let decided = await purchasing.decideStep(collegeHeadId, requestId, "APPROVE");
    expect(decided.stage).toBe("APPROVING"); // still waiting on the university/AVP and Procurement steps
    decided = await purchasing.decideStep(universityHeadId, requestId, "APPROVE");
    expect(decided.stage).toBe("APPROVING"); // still waiting on Procurement
    decided = await purchasing.decideStep(procurementUserId, requestId, "APPROVE");
    expect(decided.stage).toBe("WITH_PROCUREMENT");
    expect(decided.history.some((h) => h.stage === "WITH_PROCUREMENT")).toBe(true);
    expect(decided.procurement?.stage).toBe("PREPARING");
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

  it("F-047: the raiser cannot cancel once procurement has it: only procurement can, with a note, and not while a procurement buys it", async () => {
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
    expect(decided.stage).toBe("WITH_PROCUREMENT");

    await expect(purchasing.cancelPurchaseRequest(deptHeadId, result.id)).rejects.toMatchObject({ status: 409 });
    // A procurement is buying it: that is what procurement cancels or edits.
    await expect(purchasing.cancelPurchaseRequest(procurementUserId, result.id, "No longer needed")).rejects.toMatchObject({ status: 409 });
    await procurements.cancelProcurement(procurementUserId, decided.procurement!.id, { note: "Tender failed" });

    const outsiderId = await makeUser("f047-outsider");
    await expect(purchasing.cancelPurchaseRequest(outsiderId, result.id, "trying anyway")).rejects.toMatchObject({ status: 403 });

    await expect(purchasing.cancelPurchaseRequest(procurementUserId, result.id)).rejects.toMatchObject({ status: 400 });

    const cancelled = await purchasing.cancelPurchaseRequest(procurementUserId, result.id, "Supplier withdrew the offer").then(() => purchasing.getRequest(procurementUserId, result.id));
    expect(cancelled.stage).toBe("CANCELLED");
    expect(cancelled.history.at(-1)?.note).toContain("Supplier withdrew the offer");
  });

  it("F-046: rejecting or cancelling a request reopens the needs it carried", async () => {
    const staffId = await makeUser("f046-staff", ["CUSTODIAN"]);
    const headId = await makeUser("f046-head", ["MANAGER"]);
    const collegeHeadId = await makeUser("f046-college-head");
    const { collegeId, deptId } = await makeChain("f046", headId);
    await setHead(collegeId, collegeHeadId);
    await prisma.user.update({ where: { id: staffId }, data: { homeNodeId: deptId } });

    const need = await purchasing.raiseNeed(staffId, { labItemId: await makeLab(deptId, staffId), name: "F046 Projector", qty: 1, reason: "Ours broke", priority: "IMPORTANT", kind: "NEW" });
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

describe("procurement and receiving", () => {
  /** Walks a fresh request all the way to ORDER_PLACED via real decisions — the
   *  compiling head's own step self-skips, so college dean → university/AVP →
   *  Procurement are the three that actually have to approve. Procurement's approval
   *  starts a procurement for it; placing that on EGP puts the request at ORDER_PLACED. */
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
    expect(settled.stage).toBe("WITH_PROCUREMENT");
    expect(settled.procurement?.reference).toMatch(/^PROC-\d{4}-\d{3}$/);
    const procurementId = settled.procurement!.id;
    const placed = await procurements.moveProcurement(procurementUserId, procurementId, { stage: "PLACED_ON_EGP", egpReference: `EGP-${prefix}` });
    expect(placed.stage).toBe("PLACED_ON_EGP");
    expect((await purchasing.getRequest(procurementUserId, result.id)).stage).toBe("ORDER_PLACED");
    return { requestId: result.id, deptId, lineId: result.lines[0].id, procurementId };
  }

  it("the procurement moves forward freely, procurement-only; its request follows it", async () => {
    const { requestId, procurementId } = await setUpAtOrderPlaced("pipeline");
    const nonProcId = await makeUser("pipeline-non-proc");
    await expect(procurements.moveProcurement(nonProcId, procurementId, { stage: "BUYER_FOUND" })).rejects.toMatchObject({ status: 403 });
    await expect(procurements.moveProcurement(procurementUserId, procurementId, { stage: "PREPARING" })).rejects.toMatchObject({ status: 409 });

    // Straight from placed to on delivery: a later stage in one move.
    let proc = await procurements.moveProcurement(procurementUserId, procurementId, { stage: "ON_DELIVERY" });
    expect((await purchasing.getRequest(procurementUserId, requestId)).stage).toBe("ON_DELIVERY");
    proc = await procurements.moveProcurement(procurementUserId, procurementId, { stage: "ARRIVED", arrived: [{ lineId: proc.lines[0].id, qty: 2 }] });
    expect(proc.lines[0].arrivedQty).toBe(2);
    expect(proc.events.at(-1)?.lineChanges).toEqual(["Balance: 3 bought, 2 came (Unit)"]);
    expect((await purchasing.getRequest(procurementUserId, requestId)).stage).toBe("IN_STORE");
    await expect(procurements.moveProcurement(procurementUserId, procurementId, { stage: "CLOSED" })).rejects.toMatchObject({ status: 409 });

    const receivingId = await makeUser("pipeline-receiving-keeper", ["STORE_KEEPER"]);
    expect((await purchasing.listForActor(receivingId, "receiving")).map((r) => r.id)).toContain(requestId);
    await expect(purchasing.listForActor(nonProcId, "pipeline")).rejects.toMatchObject({ status: 403 });
  });

  it("one procurement buys several requests, its lines are edited with a reason, and shrinking a line tells the raiser", async () => {
    const a = await setUpAtOrderPlaced("combine-a");
    const deptHeadId = await makeUser("combine-b-dept-head", ["MANAGER"]);
    const collegeHeadId = await makeUser("combine-b-college-head");
    const universityHeadId = await makeUser("combine-b-university-head");
    const { universityId, collegeId, deptId } = await makeChain("combine-b", deptHeadId);
    await setHead(collegeId, collegeHeadId);
    await setHead(universityId, universityHeadId);
    const b = await purchasing.compilePurchaseRequest(deptHeadId, compileInput(deptId, { lines: [{ name: "Chair", qty: 40, unit: "Unit", fromNeedIds: [] }] }));
    createdRequestIds.push(b.id);
    await purchasing.decideStep(collegeHeadId, b.id, "APPROVE");
    await purchasing.decideStep(universityHeadId, b.id, "APPROVE");
    // Already placed: a request can't join it any more; a new one is started instead.
    await expect(purchasing.decideStep(procurementUserId, b.id, "APPROVE", undefined, [], a.procurementId)).rejects.toMatchObject({ status: 409 });
    expect((await purchasing.getRequest(procurementUserId, b.id)).stage).toBe("APPROVING"); // nothing was decided

    // Started on its own, with a second request joining while it is being prepared.
    const started = await purchasing.decideStep(procurementUserId, b.id, "APPROVE");
    const proc = await procurements.getProcurement(procurementUserId, started.procurement!.id);
    expect(proc.lines.map((l) => [l.name, l.qty, l.purchaseReference])).toEqual([["Chair", 40, b.reference]]);
    expect(await procurements.waitingRequests(procurementUserId).then((w) => w.map((r) => r.id))).not.toContain(b.id);

    const mark = sent.length;
    const edited = await procurements.editLines(procurementUserId, proc.id, { lines: [{ ...proc.lines[0], qty: 32 }], reason: "Only 32 in the tender" });
    expect(edited.events.at(-1)?.lineChanges).toEqual(["Chair: 40 → 32 Unit"]);
    expect(await mailedTo(deptHeadId, mark)).toEqual([`${proc.reference}: less will be bought than you asked for`]);
  });

  it("a standalone EGP purchase needs its EGP number and its lines; while preparing, requests join it", async () => {
    await expect(procurements.startProcurement(procurementUserId, { requestIds: [], egpReference: "EGP-77", lines: [] })).rejects.toMatchObject({ status: 400 });
    await expect(procurements.startProcurement(procurementUserId, { requestIds: [], lines: [{ name: "Toner", qty: 10 }] })).rejects.toMatchObject({ status: 400 });
    const solo = await procurements.startProcurement(procurementUserId, { requestIds: [], egpReference: "EGP-77", lines: [{ name: "Toner", qty: 10, unitCost: 1200 }] });
    expect([solo.stage, solo.requests.length, solo.total]).toEqual(["PREPARING", 0, 12000]);

    const edited = await procurements.editLines(procurementUserId, solo.id, { lines: [{ id: solo.lines[0].id, name: "Toner", qty: 8, unitCost: 1200 }, { name: "Paper", qty: 50 }], reason: "Only 8 in stock" });
    expect(edited.events.at(-1)?.lineChanges).toEqual(["Toner: 10 → 8", "+ Paper: 50"]);
    const cancelled = await procurements.cancelProcurement(procurementUserId, solo.id, { note: "Bought locally instead" });
    expect(cancelled.stage).toBe("CANCELLED");
  });

  /** Walks a fresh request on to IN_STORE, with a store the keeper holds. */
  async function setUpInStore(prefix: string, lines?: unknown[], bulk = false) {
    const at = await setUpAtOrderPlaced(prefix, lines);
    await procurements.moveProcurement(procurementUserId, at.procurementId, { stage: "ARRIVED" }); // the request is now IN_STORE
    const keeperId = await makeUser(`${prefix}-keeper`, ["STORE_KEEPER"]);
    const propertyId = await makeUser(`${prefix}-property`, ["PROPERTY_ADMIN"]);
    const storeItem = await prisma.item.create({
      data: {
        categoryId: placeCategoryId,
        name: `${prefix} Store`,
        countingMode: "SERIALIZED",
        status: "WORKING",
        ownerOrgNodeId: at.deptId,
        currentOrgNodeId: at.deptId,
        custodianId: keeperId,
      },
    });
    createdItemIds.push(storeItem.id);
    return { ...at, keeperId, propertyId, storeId: storeItem.id };
  }

  /** Records what arrived from the procurement buying the request (each request line
   *  mapped to the procurement line that bought it). */
  async function record(propertyId: string, requestId: string, lines: Array<{ name: string; categoryId: string; qty: number; purchaseLineId?: string; spec?: string }>) {
    const link = await prisma.procurementRequest.findFirstOrThrow({ where: { purchaseRequestId: requestId }, include: { procurement: { include: { lines: true } } } });
    const mapped = lines.map(({ purchaseLineId, ...l }) => ({ ...l, procurementLineId: link.procurement.lines.find((p) => p.purchaseLineId === purchaseLineId)?.id }));
    const dto = await imports.createImport(propertyId, { source: "PROCUREMENT", procurementId: link.procurementId, lines: mapped });
    createdImportIds.push(dto.id);
    return dto;
  }

  async function itemsIn(storeId: string) {
    const rows = await prisma.item.findMany({ where: { parentId: storeId } });
    createdItemIds.push(...rows.filter((i) => !createdItemIds.includes(i.id)).map((i) => i.id));
    return rows;
  }

  it("Property Administration records the procurement's arrival (never above what came); loading it all closes the procurement and its request", async () => {
    const s = await setUpInStore("proc-import");
    const proc = await procurements.getProcurement(procurementUserId, s.procurementId);
    const line = { name: "Balance", categoryId: serializedCategoryId, procurementLineId: proc.lines[0].id };
    await expect(imports.createImport(s.propertyId, { source: "PROCUREMENT", procurementId: s.procurementId, lines: [{ ...line, qty: 4 }] })).rejects.toMatchObject({ status: 409 });
    const rec = await imports.createImport(s.propertyId, { source: "PROCUREMENT", procurementId: s.procurementId, lines: [{ ...line, qty: 3 }] });
    createdImportIds.push(rec.id);
    expect([rec.procurementReference, rec.egpReference, rec.lines[0].purchaseLineId]).toEqual([proc.reference, "EGP-proc-import", s.lineId]);

    const mark = sent.length;
    await imports.loadImportLine(s.keeperId, rec.id, { lineId: rec.lines[0].id, qty: 3, storeParentId: s.storeId });
    await itemsIn(s.storeId);
    expect((await procurements.getProcurement(procurementUserId, s.procurementId)).stage).toBe("CLOSED");
    const req = await purchasing.getRequest(procurementUserId, s.requestId);
    expect([req.stage, req.lines[0].receivedQty]).toEqual(["CLOSED", 3]);
    const raiser = (await prisma.purchaseRequest.findUniqueOrThrow({ where: { id: s.requestId } })).raisedById;
    expect(await mailedTo(raiser, mark)).toEqual([`${proc.reference} is in the store`]);
  });

  it("arrival at the store tells Property Administration, who records it; only they may", async () => {
    const at = await setUpAtOrderPlaced("arrival-mail");
    const propertyId = await makeUser("arrival-mail-property", ["PROPERTY_ADMIN"]);
    const mark = sent.length;
    const arrived = await procurements.moveProcurement(procurementUserId, at.procurementId, { stage: "ARRIVED" });
    expect(await mailedTo(propertyId, mark)).toEqual([`${arrived.reference} has arrived at the main store`]);
    expect((await purchasing.listForActor(propertyId, "receiving")).map((r) => r.id)).toContain(at.requestId);

    const keeperId = await makeUser("arrival-mail-keeper", ["STORE_KEEPER"]);
    await expect(imports.createImport(keeperId, { source: "PURCHASE_REQUEST", purchaseRequestId: at.requestId, lines: [{ name: "Balance", categoryId: serializedCategoryId, qty: 3 }] })).rejects.toMatchObject({ status: 403 });
  });

  it("refuses an import record for a request that hasn't arrived yet", async () => {
    const at = await setUpAtOrderPlaced("import-early");
    const propertyId = await makeUser("import-early-property", ["PROPERTY_ADMIN"]);
    await expect(record(propertyId, at.requestId, [{ name: "Balance", categoryId: serializedCategoryId, qty: 3, purchaseLineId: at.lineId }])).rejects.toMatchObject({ status: 409 });
  });

  it("an import (SERIALIZED) is loaded in parts: real Items, counted on the request, which closes once complete", async () => {
    const s = await setUpInStore("import-ser");
    let mark = sent.length;
    const dto = await record(s.propertyId, s.requestId, [{ name: "Balance", categoryId: serializedCategoryId, qty: 3, purchaseLineId: s.lineId, spec: "Ohaus PX224" }]);
    expect(dto.reference).toMatch(/^IMP-\d{4}-\d{3}$/);
    expect(await mailedTo(s.keeperId, mark)).toEqual([`${dto.reference} is ready to load into the store`]);

    const nonKeeperId = await makeUser("import-ser-nonkeeper");
    await expect(imports.loadImportLine(nonKeeperId, dto.id, { lineId: dto.lines[0].id, qty: 1, storeParentId: s.storeId })).rejects.toMatchObject({ status: 403 });

    const partial = await imports.loadImportLine(s.keeperId, dto.id, { lineId: dto.lines[0].id, qty: 2, storeParentId: s.storeId });
    expect([partial.status, partial.lines[0].loadedQty]).toEqual(["OPEN", 2]);
    let req = await purchasing.getRequest(s.keeperId, s.requestId);
    expect([req.stage, req.lines[0].receivedQty]).toEqual(["IN_STORE", 2]);
    const firstTwo = await itemsIn(s.storeId);
    expect(firstTwo).toHaveLength(2);
    // Named after what was ordered, not the category's generic default.
    expect(firstTwo.every((i) => i.name.startsWith("Balance"))).toBe(true);
    const log = await prisma.itemChange.findFirstOrThrow({ where: { itemId: firstTwo[0].id, kind: "createItem" } });
    expect(log.note).toContain(`Loaded from import ${dto.reference}: Ohaus PX224`);

    mark = sent.length;
    const complete = await imports.loadImportLine(s.keeperId, dto.id, { lineId: dto.lines[0].id, qty: 1, storeParentId: s.storeId });
    expect(complete.status).toBe("LOADED");
    req = await purchasing.getRequest(s.keeperId, s.requestId);
    expect([req.stage, req.lines[0].receivedQty]).toEqual(["CLOSED", 3]);
    expect(await itemsIn(s.storeId)).toHaveLength(3);
    expect(await mailedTo(req.raisedById, mark)).toEqual([`${req.procurement!.reference} is in the store`]);
  });

  it("an import (BULK) loads one item holding the quantity, via the ordinary setQuantity path", async () => {
    const s = await setUpInStore("import-bulk", [{ name: "Ethanol", qty: 5, unit: "L", fromNeedIds: [] }], true);
    const dto = await record(s.propertyId, s.requestId, [{ name: "Ethanol", categoryId: bulkCategoryId, qty: 5, purchaseLineId: s.lineId }]);
    expect((await imports.loadImportLine(s.keeperId, dto.id, { lineId: dto.lines[0].id, qty: 5, storeParentId: s.storeId })).status).toBe("LOADED");
    expect((await purchasing.getRequest(s.keeperId, s.requestId)).stage).toBe("CLOSED");
    const created = await itemsIn(s.storeId);
    expect(created).toHaveLength(1);
    expect(Number(created[0].qty)).toBe(5);
    expect(created[0].name.startsWith("Ethanol")).toBe(true);
  });

  it("F-045: an import line must be the category its request line ordered", async () => {
    const s = await setUpInStore("f045-category", [{ name: "Oscilloscope", qty: 1, unit: "Unit", categoryId: serializedCategoryId, fromNeedIds: [] }]);
    await expect(record(s.propertyId, s.requestId, [{ name: "Oscilloscope", categoryId: bulkCategoryId, qty: 1, purchaseLineId: s.lineId }])).rejects.toMatchObject({ status: 400 });
  });

  it("F-045: refuses recording more than was ordered, or loading more than was recorded", async () => {
    const s = await setUpInStore("f045-over", [{ name: "Balance", qty: 10, unit: "L", fromNeedIds: [] }], true);
    await expect(record(s.propertyId, s.requestId, [{ name: "Balance", categoryId: bulkCategoryId, qty: 500, purchaseLineId: s.lineId }])).rejects.toMatchObject({ status: 409 });
    const dto = await record(s.propertyId, s.requestId, [{ name: "Balance", categoryId: bulkCategoryId, qty: 6, purchaseLineId: s.lineId }]);
    // A second record may only cover what is left on the order.
    await expect(record(s.propertyId, s.requestId, [{ name: "Balance", categoryId: bulkCategoryId, qty: 5, purchaseLineId: s.lineId }])).rejects.toMatchObject({ status: 409 });
    await expect(imports.loadImportLine(s.keeperId, dto.id, { lineId: dto.lines[0].id, qty: 7, storeParentId: s.storeId })).rejects.toMatchObject({ status: 409 });
    const untouched = await purchasing.getRequest(s.keeperId, s.requestId);
    expect([untouched.stage, untouched.lines[0].receivedQty]).toEqual(["IN_STORE", null]);
  });

  it("F-045: parallel loads of the same line sum correctly, no lost update", async () => {
    const s = await setUpInStore("f045-parallel", [{ name: "Ethanol", qty: 10, unit: "L", fromNeedIds: [] }], true);
    const dto = await record(s.propertyId, s.requestId, [{ name: "Ethanol", categoryId: bulkCategoryId, qty: 10, purchaseLineId: s.lineId }]);
    const results = await Promise.allSettled([
      imports.loadImportLine(s.keeperId, dto.id, { lineId: dto.lines[0].id, qty: 1, storeParentId: s.storeId }),
      imports.loadImportLine(s.keeperId, dto.id, { lineId: dto.lines[0].id, qty: 1, storeParentId: s.storeId }),
    ]);
    for (const r of results) if (r.status === "rejected") throw r.reason;
    expect((await imports.getImport(s.keeperId, dto.id)).lines[0].loadedQty).toBe(2);
    expect((await purchasing.getRequest(s.keeperId, s.requestId)).lines[0].receivedQty).toBe(2); // not 1 — the lost-update bug (B-10)
    expect(await itemsIn(s.storeId)).toHaveLength(2);
  });

  it("a standalone EGP record needs no purchase request, loads the same way, and can be cancelled only before loading", async () => {
    const s = await setUpInStore("import-egp");
    await expect(imports.createImport(s.propertyId, { source: "EGP", lines: [{ name: "Laptop", categoryId: serializedCategoryId, qty: 2 }] } as never)).rejects.toBeTruthy();
    const egp = await imports.createImport(s.propertyId, { source: "EGP", egpReference: "EGP-77/2026", supplier: "Abyssinia Tech", lines: [{ name: "Laptop", categoryId: serializedCategoryId, qty: 2 }, { name: "Mouse", categoryId: serializedCategoryId, qty: 2 }] });
    createdImportIds.push(egp.id);
    expect([egp.source, egp.purchaseRequestId, egp.egpReference]).toEqual(["EGP", null, "EGP-77/2026"]);

    await imports.loadImportLine(s.keeperId, egp.id, { lineId: egp.lines[0].id, qty: 2, storeParentId: s.storeId });
    await expect(imports.cancelImport(s.propertyId, egp.id, { note: "wrong supplier" })).rejects.toMatchObject({ status: 409 });
    expect((await imports.loadImportLine(s.keeperId, egp.id, { lineId: egp.lines[1].id, qty: 2, storeParentId: s.storeId })).status).toBe("LOADED");
    expect(await itemsIn(s.storeId)).toHaveLength(4);

    const spare = await imports.createImport(s.propertyId, { source: "EGP", egpReference: "EGP-78/2026", lines: [{ name: "Cable", categoryId: serializedCategoryId, qty: 1 }] });
    createdImportIds.push(spare.id);
    const cancelled = await imports.cancelImport(s.propertyId, spare.id, { note: "duplicate of EGP-77" });
    expect(cancelled.status).toBe("CANCELLED");
    await expect(imports.loadImportLine(s.keeperId, spare.id, { lineId: spare.lines[0].id, qty: 1, storeParentId: s.storeId })).rejects.toMatchObject({ status: 409 });
    // The store, procurement and Property Administration can all follow records; a head can't.
    expect((await imports.listImports(procurementUserId)).map((r) => r.id)).toEqual(expect.arrayContaining([egp.id, spare.id]));
    await expect(imports.listImports(await makeUser("import-egp-head", ["MANAGER"]))).rejects.toMatchObject({ status: 403 });
  });

  it("F-045: rejects a fractional quantity ordered against a SERIALIZED category, at compile time", async () => {
    const headId = await makeUser("f045-fraction-head", ["MANAGER"]);
    const { deptId } = await makeChain("f045-fraction", headId);
    await expect(
      purchasing.compilePurchaseRequest(headId, compileInput(deptId, { lines: [{ name: "Computer", qty: 2.5, unit: "Unit", categoryId: serializedCategoryId, fromNeedIds: [] }] })),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("history and visibility: every send-back is kept, everyone involved can follow it", () => {
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

  it("records submit, every decision with its note, and every resubmit: surviving REVISE clearing the steps", async () => {
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

    expect(final.stage).toBe("WITH_PROCUREMENT");
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
      ["WITH_PROCUREMENT", procurementUserId], // every approval in
      ["WITH_PROCUREMENT", procurementUserId], // procurement started buying it
    ]);
    expect(final.history[1].note).toMatch(/^(?!Sent back).+: Reduce computers by 2$/);
    expect(final.history[4].note).toMatch(/Add unit costs$/);
    expect(final.history[8].note).toMatch(/^Approved: .+: Budget line confirmed$/);
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

    const need = await purchasing.raiseNeed(memberId, { labItemId: await makeLab(deptId, memberId), name: "Oscilloscope", qty: 1, reason: "Signals course", priority: "IMPORTANT", kind: "NEW" });
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

describe("F-048: estimated costs follow the same rule as item costs", () => {
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

describe("attachments: minutes, letters and spreadsheets on a request", () => {
  /** A small but complete PDF; `tag` makes each one's bytes (and hash) distinct. */
  const pdf = (tag: string) => Buffer.from(`%PDF-1.4\n% ${tag}\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`, "latin1");
  const photo = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 250, g: 250, b: 245 } } }).png().toBuffer();

  async function ladder(prefix: string) {
    const deptHeadId = await makeUser(`${prefix}-dept-head`, ["MANAGER"]);
    const deanId = await makeUser(`${prefix}-dean`);
    const avpId = await makeUser(`${prefix}-avp`);
    const { universityId, collegeId, deptId } = await makeChain(prefix, deptHeadId);
    await setHead(collegeId, deanId);
    await setHead(universityId, avpId);
    return { deptHeadId, deanId, avpId, deptId };
  }

  it("a head submits with minutes and a photographed letter; the photo is stored as a smaller, upright JPEG", async () => {
    const { deptHeadId, deanId, deptId } = await ladder("att-submit");
    const minutes = await attachments.stage(deptHeadId, "Dept minutes 14.pdf", pdf("minutes-14"));
    const letter = await attachments.stage(deptHeadId, "letter.png", await photo(3000, 4000));
    expect(minutes).toMatchObject({ kind: "PDF", contentType: "application/pdf", fileName: "Dept minutes 14.pdf" });
    expect(letter).toMatchObject({ kind: "IMAGE", contentType: "image/jpeg", fileName: "letter.jpg" });

    const staged = await prisma.purchaseAttachment.findUniqueOrThrow({ where: { id: letter.id } });
    const stored = await (await import("./storage")).attachmentStorage.read(staged.storageKey);
    const meta = await sharp(stored!).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width!, meta.height!)).toBe(2200);

    const from = sent.length;
    const request = await purchasing.compilePurchaseRequest(deptHeadId, compileInput(deptId, { attachmentIds: [minutes.id, letter.id] }));
    createdRequestIds.push(request.id);
    expect(request.history[0].attachments.map((a) => a.fileName)).toEqual(["Dept minutes 14.pdf", "letter.jpg"]);
    const rows = await prisma.purchaseAttachment.findMany({ where: { id: { in: [minutes.id, letter.id] } } });
    expect(rows.every((r) => r.status === "ATTACHED" && r.purchaseId === request.id && r.expiresAt === null)).toBe(true);
    expect(await mailedTo(deanId, from)).toContain(`${request.reference} is waiting for your approval`);

    // Following the request is what lets you read its documents.
    await purchasing.assertCanReadRequest(deanId, request.id);
    const outsiderId = await makeUser("att-outsider", ["CUSTODIAN"]);
    await expect(purchasing.assertCanReadRequest(outsiderId, request.id)).rejects.toMatchObject({ status: 404 });
  });

  it("a dean rejects citing a letter; it stays on the REJECTED entry of the history", async () => {
    const { deptHeadId, deanId, deptId } = await ladder("att-reject");
    const request = await purchasing.compilePurchaseRequest(deptHeadId, compileInput(deptId));
    createdRequestIds.push(request.id);

    const circular = await attachments.stage(deanId, "Budget circular.pdf", pdf("circular"));
    const decided = await purchasing.decideStep(deanId, request.id, "REJECT", "Not within this year's allocation: see the circular", [circular.id]);
    expect(decided.stage).toBe("REJECTED");
    const entry = decided.history.at(-1)!;
    expect(entry.stage).toBe("REJECTED");
    expect(entry.attachments).toEqual([expect.objectContaining({ id: circular.id, uploadedById: deanId, fileName: "Budget circular.pdf" })]);
  });

  it("send-back and resubmission keep every earlier document, and the same file can't be attached twice", async () => {
    const { deptHeadId, deanId, deptId } = await ladder("att-revise");
    const minutes = await attachments.stage(deptHeadId, "minutes.pdf", pdf("revise-minutes"));
    const request = await purchasing.compilePurchaseRequest(deptHeadId, compileInput(deptId, { attachmentIds: [minutes.id] }));
    createdRequestIds.push(request.id);

    const note = await attachments.stage(deanId, "what's missing.pdf", pdf("revise-dean"));
    await purchasing.decideStep(deanId, request.id, "REVISE", "Attach the stamped authority letter", [note.id]);

    // The same minutes again, under another name: refused, and the resubmission with it rolled back.
    const again = await attachments.stage(deptHeadId, "minutes (1).pdf", pdf("revise-minutes"));
    await expect(purchasing.reviseAndResubmit(deptHeadId, request.id, compileInput(deptId, { attachmentIds: [again.id] }))).rejects.toMatchObject({ status: 409 });
    expect((await purchasing.getRequest(deptHeadId, request.id)).stage).toBe("REVISING");
    await attachments.discard(deptHeadId, again.id);

    const authority = await attachments.stage(deptHeadId, "authority letter.pdf", pdf("revise-authority"));
    const resubmitted = await purchasing.reviseAndResubmit(deptHeadId, request.id, compileInput(deptId, { attachmentIds: [authority.id] }));
    expect(resubmitted.stage).toBe("APPROVING");
    expect(resubmitted.history.flatMap((e) => e.attachments.map((a) => a.fileName))).toEqual(["minutes.pdf", "what's missing.pdf", "authority letter.pdf"]);
    // A sent file is part of the record: its uploader can't take it back.
    await expect(attachments.discard(deptHeadId, authority.id)).rejects.toMatchObject({ status: 409 });
  });

  it("only the uploader's own unsent files can be sent, and a failed claim leaves the decision unmade", async () => {
    const { deptHeadId, deanId, deptId } = await ladder("att-owner");
    const request = await purchasing.compilePurchaseRequest(deptHeadId, compileInput(deptId));
    createdRequestIds.push(request.id);
    const headsFile = await attachments.stage(deptHeadId, "mine.pdf", pdf("owner-head"));

    await expect(purchasing.decideStep(deanId, request.id, "APPROVE", undefined, [headsFile.id])).rejects.toMatchObject({ status: 409 });
    const after = await purchasing.getRequest(deptHeadId, request.id);
    expect(after.steps.find((s) => s.status === "PENDING")?.approverId).toBe(deanId);
    expect(after.history).toHaveLength(1);
    await expect(attachments.discard(deanId, headsFile.id)).rejects.toMatchObject({ status: 404 });
  });

  it("refuses what isn't a PDF, image or .xlsx, files over the size limit, and more than 5 with one action", async () => {
    const userId = await makeUser("att-refuse", ["CUSTODIAN"]);
    await expect(attachments.stage(userId, "x.html", Buffer.from("<html></html>"))).rejects.toMatchObject({ status: 400 });
    await expect(attachments.stage(userId, "empty.pdf", Buffer.alloc(0))).rejects.toMatchObject({ status: 400 });
    const tooBig = Buffer.concat([pdf("big"), Buffer.alloc(4 * 1024 * 1024)]);
    await expect(attachments.stage(userId, "big.pdf", tooBig)).rejects.toMatchObject({ status: 400 });

    const { deptHeadId, deptId } = await ladder("att-many");
    const six = [];
    for (let i = 0; i < 6; i++) six.push((await attachments.stage(deptHeadId, `p${i}.pdf`, pdf(`many-${i}`))).id);
    await expect(purchasing.compilePurchaseRequest(deptHeadId, compileInput(deptId, { attachmentIds: six }))).rejects.toMatchObject({ status: 400 });
    for (const id of six) await attachments.discard(deptHeadId, id);
  });

  it("caps what one person may hold unsent, and sweeps unsent files once they expire", async () => {
    const userId = await makeUser("att-staged", ["CUSTODIAN"]);
    const ids = [];
    for (let i = 0; i < 10; i++) ids.push((await attachments.stage(userId, `s${i}.pdf`, pdf(`staged-${i}`))).id);
    await expect(attachments.stage(userId, "eleventh.pdf", pdf("staged-10"))).rejects.toMatchObject({ status: 409 });

    await prisma.purchaseAttachment.updateMany({ where: { id: { in: ids } }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const keys = (await prisma.purchaseAttachment.findMany({ where: { id: { in: ids } }, select: { storageKey: true } })).map((r) => r.storageKey);
    await attachments.sweepExpired();
    expect(await prisma.purchaseAttachment.count({ where: { id: { in: ids } } })).toBe(0);
    const { attachmentStorage } = await import("./storage");
    expect(await attachmentStorage.read(keys[0])).toBeNull();

    // Room again once they're gone.
    const next = await attachments.stage(userId, "after.pdf", pdf("staged-after"));
    expect(next.kind).toBe("PDF");
  });

  it("a requester-portal account can't upload", async () => {
    const externalId = await makeUser("att-external", ["EXTERNAL"]);
    await expect(attachments.stage(externalId, "x.pdf", pdf("external"))).rejects.toMatchObject({ status: 403 });
  });
});
