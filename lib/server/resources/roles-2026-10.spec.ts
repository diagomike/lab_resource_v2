import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../mail/mail", () => ({ send: async () => undefined }));

/** DB-backed — the 2026-10-02 feedback round's R2: who does what. Store changes are
 *  decided by Property Administration; custody and units are its records; a borrower
 *  returns a loan on their own; bookings and places follow posts, not the MANAGER
 *  label; a store keeper's own view is their stores. Runs on its own departments. */
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

type Prisma = (typeof import("../prisma"))["prisma"];
let prisma: Prisma;
let mutate: typeof import("./mutate");
let versions: typeof import("./lab-versions");
let approvals: typeof import("./approvals");
let categories: typeof import("./categories");
let scope: typeof import("./scope");
let caps: typeof import("../auth/capabilities");
let booking: typeof import("../scheduling/context");

const testKey = `__test-roles-2026-10-${Date.now()}`;
const userIds: string[] = [];
const nodeIds: string[] = [];
let sysAdminId: string;
let propertyAdminId: string;
let universityId: string;
let deptA: string;
let deptB: string;
let groupId: string;
let thingCat: string;
let labCat: string;
let storeCat: string;
let createdStoreCat = false;
let keeperId: string;
let custA: string;
let custB: string;

async function makeUser(suffix: string, roles: string[], homeNodeId: string | null) {
  const email = `${testKey}-${suffix}@astu.edu.et`;
  const user = await prisma.user.create({ data: { email, emailLower: email, name: `Test ${suffix}`, status: "ACTIVE", homeNodeId, roles: { create: roles.map((kind) => ({ kind: kind as never })) } } });
  userIds.push(user.id);
  return user.id;
}

const place = async (name: string, categoryId: string, owner: string, custodianId: string) =>
  (await mutate.applyChange(sysAdminId, { kind: "createItem", parentId: null, categoryId, count: 1, name, ownerOrgNodeId: owner, custodianId })).itemIds[0];
const thing = async (parentId: string, name: string) => (await mutate.applyChange(sysAdminId, { kind: "createItem", parentId, categoryId: thingCat, count: 1, name })).itemIds[0];

beforeAll(async () => {
  ({ prisma } = await import("../prisma"));
  mutate = await import("./mutate");
  versions = await import("./lab-versions");
  approvals = await import("./approvals");
  categories = await import("./categories");
  scope = await import("./scope");
  caps = await import("../auth/capabilities");
  booking = await import("../scheduling/context");

  sysAdminId = (await prisma.user.findFirstOrThrow({ where: { roles: { some: { kind: "SYS_ADMIN" } } } })).id;
  const office = await prisma.orgNode.findUniqueOrThrow({ where: { code: "PROP" } });
  propertyAdminId = office.userId!;
  universityId = (await prisma.orgNode.findFirstOrThrow({ where: { kind: "UNIVERSITY", active: true } })).id;
  deptA = (await prisma.orgNode.create({ data: { name: `${testKey}-A`, level: 2, kind: "DEPARTMENT" } })).id;
  deptB = (await prisma.orgNode.create({ data: { name: `${testKey}-B`, level: 2, kind: "DEPARTMENT" } })).id;
  nodeIds.push(deptA, deptB);
  for (const id of [deptA, deptB]) await prisma.orgClosure.create({ data: { ancestorId: id, descendantId: id, depth: 0 } });

  groupId = (await prisma.categoryGroup.create({ data: { name: testKey, sortOrder: 999 } })).id;
  const base = { groupId, countingMode: "SERIALIZED" as const, impairRule: "NEVER" as const, fields: [], iconKey: "Package", templateChildren: [] };
  thingCat = (await categories.create(sysAdminId, { ...base, key: `${testKey}-thing`, name: `${testKey} Thing`, isPlace: false })).id;
  labCat = (await categories.create(sysAdminId, { ...base, key: `${testKey}-lab`, name: `${testKey} Lab`, isPlace: true })).id;
  // The store kind is recognised by its key; the test database may not have one yet.
  const existingStore = await prisma.resourceCategory.findUnique({ where: { key: "store" } });
  storeCat = existingStore?.id ?? (await prisma.resourceCategory.create({ data: { key: "store", name: `${testKey} Store`, iconKey: "Warehouse", groupId, countingMode: "SERIALIZED", isPlace: true } })).id;
  createdStoreCat = !existingStore;

  keeperId = await makeUser("keeper", ["STORE_KEEPER"], universityId);
  custA = await makeUser("cust-a", ["CUSTODIAN"], deptA);
  custB = await makeUser("cust-b", ["CUSTODIAN"], deptB);
}, 60_000);

