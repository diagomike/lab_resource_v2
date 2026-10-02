import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** Notifications (lib/server/mail/notify.ts), captured instead of sent. */
const sent: { to: string; subject: string }[] = [];
vi.mock("../mail/mail", () => ({ send: async (m: { to: string; subject: string }) => void sent.push({ to: m.to, subject: m.subject }) }));

/** DB-backed — labs and stores are managed from above: a department's head, a college's
 *  ADAA, never a custodian; a place's own details and custodian change only here. Runs
 *  on its own orphan college and department. */
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

type PlacesModule = typeof import("./places");
type CategoriesModule = typeof import("./categories");
type MutateModule = typeof import("./mutate");
type PrismaModule = typeof import("../prisma");

let places: PlacesModule;
let categories: CategoriesModule;
let mutate: MutateModule;
let prisma: PrismaModule["prisma"];

const testKey = `__test-places-${Date.now()}`;
let sysAdminId: string;
let collegeId: string;
let deptId: string;
let otherDeptId: string;
let groupId: string;
let labCat: string;
let thingCat: string;
let storeCat: string;
let storeCatCreated = false;
let lecturerId: string;
let headId: string;
let adaaId: string;
let custodianId: string;
let otherCustodianId: string;
const createdUserIds: string[] = [];
const createdNodeIds: string[] = [];

