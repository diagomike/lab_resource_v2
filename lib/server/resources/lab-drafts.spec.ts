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