afterAll(async () => {
  const items = await prisma.item.findMany({ where: { OR: [{ ownerOrgNodeId: { in: nodeIds } }, { custodianId: { in: userIds } }] }, select: { id: true } });
  const ids = items.map((i) => i.id);
  const requests = await prisma.changeRequest.findMany({ where: { requesterId: { in: userIds } }, select: { id: true } });
  await prisma.chainStep.deleteMany({ where: { requestId: { in: requests.map((r) => r.id) } } });
  await prisma.changeRequest.deleteMany({ where: { id: { in: requests.map((r) => r.id) } } });
  await prisma.labCommitRequest.deleteMany({ where: { labItemId: { in: ids } } });
  await prisma.labVersion.deleteMany({ where: { labItemId: { in: ids } } });
  await prisma.itemChange.deleteMany({ where: { itemId: { in: ids } } });
  for (let pass = 0; pass < 5; pass++) await prisma.item.deleteMany({ where: { id: { in: ids }, children: { none: {} } } });
  await prisma.resourceCategory.deleteMany({ where: { id: { in: [thingCat, labCat, ...(createdStoreCat ? [storeCat] : [])] } } });
  await prisma.categoryGroup.delete({ where: { id: groupId } });
  await prisma.orgNode.updateMany({ where: { id: { in: nodeIds } }, data: { userId: null } });
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.orgClosure.deleteMany({ where: { OR: [{ ancestorId: { in: nodeIds } }, { descendantId: { in: nodeIds } }] } });
  await prisma.orgNode.deleteMany({ where: { id: { in: nodeIds } } });
  await prisma.$disconnect();
}, 60_000);

describe("store changes are decided by Property Administration", () => {
  it("a store keeper's edit in a store is staged, and only Property Administration's occupant decides it", async () => {
    const store = await place(`${testKey} Store`, storeCat, universityId, keeperId);
    const box = await thing(store, `${testKey} Box`);
    const staged = await mutate.applyChange(keeperId, { kind: "setStatus", itemIds: [box], value: "BROKEN" });
    expect(staged.staged?.labItemId).toBe(store);
    expect((await prisma.item.findUniqueOrThrow({ where: { id: box } })).status).toBe("WORKING");

    const states = await versions.getLabStates(keeperId, store);
    expect(states.lab.approverLabel).toBe("Property Administration");
    const request = await versions.submitVersion(keeperId, store, "DRAFT");
    expect((await versions.listForActor(propertyAdminId, "inbox")).map((r) => r.id)).toContain(request.id);
    await expect(versions.decideCommit(sysAdminId, request.id, "APPROVE")).rejects.toMatchObject({ status: 403 });
    const decided = await versions.decideCommit(propertyAdminId, request.id, "APPROVE");
    expect(decided.status).toBe("APPLIED");
    expect((await prisma.item.findUniqueOrThrow({ where: { id: box } })).status).toBe("BROKEN");
  });

  it("a department's lab is still its head's", async () => {
    const lab = await place(`${testKey} Lab A`, labCat, deptA, custA);
    expect((await versions.getLabStates(custA, lab)).lab.approverLabel).toBe("the head");
  });
});

