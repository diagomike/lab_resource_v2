import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** Approval notifications (lib/server/mail/notify.ts), captured instead of sent. */
const sent: { to: string; subject: string }[] = [];
vi.mock("../mail/mail", () => ({ send: async (m: { to: string; subject: string }) => void sent.push({ to: m.to, subject: m.subject }) }));

/** DB-backed — a lab's Draft as a whole tree: every custodian edit staged from the
 *  register, merged on approval (and refusing a stale merge). Runs on its own orphan
 *  department, so it never touches the shared seed departments' occupants. */
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

type VersionsModule = typeof import("./lab-versions");
type CategoriesModule = typeof import("./categories");
type MutateModule = typeof import("./mutate");
type PrismaModule = typeof import("../prisma");

let versions: VersionsModule;
let categories: CategoriesModule;
let mutate: MutateModule;
let prisma: PrismaModule["prisma"];

let sysAdminId: string;
let deptId: string;
let groupId: string;
let labCat: string;
let wsCat: string;
let pcCat: string;
let custodianId: string;
let headId: string;
const testKey = `__test-lab-versions-${Date.now()}`;
const createdUserIds: string[] = [];
const labIds: string[] = [];

async function makeUser(suffix: string, roles: string[]) {
  const email = `${testKey}-${suffix}@astu.edu.et`;
  const user = await prisma.user.create({
    data: { email, emailLower: email, name: `Test ${suffix}`, status: "ACTIVE", homeNodeId: deptId, roles: { create: roles.map((kind) => ({ kind: kind as never })) } },
  });
  createdUserIds.push(user.id);
  return user.id;
}

/** A lab with `n` workstations, each holding one computer — created the ordinary way,
 *  through the write door, as the admin (so drafts don't intercept it). */
async function makeLab(name: string, n: number) {
  const lab = await mutate.applyChange(sysAdminId, { kind: "createItem", parentId: null, categoryId: labCat, count: 1, name, ownerOrgNodeId: deptId, custodianId });
  labIds.push(lab.itemIds[0]);
  await mutate.applyChange(sysAdminId, { kind: "createItem", parentId: lab.itemIds[0], categoryId: wsCat, count: n, name: "Workstation" });
  return lab.itemIds[0];
}

const itemNamed = (labId: string, name: string) =>
  prisma.item.findFirstOrThrow({ where: { name, deletedAt: null, OR: [{ parentId: labId }, { parent: { parentId: labId } }] } });

beforeAll(async () => {
  versions = await import("./lab-versions");
  categories = await import("./categories");
  mutate = await import("./mutate");
  ({ prisma } = await import("../prisma"));

  sysAdminId = (await prisma.user.findFirstOrThrow({ where: { roles: { some: { kind: "SYS_ADMIN" } } } })).id;
  deptId = (await prisma.orgNode.create({ data: { name: `${testKey}-dept`, level: 2, kind: "DEPARTMENT" } })).id;
  groupId = (await prisma.categoryGroup.create({ data: { name: testKey, sortOrder: 999 } })).id;
  const base = { groupId, countingMode: "SERIALIZED" as const, impairRule: "ANY_CRITICAL" as const, fields: [], iconKey: "Package" };
  pcCat = (await categories.create(sysAdminId, { ...base, key: `${testKey}-pc`, name: "LV Computer", isPlace: false, templateChildren: [] })).id;
  wsCat = (await categories.create(sysAdminId, { ...base, key: `${testKey}-ws`, name: "LV Workstation", isPlace: false, templateChildren: [{ childCategoryId: pcCat, qty: 1, critical: true }] })).id;
  labCat = (await categories.create(sysAdminId, { ...base, key: `${testKey}-lab`, name: "LV Lab", isPlace: true, templateChildren: [] })).id;

  custodianId = await makeUser("custodian", ["CUSTODIAN"]);
  headId = await makeUser("head", ["MANAGER"]);
  await prisma.orgNode.update({ where: { id: deptId }, data: { userId: headId } });
}, 60_000);

