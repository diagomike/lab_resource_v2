import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** DB-backed — custody floors, live head resolution, and transactional
 *  commit/decide behaviour are not provable as pure logic. See
 *  university-scope.spec.ts's header for the `.env`-loading detail; identical here. */
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

type LabDraftsModule = typeof import("./lab-drafts");
type CategoriesModule = typeof import("./categories");
type MutateModule = typeof import("./mutate");
type PrismaModule = typeof import("../prisma");

let labDrafts: LabDraftsModule;
let categories: CategoriesModule;
let mutate: MutateModule;
let prisma: PrismaModule["prisma"];

let sysAdminId: string;
/** A fresh, ORPHAN OrgNode created directly for this file only — deliberately NOT
 *  one of the shared seed departments (Software Engineering / Chemical
 *  Engineering). Other spec files run concurrently against those, including
 *  assertions about their real seeded head (`head.se@astu.edu.et`) occupying them;
 *  this file repeatedly assigns/vacates its own test department's occupant to
 *  exercise vacancy/reassignment, which would otherwise race with — and could
 *  permanently displace — that real occupancy. No parent edges are needed: every
 *  account here holds plain CUSTODIAN (never MANAGER), so `assertCanMutate`/
 *  `assertCanSeeItem` resolve through MY_CUSTODY, which never consults org-closure
 *  reach at all. */
let testDeptNodeId: string;
let groupId: string;
let categoryId: string;
const testKey = `__test-lab-drafts-${Date.now()}`;

const createdUserIds: string[] = [];
const createdItemIds: string[] = [];
const createdNodeIds: string[] = [];