async function makeUser(suffix: string, roles: string[], homeNodeId: string) {
  const email = `${testKey}-${suffix}@astu.edu.et`;
  const user = await prisma.user.create({
    data: { email, emailLower: email, name: `Places ${suffix}`, status: "ACTIVE", homeNodeId, roles: { create: roles.map((kind) => ({ kind: kind as never })) } },
  });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeNode(name: string, kind: "COLLEGE" | "DEPARTMENT" | "OFFICE", level: number, parentId?: string) {
  const node = await prisma.orgNode.create({ data: { name: `${testKey}-${name}`, level, kind } });
  createdNodeIds.push(node.id);
  await prisma.orgClosure.create({ data: { ancestorId: node.id, descendantId: node.id, depth: 0 } });
  if (parentId) {
    await prisma.orgEdge.create({ data: { parentId, childId: node.id } });
    await prisma.orgClosure.create({ data: { ancestorId: parentId, descendantId: node.id, depth: 1 } });
  }
  return node.id;
}

beforeAll(async () => {
  places = await import("./places");
  categories = await import("./categories");
  mutate = await import("./mutate");
  ({ prisma } = await import("../prisma"));

  sysAdminId = (await prisma.user.findFirstOrThrow({ where: { roles: { some: { kind: "SYS_ADMIN" } } } })).id;
  collegeId = await makeNode("college", "COLLEGE", 1);
  deptId = await makeNode("dept", "DEPARTMENT", 2, collegeId);
  otherDeptId = await makeNode("other-dept", "DEPARTMENT", 2);
  groupId = (await prisma.categoryGroup.create({ data: { name: testKey, sortOrder: 999 } })).id;
  const base = { groupId, countingMode: "SERIALIZED" as const, impairRule: "NEVER" as const, templateChildren: [], iconKey: "Package" };
  labCat = (await categories.create(sysAdminId, { ...base, key: `${testKey}-lab`, name: "Places Lab", isPlace: true, fields: [{ key: "room", label: "Room", type: "TEXT", options: [], summary: true, longText: false, required: true, sortOrder: 0 }] })).id;
  thingCat = (await categories.create(sysAdminId, { ...base, key: `${testKey}-thing`, name: "Places Thing", isPlace: false, fields: [] })).id;
  // A store is the category keyed "store" (places.ts tells a store by it).
  const existingStore = await prisma.resourceCategory.findUnique({ where: { key: "store" } });
  storeCat = existingStore?.id ?? (await categories.create(sysAdminId, { ...base, key: "store", name: "Store", isPlace: true, fields: [] })).id;
  storeCatCreated = !existingStore;

  headId = await makeUser("head", ["MANAGER"], deptId);
  await prisma.orgNode.update({ where: { id: deptId }, data: { userId: headId } });
  adaaId = await makeUser("adaa", ["ADAA"], collegeId);
  custodianId = await makeUser("custodian", ["CUSTODIAN"], deptId);
  otherCustodianId = await makeUser("custodian-2", ["CUSTODIAN"], deptId);
  // Works in the college with no role that lets them hold custody.
  lecturerId = await makeUser("lecturer", [], deptId);
}, 60_000);

afterAll(async () => {
  const all = await prisma.item.findMany({ where: { ownerOrgNodeId: { in: createdNodeIds } }, select: { id: true } });
  await prisma.itemChange.deleteMany({ where: { itemId: { in: all.map((i) => i.id) } } });
  for (let pass = 0; pass < 5; pass++) await prisma.item.deleteMany({ where: { ownerOrgNodeId: { in: createdNodeIds }, children: { none: {} } } });
  const ownCats = [labCat, thingCat, ...(storeCatCreated ? [storeCat] : [])];
  await prisma.itemChange.deleteMany({ where: { categoryId: { in: ownCats } } });
  await prisma.resourceCategory.deleteMany({ where: { id: { in: ownCats } } });
  await prisma.categoryGroup.delete({ where: { id: groupId } });
  await prisma.orgNode.updateMany({ where: { id: { in: createdNodeIds } }, data: { userId: null } });
  await prisma.userRole.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.orgClosure.deleteMany({ where: { OR: [{ ancestorId: { in: createdNodeIds } }, { descendantId: { in: createdNodeIds } }] } });
  await prisma.orgEdge.deleteMany({ where: { OR: [{ parentId: { in: createdNodeIds } }, { childId: { in: createdNodeIds } }] } });
  await prisma.orgNode.deleteMany({ where: { id: { in: createdNodeIds } } });
  await prisma.$disconnect();
}, 60_000);

const newLab = (name: string, ownerOrgNodeId = deptId, custodian = custodianId) => ({ categoryId: labCat, name, ownerOrgNodeId, custodianId: custodian, props: { room: "B510-R8" } });

describe("the ADAA's reach", () => {
  it("is the whole college — not just the ADAA office they sit in", async () => {
    const orgScope = await import("../org/scope");
    const officeId = await makeNode("adaa-office", "OFFICE", 2, collegeId);
    const officeAdaa = await makeUser("adaa-in-office", ["ADAA"], officeId);
    await prisma.orgNode.update({ where: { id: officeId }, data: { userId: officeAdaa } });
    try {
      for (const who of [adaaId, officeAdaa]) {
        const seen = await orgScope.visibleNodeIds(who);
        expect(seen).toEqual(expect.arrayContaining([collegeId, deptId]));
        expect(seen).not.toContain(otherDeptId);
        expect(await orgScope.ownNodeId(who)).toBe(collegeId);
      }
    } finally {
      await prisma.orgNode.update({ where: { id: officeId }, data: { userId: null } });
    }
  });
});

describe("who creates labs and stores", () => {
  it("the department's head creates a lab and assigns its custodian, who is told", async () => {
    const mark = sent.length;
    const lab = await places.createPlace(headId, newLab("Places Lab One"));
    expect(lab).toMatchObject({ name: "Places Lab One", custodianId, ownerOrgNodeId: deptId, props: { room: "B510-R8" }, canManage: true, itemCount: 0 });
    expect(sent.slice(mark).map((m) => m.subject)).toEqual(["You now run Places Lab One"]);
  });

  it("the college's ADAA adds no labs — not a department's, not the college's", async () => {
    await expect(places.createPlace(adaaId, newLab("Places ADAA Lab"))).rejects.toMatchObject({ status: 403 });
    await expect(places.createPlace(adaaId, newLab("Places ADAA College Lab", collegeId, custodianId))).rejects.toMatchObject({ status: 403 });
    expect((await places.placeOptions(adaaId)).units).toEqual([expect.objectContaining({ id: collegeId, storesOnly: true })]);
  });

  it("the ADAA adds the college's store and names its keeper — anyone in the college, made a custodian if they aren't one", async () => {
    const offered = await places.custodianCandidates(adaaId, collegeId, true);
    expect(offered.find((c) => c.id === lecturerId)).toMatchObject({ becomesCustodian: true });
    expect(offered.find((c) => c.id === custodianId)).toMatchObject({ becomesCustodian: false });
    const store = { categoryId: storeCat, name: "Places College Store", ownerOrgNodeId: collegeId, custodianId: lecturerId, props: {} };
    const mark = sent.length;
    const created = await places.createPlace(adaaId, store);
    expect(created).toMatchObject({ isStore: true, custodianId: lecturerId, ownerOrgNodeId: collegeId, canManage: true });
    expect(sent.slice(mark).map((m) => m.subject)).toEqual(["You now keep Places College Store"]);
    expect((await prisma.userRole.findMany({ where: { userId: lecturerId } })).map((r) => r.kind)).toContain("CUSTODIAN");
    expect((await places.listPlaces(adaaId)).map((p) => p.id)).toContain(created.id);
    // The ADAA changes the keeper; a department's store stays its head's.
    expect((await places.updatePlace(adaaId, created.id, { custodianId })).custodianId).toBe(custodianId);
    await expect(places.createPlace(adaaId, { ...store, name: "Places Dept Store", ownerOrgNodeId: deptId, custodianId })).rejects.toMatchObject({ status: 403 });
  });

  it("a lab is still run by a custodian — someone without the role isn't offered", async () => {
    await expect(places.createPlace(headId, newLab("Places Lecturer Lab", deptId, (await makeUser("lecturer-2", [], deptId))))).rejects.toMatchObject({ status: 400 });
  });

  it("a custodian never creates a lab, here or through the register", async () => {
    await expect(places.createPlace(custodianId, newLab("Places Custodian Lab"))).rejects.toMatchObject({ status: 403 });
    await expect(
      mutate.applyChange(custodianId, { kind: "createItem", parentId: null, categoryId: labCat, count: 1, name: "Sneaky Lab", ownerOrgNodeId: deptId, custodianId, props: { room: "X" } }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("a head manages only their own unit's places, and only a kind of place, run by someone who works there", async () => {
    await expect(places.createPlace(headId, newLab("Places Elsewhere", otherDeptId))).rejects.toMatchObject({ status: 403 });
    await expect(places.createPlace(headId, { ...newLab("Places Thing As Lab"), categoryId: thingCat })).rejects.toMatchObject({ status: 400 });
    const outsider = await makeUser("outsider", ["CUSTODIAN"], otherDeptId);
    await expect(places.createPlace(headId, newLab("Places Outsider Lab", deptId, outsider))).rejects.toMatchObject({ status: 400 });
  });

  it("an office never owns a lab or store, and is not offered as one's unit", async () => {
    const officeId = await makeNode("office", "OFFICE", 2, collegeId);
    await prisma.user.update({ where: { id: otherCustodianId }, data: { homeNodeId: officeId } });
    try {
      await expect(places.createPlace(sysAdminId, newLab("Places Office Lab", officeId, otherCustodianId))).rejects.toMatchObject({ status: 400 });
      expect((await places.placeOptions(sysAdminId)).units.map((u) => u.id)).not.toContain(officeId);
    } finally {
      await prisma.user.update({ where: { id: otherCustodianId }, data: { homeNodeId: deptId } });
    }
  });
});

describe("a place's details and custodian", () => {
  it("only its managers change them; the custodian can't, even through the register", async () => {
    const lab = await places.createPlace(headId, newLab("Places Lab Two"));
    await expect(places.updatePlace(custodianId, lab.id, { name: "Renamed by custodian" })).rejects.toMatchObject({ status: 403 });
    await expect(mutate.applyChange(custodianId, { kind: "setName", itemIds: [lab.id], value: "Renamed directly" })).rejects.toMatchObject({ status: 403 });
    const updated = await places.updatePlace(headId, lab.id, { name: "Places Lab Two (B)", props: { room: "B510-R9" } });
    expect(updated).toMatchObject({ name: "Places Lab Two (B)", props: { room: "B510-R9" } });
  });

  it("a new custodian takes the place and what it holds for the unit; both people are told", async () => {
    const lab = await places.createPlace(headId, newLab("Places Lab Three"));
    const inside = await mutate.applyChange(sysAdminId, { kind: "createItem", parentId: lab.id, categoryId: thingCat, count: 2, name: "Bench" });
    const mark = sent.length;
    const after = await places.updatePlace(headId, lab.id, { custodianId: otherCustodianId, note: "Covering this semester" });
    expect(after.custodianId).toBe(otherCustodianId);
    const moved = await prisma.item.findMany({ where: { id: { in: inside.itemIds } }, select: { custodianId: true } });
    expect(moved.every((i) => i.custodianId === otherCustodianId)).toBe(true);
    expect(sent.slice(mark).map((m) => m.subject).sort()).toEqual(["Places Lab Three has a new custodian", "You now run Places Lab Three"]);
  });

  it("an empty place can be removed; one with things in it cannot", async () => {
    const empty = await places.createPlace(headId, newLab("Places Empty"));
    await places.removePlace(headId, empty.id);
    expect((await prisma.item.findUniqueOrThrow({ where: { id: empty.id } })).deletedAt).not.toBeNull();
    const full = await places.createPlace(headId, newLab("Places Full"));
    await mutate.applyChange(sysAdminId, { kind: "createItem", parentId: full.id, categoryId: thingCat, count: 1, name: "Stool" });
    await expect(places.removePlace(headId, full.id)).rejects.toMatchObject({ status: 409 });
  });

  it("lists what the caller manages and what they run", async () => {
    const forHead = await places.listPlaces(headId);
    expect(forHead.length).toBeGreaterThan(0);
    expect(forHead.every((p) => p.canManage)).toBe(true);
    const forCustodian = await places.listPlaces(custodianId);
    expect(forCustodian.every((p) => p.isMine && !p.canManage)).toBe(true);
  });
});