afterAll(async () => {
  await prisma.labCommitRequest.deleteMany({ where: { labItemId: { in: labIds } } });
  await prisma.labVersion.deleteMany({ where: { labItemId: { in: labIds } } });
  const all = await prisma.item.findMany({ where: { ownerOrgNodeId: deptId }, select: { id: true } });
  await prisma.itemChange.deleteMany({ where: { itemId: { in: all.map((i) => i.id) } } });
  // Children before parents (Item.parent is RESTRICT).
  for (let pass = 0; pass < 5; pass++) await prisma.item.deleteMany({ where: { ownerOrgNodeId: deptId, children: { none: {} } } });
  await prisma.resourceCategory.deleteMany({ where: { id: { in: [labCat, wsCat, pcCat] } } });
  await prisma.categoryGroup.delete({ where: { id: groupId } });
  await prisma.orgNode.update({ where: { id: deptId }, data: { userId: null } });
  await prisma.userRole.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.orgNode.delete({ where: { id: deptId } });
  await prisma.$disconnect();
}, 60_000);


describe("Draft — staged from the register, merged on approval", () => {
  let labId: string;
  beforeAll(async () => {
    labId = await makeLab("LV Lab A", 3);
  }, 60_000);

  it("a custodian's register edit goes into the lab's Draft, not the register", async () => {
    const pc = await prisma.item.findFirstOrThrow({ where: { categoryId: pcCat, parent: { parentId: labId, name: "Workstation 02" } } });
    const result = await mutate.applyChange(custodianId, { kind: "setStatus", itemIds: [pc.id], value: "BROKEN", note: "No signal on boot" });
    expect(result.staged?.labItemId).toBe(labId);
    expect((await prisma.item.findUniqueOrThrow({ where: { id: pc.id } })).status).toBe("WORKING");

    const states = await versions.getLabStates(custodianId, labId);
    expect(states.draft?.diff.map((d) => [d.kind, d.lines[0]])).toEqual([["changed", "Status: Working → Broken"]]);
    // The reason given while staging stays with the change (G-11).
    expect(states.draft?.diff[0].note).toBe("No signal on boot");
    const markers = await versions.pendingMarkers(custodianId);
    expect(markers[pc.id]?.lines).toEqual(["Status: Working → Broken"]);
  });

  it("adds whole workstations in the Draft, continuing the numbering", async () => {
    const r = await mutate.applyChange(custodianId, { kind: "createItem", parentId: labId, categoryId: wsCat, count: 2 });
    expect(r.plannedNames).toEqual(["LV Workstation 01", "LV Workstation 02"]); // a different base name than "Workstation"
    await versions.applyVersionEdit(custodianId, labId, "DRAFT", { kind: "deleteItem", itemIds: [(await itemNamed(labId, "Workstation 03")).id] });
  });

  it("a department head can't edit a version — they only decide", async () => {
    await expect(versions.applyVersionEdit(headId, labId, "DRAFT", { kind: "setName", itemIds: [labId], value: "Renamed" })).rejects.toMatchObject({ status: 403 });
  });

  it("submitting sends one readable request; the head approves and it merges, credited to the custodian", async () => {
    const emailOf = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id }, select: { email: true } })).email;
    let mark = sent.length;
    const request = await versions.submitVersion(custodianId, labId, "DRAFT");
    expect(request.canDecide).toBe(false);
    // The head is told changes are waiting; the custodian isn't told about their own submit.
    expect(sent.slice(mark)).toEqual([{ to: await emailOf(headId), subject: `${request.labName}: changes are waiting for your approval` }]);
    expect(request.summary.map((s) => s.kind).sort()).toEqual(["added", "added", "changed", "removed"]);
    expect(request.summary.find((s) => s.kind === "changed")?.note).toBe("No signal on boot");

    mark = sent.length;
    const decided = await versions.decideCommit(headId, request.id, "APPROVE");
    expect(decided.status).toBe("APPLIED");
    expect(sent.slice(mark)).toEqual([{ to: await emailOf(custodianId), subject: `${request.labName}: your changes were approved` }]);
    const children = await prisma.item.findMany({ where: { parentId: labId, deletedAt: null }, select: { name: true }, orderBy: { name: "asc" } });
    expect(children.map((c) => c.name)).toEqual(["LV Workstation 01", "LV Workstation 02", "Workstation 01", "Workstation 02"]);
    const added = await itemNamed(labId, "LV Workstation 01");
    expect(await prisma.item.count({ where: { parentId: added.id, categoryId: pcCat } })).toBe(1); // parts came along
    const pc = await prisma.item.findFirstOrThrow({ where: { categoryId: pcCat, parent: { parentId: labId, name: "Workstation 02" } } });
    expect(pc.status).toBe("BROKEN");
    const log = await prisma.itemChange.findFirstOrThrow({ where: { itemId: pc.id, kind: "setStatus" } });
    expect(log.actorId).toBe(custodianId);
    expect(log.note).toBe("No signal on boot"); // logged with the custodian's reason, as a direct edit would be
    expect(await prisma.labVersion.count({ where: { labItemId: labId, kind: "DRAFT" } })).toBe(0);
  });

  it("a merge is refused as STALE when the register changed underneath it — nothing is overwritten", async () => {
    const ws = await itemNamed(labId, "Workstation 01");
    await versions.applyVersionEdit(custodianId, labId, "DRAFT", { kind: "setStatus", itemIds: [ws.id], value: "UNDER_MAINTENANCE" });
    const request = await versions.submitVersion(custodianId, labId, "DRAFT");
    await mutate.applyChange(sysAdminId, { kind: "setName", itemIds: [ws.id], value: "Workstation 01 (fixed)" }); // the admin edits directly
    const decided = await versions.decideCommit(headId, request.id, "APPROVE");
    expect(decided.status).toBe("STALE");
    expect(decided.resolution).toContain("Workstation 01 (fixed)");
    expect((await prisma.item.findUniqueOrThrow({ where: { id: ws.id } })).status).toBe("WORKING");
    const draft = await prisma.labVersion.findUniqueOrThrow({ where: { labItemId_kind: { labItemId: labId, kind: "DRAFT" } } });
    expect(draft.status).toBe("EDITING");
  });

  it("rejecting returns the draft to the custodian with the reason", async () => {
    await versions.refreshDraft(custodianId, labId);
    const ws = await itemNamed(labId, "Workstation 01 (fixed)");
    await versions.applyVersionEdit(custodianId, labId, "DRAFT", { kind: "setStatus", itemIds: [ws.id], value: "LOST" });
    const request = await versions.submitVersion(custodianId, labId, "DRAFT");
    await versions.decideCommit(headId, request.id, "REJECT", "It's in the other room");
    const states = await versions.getLabStates(custodianId, labId);
    expect(states.draft?.status).toBe("EDITING");
    expect(states.draft?.rejectionNote).toBe("It's in the other room");
    await versions.discardVersion(custodianId, labId, "DRAFT");
  });

  it("the admin's own edits stay direct", async () => {
    const ws = await itemNamed(labId, "Workstation 02");
    const r = await mutate.applyChange(sysAdminId, { kind: "setName", itemIds: [ws.id], value: "Workstation 02b" });
    expect(r.staged).toBeUndefined();
    expect(r.applied).toBe(1);
  });
});

describe("Deciding — only the lab's own head", () => {
  let labId: string;
  beforeAll(async () => {
    labId = await makeLab("LV Lab B", 2);
  }, 60_000);

  it("another manager cannot decide, and the custodian can take the changes back", async () => {
    await versions.applyVersionEdit(custodianId, labId, "DRAFT", { kind: "createItem", parentId: labId, categoryId: wsCat, count: 1, name: "Workstation" });
    const request = await versions.submitVersion(custodianId, labId, "DRAFT");
    const stranger = await makeUser("other-head", ["MANAGER"]);
    await expect(versions.decideCommit(stranger, request.id, "APPROVE")).rejects.toMatchObject({ status: 403 });
    await versions.withdrawVersion(custodianId, labId, "DRAFT");
    expect((await prisma.labCommitRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("CANCELLED");
  });
});