async function makeUser(suffix: string, data: { homeNodeId?: string; roles: string[] }) {
  const email = `${testKey}-${suffix}@astu.edu.et`;
  const user = await prisma.user.create({
    data: { email, emailLower: email, name: `Test ${suffix}`, status: "ACTIVE", homeNodeId: data.homeNodeId, roles: { create: data.roles.map((kind) => ({ kind: kind as never })) } },
  });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeLab(custodianId: string, name: string) {
  const item = await prisma.item.create({
    data: { categoryId, name, countingMode: "SERIALIZED", status: "WORKING", ownerOrgNodeId: testDeptNodeId, currentOrgNodeId: testDeptNodeId, custodianId },
  });
  createdItemIds.push(item.id);
  return item.id;
}

async function makeChild(labItemId: string, custodianId: string, name: string, status: "WORKING" | "BROKEN" = "WORKING") {
  const item = await prisma.item.create({
    data: { parentId: labItemId, categoryId, name, countingMode: "SERIALIZED", status, ownerOrgNodeId: testDeptNodeId, currentOrgNodeId: testDeptNodeId, custodianId },
  });
  createdItemIds.push(item.id);
  return item.id;
}

async function setHead(userId: string | null) {
  await prisma.orgNode.update({ where: { id: testDeptNodeId }, data: { userId } });
}

beforeAll(async () => {
  labDrafts = await import("./lab-drafts");
  categories = await import("./categories");
  mutate = await import("./mutate");
  ({ prisma } = await import("../prisma"));

  const sysAdmin = await prisma.user.findFirstOrThrow({ where: { roles: { some: { kind: "SYS_ADMIN" } } } });
  sysAdminId = sysAdmin.id;

  const testDept = await prisma.orgNode.create({ data: { name: `${testKey}-dept`, level: 2, kind: "DEPARTMENT" } });
  testDeptNodeId = testDept.id;

  const group = await prisma.categoryGroup.create({ data: { name: testKey, sortOrder: 999 } });
  groupId = group.id;
  const category = await categories.create(sysAdminId, {
    key: testKey,
    name: "Lab Drafts Test Category",
    iconKey: "Package",
    groupId,
    countingMode: "SERIALIZED",
    impairRule: "ANY_CRITICAL",
    canBeRoot: true,
    placement: "ANYWHERE",
    allowedParentCategoryIds: [],
    fields: [],
    templateChildren: [],
  });
  categoryId = category.id;
});

afterAll(async () => {
  await prisma.labCommitRequest.deleteMany({ where: { labItemId: { in: createdItemIds } } });
  await prisma.itemDraftChange.deleteMany({ where: { labItemId: { in: createdItemIds } } });
  await prisma.labIdealTarget.deleteMany({ where: { labItemId: { in: createdItemIds } } });
  await prisma.itemChange.deleteMany({ where: { OR: [{ itemId: { in: createdItemIds } }, { categoryId }] } });
  await prisma.item.deleteMany({ where: { id: { in: createdItemIds } } });
  await prisma.resourceCategory.delete({ where: { id: categoryId } });
  await prisma.categoryGroup.delete({ where: { id: groupId } });
  await prisma.userRole.deleteMany({ where: { userId: { in: createdUserIds } } });
  await setHead(null);
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.orgNode.deleteMany({ where: { id: { in: createdNodeIds } } });
  await prisma.orgNode.delete({ where: { id: testDeptNodeId } });
  await prisma.$disconnect();
});

describe("toggle off (today's production state) — the regression guard", () => {
  let custodianId: string;
  let labId: string;

  beforeAll(async () => {
    await prisma.orgNode.update({ where: { id: testDeptNodeId }, data: { draftWorkflowEnabled: false } });
    custodianId = await makeUser("toggle-off-custodian", { homeNodeId: testDeptNodeId, roles: ["CUSTODIAN"] });
    labId = await makeLab(custodianId, "Toggle-Off Lab");
  });

  it("refuses to stage anything while the department's draft workflow is off", async () => {
    await expect(
      labDrafts.stageChange(custodianId, labId, { targetKind: "VISIBLE", change: { kind: "setName", itemIds: [labId], value: "Renamed" } }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("refuses to submit while off, even with no staged rows to check first", async () => {
    await expect(labDrafts.submitDraft(custodianId, labId, "VISIBLE")).rejects.toMatchObject({ status: 403 });
  });

  it("F-037: IDEAL targets can still be proposed and approved with draft mode off", async () => {
    const headId = await makeUser("toggle-off-head", { roles: ["MANAGER"] });
    await setHead(headId);
    try {
      const staged = await labDrafts.stageChange(custodianId, labId, { targetKind: "IDEAL", categoryId, qty: 5 });
      expect(staged.targetKind).toBe("IDEAL");
      const commit = await labDrafts.submitDraft(custodianId, labId, "IDEAL");
      const decided = await labDrafts.decideCommit(headId, commit.id, "APPROVE");
      expect(decided.status).toBe("APPLIED");
      const target = await prisma.labIdealTarget.findUniqueOrThrow({ where: { labItemId_categoryId: { labItemId: labId, categoryId } } });
      expect(target.idealQty).toBe(5);
    } finally {
      await setHead(null);
    }
  });
});

describe("toggle on — the direct write door refuses to be bypassed", () => {
  let custodianId: string;
  let labId: string;

  beforeAll(async () => {
    await prisma.orgNode.update({ where: { id: testDeptNodeId }, data: { draftWorkflowEnabled: true } });
    custodianId = await makeUser("bypass-custodian", { homeNodeId: testDeptNodeId, roles: ["CUSTODIAN"] });
    labId = await makeLab(custodianId, "Bypass Test Lab");
  });

  it("mutate.applyChange refuses a direct edit once the owning department has opted into draft mode — the whole point of the toggle would otherwise be avoidable by calling the old endpoint", async () => {
    await expect(mutate.applyChange(custodianId, { kind: "setName", itemIds: [labId], value: "Direct Edit Attempt" })).rejects.toMatchObject({ status: 403 });
    const live = await prisma.item.findUniqueOrThrow({ where: { id: labId } });
    expect(live.name).toBe("Bypass Test Lab");
  });

  it("but staging through lab-drafts.ts still works — the block only refuses callers that skip it", async () => {
    const row = await labDrafts.stageChange(custodianId, labId, { targetKind: "VISIBLE", change: { kind: "setName", itemIds: [labId], value: "Staged Edit" } });
    expect(row.status).toBe("OPEN");
  });
});

describe("staging, submitting, vacancy, and approval to VISIBLE", () => {
  let custodianId: string;
  let headId: string;
  let labId: string;
  let childId: string;

  beforeAll(async () => {
    await prisma.orgNode.update({ where: { id: testDeptNodeId }, data: { draftWorkflowEnabled: true } });
    custodianId = await makeUser("visible-custodian", { homeNodeId: testDeptNodeId, roles: ["CUSTODIAN"] });
    labId = await makeLab(custodianId, "Visible-Flow Lab");
    childId = await makeChild(labId, custodianId, "Existing Widget");
  });

  afterAll(async () => {
    await setHead(null);
  });

  it("stages multiple heterogeneous changes without touching any live Item", async () => {
    await labDrafts.stageChange(custodianId, labId, { targetKind: "VISIBLE", change: { kind: "setName", itemIds: [childId], value: "Renamed Widget" } });
    await labDrafts.stageChange(custodianId, labId, { targetKind: "VISIBLE", change: { kind: "setStatus", itemIds: [childId], value: "BROKEN" } });
    const draft = await labDrafts.listDraft(custodianId, labId);
    expect(draft).toHaveLength(2);
    expect(draft.every((d) => d.status === "OPEN")).toBe(true);

    const live = await prisma.item.findUniqueOrThrow({ where: { id: childId } });
    expect(live.name).toBe("Existing Widget");
    expect(live.status).toBe("WORKING");
  });

  it("a vacant headship blocks the commit for everyone, including the requester, then unblocks the instant someone is appointed", async () => {
    const commit = await labDrafts.submitDraft(custodianId, labId, "VISIBLE");
    expect(commit.status).toBe("PENDING");
    expect(commit.changes).toHaveLength(2);
    expect(commit.canDecide).toBe(false); // the test department's headship starts vacant

    await expect(labDrafts.decideCommit(custodianId, commit.id, "APPROVE")).rejects.toMatchObject({ status: 403 });

    headId = await makeUser("visible-head", { roles: ["MANAGER"] });
    await setHead(headId);

    const fresh = await labDrafts.getRequest(headId, commit.id);
    expect(fresh.canDecide).toBe(true);

    const decided = await labDrafts.decideCommit(headId, commit.id, "APPROVE");
    expect(decided.status).toBe("APPLIED");

    const live = await prisma.item.findUniqueOrThrow({ where: { id: childId } });
    expect(live.name).toBe("Renamed Widget");
    expect(live.status).toBe("BROKEN");

    const changeRows = await prisma.itemChange.findMany({ where: { itemId: childId }, orderBy: { at: "asc" } });
    expect(changeRows.map((r) => r.kind)).toEqual(expect.arrayContaining(["setName", "setStatus"]));
  });
});

describe("rejection keeps the draft intact for revision", () => {
  let custodianId: string;
  let headId: string;
  let labId: string;
  let childId: string;

  beforeAll(async () => {
    await prisma.orgNode.update({ where: { id: testDeptNodeId }, data: { draftWorkflowEnabled: true } });
    custodianId = await makeUser("reject-custodian", { homeNodeId: testDeptNodeId, roles: ["CUSTODIAN"] });
    headId = await makeUser("reject-head", { roles: ["MANAGER"] });
    await setHead(headId);
    labId = await makeLab(custodianId, "Reject-Flow Lab");
    childId = await makeChild(labId, custodianId, "Reject Widget");
  });

  afterAll(async () => {
    await setHead(null);
  });

  it("a rejected commit resets its staged rows to OPEN rather than discarding them", async () => {
    await labDrafts.stageChange(custodianId, labId, { targetKind: "VISIBLE", change: { kind: "setName", itemIds: [childId], value: "Rejected Name" } });
    const commit = await labDrafts.submitDraft(custodianId, labId, "VISIBLE");

    const decided = await labDrafts.decideCommit(headId, commit.id, "REJECT", "not yet");
    expect(decided.status).toBe("REJECTED");
    expect(decided.resolution).toBe("not yet");

    const stillDraft = await labDrafts.listDraft(custodianId, labId);
    expect(stillDraft).toHaveLength(1);
    expect(stillDraft[0].status).toBe("OPEN");

    const live = await prisma.item.findUniqueOrThrow({ where: { id: childId } });
    expect(live.name).toBe("Reject Widget"); // unchanged — nothing applied

    // The custodian can extend and resubmit the SAME draft.
    await labDrafts.stageChange(custodianId, labId, { targetKind: "VISIBLE", change: { kind: "setStatus", itemIds: [childId], value: "BROKEN" } });
    const resubmit = await labDrafts.submitDraft(custodianId, labId, "VISIBLE");
    expect(resubmit.changes).toHaveLength(2);
  });
});

describe("F-035/F-036 — atomic batch apply and staleness against a direct correction", () => {
  let custodianId: string;
  let headId: string;
  let labId: string;
  let childId: string;

  beforeAll(async () => {
    await prisma.orgNode.update({ where: { id: testDeptNodeId }, data: { draftWorkflowEnabled: true } });
    custodianId = await makeUser("atomic-custodian", { homeNodeId: testDeptNodeId, roles: ["CUSTODIAN"] });
    headId = await makeUser("atomic-head", { roles: ["MANAGER"] });
    await setHead(headId);
    labId = await makeLab(custodianId, "Atomic-Flow Lab");
  });

  afterAll(async () => {
    await setHead(null);
  });

  it("F-035: two staged edits of the same item, EACH carrying its own expectedVersions (as the Inspector/Change modal actually send it), both apply atomically", async () => {
    childId = await makeChild(labId, custodianId, "F035 Widget");
    const before = await prisma.item.findUniqueOrThrow({ where: { id: childId } });
    // Both staged against the SAME starting version — exactly how two edits made
    // from the same open Inspector, staged one after another, would arrive.
    await labDrafts.stageChange(custodianId, labId, {
      targetKind: "VISIBLE",
      change: { kind: "setName", itemIds: [childId], value: "F035 Renamed", expectedVersions: { [childId]: before.version } },
    });
    await labDrafts.stageChange(custodianId, labId, {
      targetKind: "VISIBLE",
      change: { kind: "setStatus", itemIds: [childId], value: "UNDER_MAINTENANCE", expectedVersions: { [childId]: before.version } },
    });
    const commit = await labDrafts.submitDraft(custodianId, labId, "VISIBLE");
    const decided = await labDrafts.decideCommit(headId, commit.id, "APPROVE");

    // Before the fix, the first real apply bumped the version the second staged
    // change expected, so the second deterministically failed with
    // VERSION_CONFLICT: the request stayed PENDING with only the rename applied.
    expect(decided.status).toBe("APPLIED");
    const live = await prisma.item.findUniqueOrThrow({ where: { id: childId } });
    expect(live.name).toBe("F035 Renamed");
    expect(live.status).toBe("UNDER_MAINTENANCE");
  });

  it("F-036: an item changed after submission (a direct correction) makes approval STALE, not a silent overwrite", async () => {
    childId = await makeChild(labId, custodianId, "F036 Widget");
    await labDrafts.stageChange(custodianId, labId, { targetKind: "VISIBLE", change: { kind: "setName", itemIds: [childId], value: "Stale Draft Name" } });
    const commit = await labDrafts.submitDraft(custodianId, labId, "VISIBLE");

    // An admin corrects the item directly while the draft sits waiting for its head.
    await prisma.item.update({ where: { id: childId }, data: { name: "Admin Correction", version: { increment: 1 } } });

    const decided = await labDrafts.decideCommit(headId, commit.id, "APPROVE");
    expect(decided.status).toBe("STALE");
    expect(decided.resolution).toContain("Admin Correction");

    const live = await prisma.item.findUniqueOrThrow({ where: { id: childId } });
    expect(live.name).toBe("Admin Correction"); // the correction survives, never overwritten
  });
});

describe("approval to IDEAL never touches Item, only LabIdealTarget", () => {
  let custodianId: string;
  let headId: string;
  let labId: string;

  beforeAll(async () => {
    await prisma.orgNode.update({ where: { id: testDeptNodeId }, data: { draftWorkflowEnabled: true } });
    custodianId = await makeUser("ideal-custodian", { homeNodeId: testDeptNodeId, roles: ["CUSTODIAN"] });
    headId = await makeUser("ideal-head", { roles: ["MANAGER"] });
    await setHead(headId);
    labId = await makeLab(custodianId, "Ideal-Flow Lab");
  });

  afterAll(async () => {
    await setHead(null);
  });

  it("stages and approves an ideal-quantity target without writing any Item row", async () => {
    await labDrafts.stageChange(custodianId, labId, { targetKind: "IDEAL", categoryId, qty: 8 });
    const commit = await labDrafts.submitDraft(custodianId, labId, "IDEAL");
    const decided = await labDrafts.decideCommit(headId, commit.id, "APPROVE");
    expect(decided.status).toBe("APPLIED");

    const target = await prisma.labIdealTarget.findUniqueOrThrow({ where: { labItemId_categoryId: { labItemId: labId, categoryId } } });
    expect(target.idealQty).toBe(8);
  });

  it("getIdealVsActual matches the worked example exactly: ideal 8, actual 6 → gap 2", async () => {
    for (let i = 0; i < 6; i += 1) await makeChild(labId, custodianId, `Computer ${i}`, i === 0 ? "BROKEN" : "WORKING");

    const rows = await labDrafts.getIdealVsActual(custodianId, labId);
    const row = rows.find((r) => r.categoryId === categoryId)!;
    expect(row.idealQty).toBe(8);
    expect(row.actualCount).toBe(6);
    expect(row.gap).toBe(2);
    expect(row.brokenItems).toHaveLength(1);
  });

  it("a category with no LabIdealTarget row reports gap 0, not an error", async () => {
    const otherLabId = await makeLab(custodianId, "No-Ideal Lab");
    const rows = await labDrafts.getIdealVsActual(custodianId, otherLabId);
    expect(rows).toEqual([]);
  });

  it("F-034: custodying one item NESTED inside this lab does not expose the whole lab's composition", async () => {
    // A foreign custodian (a different department entirely) who merely holds one
    // borrowed item sitting inside this lab — assertCanSeeItem's own ancestor walk
    // would have made the whole lab "visible" to them via that one nested item;
    // getIdealVsActual now gates on direct visibility/write custody/headship of
    // the lab itself instead.
    const foreignNode = await prisma.orgNode.create({ data: { name: `${testKey}-foreign-dept`, level: 9, kind: "DEPARTMENT", active: true } });
    createdNodeIds.push(foreignNode.id);
    const foreignCustodianId = await makeUser("foreign-custodian", { homeNodeId: foreignNode.id, roles: ["CUSTODIAN"] });
    await makeChild(labId, foreignCustodianId, "Foreign Borrowed Item");

    await expect(labDrafts.getIdealVsActual(foreignCustodianId, labId)).rejects.toMatchObject({ status: 404 });
  });
});

describe("a custodian cannot stage a change against a lab they do not custody", () => {
  it("refuses with the same floor a direct edit would use", async () => {
    await prisma.orgNode.update({ where: { id: testDeptNodeId }, data: { draftWorkflowEnabled: true } });
    const owner = await makeUser("scope-owner", { homeNodeId: testDeptNodeId, roles: ["CUSTODIAN"] });
    const outsider = await makeUser("scope-outsider", { homeNodeId: testDeptNodeId, roles: ["CUSTODIAN"] });
    const labId = await makeLab(owner, "Scope Test Lab");

    await expect(
      labDrafts.stageChange(outsider, labId, { targetKind: "VISIBLE", change: { kind: "setName", itemIds: [labId], value: "Hijacked" } }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("department purchasables and staged additions — a separate orphan department", () => {
  let deptId: string;
  let headId: string;
  let custodianId: string;

  async function labIn(name: string) {
    const item = await prisma.item.create({ data: { categoryId, name, countingMode: "SERIALIZED", status: "WORKING", ownerOrgNodeId: deptId, currentOrgNodeId: deptId, custodianId } });
    createdItemIds.push(item.id);
    return item.id;
  }

  async function unitsIn(labId: string, count: number, broken = 0) {
    for (let i = 0; i < count; i += 1) {
      const item = await prisma.item.create({
        data: { parentId: labId, categoryId, name: `Unit ${i}`, countingMode: "SERIALIZED", status: i < broken ? "BROKEN" : "WORKING", ownerOrgNodeId: deptId, currentOrgNodeId: deptId, custodianId },
      });
      createdItemIds.push(item.id);
    }
  }

  beforeAll(async () => {
    headId = await makeUser("purch-head", { roles: ["MANAGER"] });
    const node = await prisma.orgNode.create({ data: { name: `${testKey}-purch-dept`, level: 2, kind: "DEPARTMENT", userId: headId, draftWorkflowEnabled: true } });
    deptId = node.id;
    custodianId = await makeUser("purch-custodian", { homeNodeId: deptId, roles: ["CUSTODIAN"] });
  });

  afterAll(async () => {
    await prisma.orgNode.update({ where: { id: deptId }, data: { userId: null } });
    await prisma.labCommitRequest.deleteMany({ where: { labItemId: { in: createdItemIds } } });
    await prisma.itemDraftChange.deleteMany({ where: { labItemId: { in: createdItemIds } } });
    await prisma.labIdealTarget.deleteMany({ where: { labItemId: { in: createdItemIds } } });
    await prisma.itemChange.deleteMany({ where: { categoryId } });
    await prisma.item.deleteMany({ where: { ownerOrgNodeId: deptId, parentId: { not: null } } });
    await prisma.item.deleteMany({ where: { ownerOrgNodeId: deptId } });
    await prisma.orgNode.delete({ where: { id: deptId } });
  });

  it("rolls every owned lab's ideal-vs-actual up per category, gaps floored per lab — readable by the head only", async () => {
    const labA = await labIn("Purch Lab A");
    const labB = await labIn("Purch Lab B");
    await labIn("Purch Lab Without Targets");
    await unitsIn(labA, 6, 1);
    await unitsIn(labB, 5);
    await prisma.labIdealTarget.createMany({ data: [{ labItemId: labA, categoryId, idealQty: 8 }, { labItemId: labB, categoryId, idealQty: 3 }] });

    const dto = await labDrafts.getDepartmentPurchasables(headId, deptId);
    expect(dto.labCount).toBe(2);
    expect(dto.rows).toHaveLength(1);
    // Lab A is short 2, lab B holds 2 more than its target — that surplus must not cancel A's gap.
    expect(dto.rows[0]).toMatchObject({ categoryId, idealQty: 11, actualCount: 11, gap: 2, brokenCount: 1 });
    expect(dto.rows[0].labs.map((l) => [l.labName, l.gap])).toEqual([
      ["Purch Lab A", 2],
      ["Purch Lab B", 0],
    ]);

    await expect(labDrafts.getDepartmentPurchasables(custodianId, deptId)).rejects.toMatchObject({ status: 403 });
    await expect(labDrafts.getDepartmentPurchasables(sysAdminId, deptId)).resolves.toMatchObject({ labCount: 2 });
  });

  it("a staged 'add resources' change creates nothing until the head approves, then creates them under the lab, attributed to the custodian", async () => {
    const labId = await labIn("Purch Staged-Create Lab");
    await labDrafts.stageChange(custodianId, labId, { targetKind: "VISIBLE", change: { kind: "createItem", parentId: labId, categoryId, count: 3, name: "Staged Computer" } });

    expect(await prisma.item.count({ where: { parentId: labId, deletedAt: null } })).toBe(0);
    const request = await labDrafts.submitDraft(custodianId, labId, "VISIBLE");
    const decided = await labDrafts.decideCommit(headId, request.id, "APPROVE");
    expect(decided.status).toBe("APPLIED");

    const created = await prisma.item.findMany({ where: { parentId: labId, deletedAt: null } });
    expect(created).toHaveLength(3);
    expect(created.every((i) => i.name.startsWith("Staged Computer") && i.custodianId === custodianId)).toBe(true);
    const log = await prisma.itemChange.findFirstOrThrow({ where: { itemId: created[0].id, kind: "createItem" } });
    expect(log.actorId).toBe(custodianId);
  });
});