describe("custody and units are Property Administration's records", () => {
  it("Property Administration changes custody directly, with a reason; a custodian is refused", async () => {
    const lab = await place(`${testKey} Lab A2`, labCat, deptA, custA);
    const scope2 = await thing(lab, `${testKey} Scope`);
    await expect(mutate.applyChange(custA, { kind: "setCustodian", itemIds: [scope2], value: custB, note: "x" })).rejects.toMatchObject({ status: 403 });
    await expect(mutate.applyChange(propertyAdminId, { kind: "setCustodian", itemIds: [scope2], value: custB })).rejects.toMatchObject({ status: 400 });
    const done = await mutate.applyChange(propertyAdminId, { kind: "setCustodian", itemIds: [scope2], value: custB, note: "Reassigned after the audit" });
    expect(done.staged).toBeUndefined();
    expect((await prisma.item.findUniqueOrThrow({ where: { id: scope2 } })).custodianId).toBe(custB);
  });
});

describe("a borrower returns a loan on their own", () => {
  it("the borrower's return skips their own release; the owner's custodian confirms", async () => {
    const labA = await place(`${testKey} Lab A3`, labCat, deptA, custA);
    const labB = await place(`${testKey} Lab B3`, labCat, deptB, custB);
    const lent = await thing(labA, `${testKey} Meter`);
    // On loan to B: sits in B's lab, held by B's unit, still A's custodian's.
    await mutate.applyChange(sysAdminId, { kind: "moveInTree", itemIds: [lent], value: labB });
    await mutate.applyChange(sysAdminId, { kind: "setCurrentOrg", itemIds: [lent], value: deptB, note: "loan" });

    const target = await approvals.returnTarget(custB, lent);
    expect(target.side).toBe("BORROWER");
    expect(target.options.map((o) => o.id)).toContain(labA);
    await expect(approvals.returnTarget(await makeUser("stranger", ["CUSTODIAN"], deptB), lent)).rejects.toMatchObject({ status: 403 });

    const result = await approvals.requestTransfer(custB, { kind: "transferItem", itemIds: [lent], transfer: { targetParentId: labA, targetOrgNodeId: "", targetCustodianId: null } });
    expect(result.outcome).toBe("ROUTED");
    const request = await prisma.changeRequest.findFirstOrThrow({ where: { requesterId: custB }, include: { steps: { orderBy: { order: "asc" } } }, orderBy: { createdAt: "desc" } });
    expect(request.steps.map((s) => [s.selector, s.status])).toEqual([
      ["HOST_RELEASE", "SKIPPED"],
      ["OWNER_RECEIPT", "PENDING"],
    ]);
    expect(request.steps[1].approverId).toBe(custA);
  });
});

describe("posts, not the MANAGER label", () => {
  it("a dean doesn't book or manage places; a department head and the ADAA book", async () => {
    const college = (await prisma.orgNode.create({ data: { name: `${testKey}-college`, level: 1, kind: "COLLEGE" } })).id;
    nodeIds.push(college);
    await prisma.orgClosure.createMany({ data: [{ ancestorId: college, descendantId: college, depth: 0 }, { ancestorId: college, descendantId: deptA, depth: 1 }] });
    const dean = await makeUser("dean", ["MANAGER"], college);
    await prisma.orgNode.update({ where: { id: college }, data: { userId: dean } });
    const head = await makeUser("head-a", ["MANAGER"], deptA);
    await prisma.orgNode.update({ where: { id: deptA }, data: { userId: head } });
    const adaa = await makeUser("adaa", ["ADAA"], college);

    await expect(booking.assertMayBook(dean)).rejects.toMatchObject({ status: 403 });
    await expect(booking.assertMayBook(head)).resolves.toBeUndefined();
    await expect(booking.assertMayBook(adaa)).resolves.toBeUndefined();
    expect((await caps.capabilitiesOf(dean)).managesPlacesIn).toEqual([]);
    const adaaCaps = await caps.capabilitiesOf(adaa);
    expect(adaaCaps.managesStoresIn).toEqual([college]);
    expect(adaaCaps.assignsPeopleIn).toEqual(expect.arrayContaining([college, deptA]));
  });

  it("a store keeper's own view is the stores they keep", async () => {
    expect(await scope.defaultModeFor(keeperId)).toBe("MY_CUSTODY");
  });
});
