import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** Notifications (lib/server/mail/notify.ts), captured instead of sent. */
const sent: { to: string; subject: string }[] = [];
vi.mock("../mail/mail", () => ({ send: async (m: { to: string; subject: string }) => void sent.push({ to: m.to, subject: m.subject }) }));

/** DB-backed — categories belong to the department that made them: adding goes through
 *  (the head is told), changing data waits for the head, and reaching another
 *  department's items passes the admin and Property Administration. Runs on its own
 *  orphan college and two departments. */
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

type GovModule = typeof import("./category-governance");
type PrismaModule = typeof import("../prisma");

let gov: GovModule;
let prisma: PrismaModule["prisma"];

const testKey = `__test-catgov-${Date.now()}`;
let sysAdminId: string;
let propertyAdminId: string;
let deptA: string;
let deptB: string;
let groupId: string;
let headA: string;
let custodianA: string;
let custodianB: string;
let staffNobody: string;
const createdUserIds: string[] = [];
const createdNodeIds: string[] = [];

async function makeUser(suffix: string, roles: string[], homeNodeId: string | null) {
  const email = `${testKey}-${suffix}@astu.edu.et`;
  const user = await prisma.user.create({
    data: { email, emailLower: email, name: `Gov ${suffix}`, status: "ACTIVE", homeNodeId, roles: { create: roles.map((kind) => ({ kind: kind as never })) } },
  });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeNode(name: string, kind: "COLLEGE" | "DEPARTMENT", level: number, parentId?: string, code?: string) {
  const node = await prisma.orgNode.create({ data: { name: `${testKey}-${name}`, level, kind, code } });
  createdNodeIds.push(node.id);
  await prisma.orgClosure.create({ data: { ancestorId: node.id, descendantId: node.id, depth: 0 } });
  if (parentId) {
    await prisma.orgEdge.create({ data: { parentId, childId: node.id } });
    await prisma.orgClosure.create({ data: { ancestorId: parentId, descendantId: node.id, depth: 1 } });
  }
  return node.id;
}

const emailOf = (id: string) => prisma.user.findUniqueOrThrow({ where: { id }, select: { email: true } }).then((u) => u.email);
const mailTo = async (id: string, mark: number) => {
  const email = await emailOf(id);
  return sent.slice(mark).filter((m) => m.to === email).map((m) => m.subject);
};

const reading = (over: Record<string, unknown> = {}) => ({ key: "reading", label: "Reading", type: "TEXT" as const, options: [], summary: false, longText: false, required: false, sortOrder: 0, ...over });

async function categoryWithItems(actorId: string, name: string, owners: string[]) {
  const cat = await gov.createCategory(actorId, { name: `${testKey} ${name}`, iconKey: "Box", groupId, countingMode: "SERIALIZED", impairRule: "NEVER", isPlace: false, templateChildren: [], fields: [reading()] });
  for (const [i, owner] of owners.entries()) {
    await prisma.item.create({
      data: { categoryId: cat.id, name: `${name} ${i + 1}`, countingMode: "SERIALIZED", qty: 1, status: "WORKING", props: { reading: "16" }, ownerOrgNodeId: owner, currentOrgNodeId: owner, custodianId: sysAdminId },
    });
  }
  return cat;
}

const retype = (cat: { id: string; version: number }) => ({ expectedVersion: cat.version, fields: [reading({ type: "NUMBER" })] });

beforeAll(async () => {
  gov = await import("./category-governance");
  ({ prisma } = await import("../prisma"));

  sysAdminId = (await prisma.user.findFirstOrThrow({ where: { roles: { some: { kind: "SYS_ADMIN" } } } })).id;
  const college = await makeNode("college", "COLLEGE", 1);
  deptA = await makeNode("dept-a", "DEPARTMENT", 2, college, `${testKey}-A`.slice(-12));
  deptB = await makeNode("dept-b", "DEPARTMENT", 2, college, `${testKey}-B`.slice(-12));
  groupId = (await prisma.categoryGroup.create({ data: { name: testKey, sortOrder: 999 } })).id;

  headA = await makeUser("head-a", ["MANAGER"], deptA);
  await prisma.orgNode.update({ where: { id: deptA }, data: { userId: headA } });
  custodianA = await makeUser("custodian-a", ["CUSTODIAN"], deptA);
  custodianB = await makeUser("custodian-b", ["CUSTODIAN"], deptB);
  staffNobody = await makeUser("nobody", [], deptA);
  propertyAdminId = await makeUser("property-admin", ["PROPERTY_ADMIN"], null);
}, 60_000);

afterAll(async () => {
  const cats = await prisma.resourceCategory.findMany({ where: { groupId }, select: { id: true } });
  await prisma.item.deleteMany({ where: { categoryId: { in: cats.map((c) => c.id) } } });
  await prisma.itemChange.deleteMany({ where: { categoryId: { in: cats.map((c) => c.id) } } });
  await prisma.resourceCategory.deleteMany({ where: { groupId } });
  await prisma.categoryGroup.delete({ where: { id: groupId } });
  await prisma.orgNode.updateMany({ where: { id: { in: createdNodeIds } }, data: { userId: null } });
  await prisma.itemChange.deleteMany({ where: { actorId: { in: createdUserIds } } });
  await prisma.userRole.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.orgClosure.deleteMany({ where: { OR: [{ ancestorId: { in: createdNodeIds } }, { descendantId: { in: createdNodeIds } }] } });
  await prisma.orgEdge.deleteMany({ where: { OR: [{ parentId: { in: createdNodeIds } }, { childId: { in: createdNodeIds } }] } });
  await prisma.orgNode.deleteMany({ where: { id: { in: createdNodeIds } } });
  await prisma.$disconnect();
}, 60_000);

describe("adding goes through, and the head is told", () => {
  it("a custodian adds a category for their department; their head hears of it", async () => {
    const mark = sent.length;
    const cat = await gov.createCategory(custodianA, { name: `${testKey} Spectrometer`, iconKey: "Box", groupId, countingMode: "SERIALIZED", impairRule: "NEVER", isPlace: false, templateChildren: [], fields: [reading()] });
    expect(cat).toMatchObject({ stewardNodeId: deptA, createdByName: "Gov custodian-a" });
    expect(await mailTo(headA, mark)).toEqual([`Gov custodian-a added the category ${testKey} Spectrometer`]);
  });

  it("someone who is neither a custodian nor a head cannot add one", async () => {
    await expect(gov.createCategory(staffNobody, { name: `${testKey} Nope`, iconKey: "Box", groupId, countingMode: "SERIALIZED", impairRule: "NEVER", isPlace: false, templateChildren: [], fields: [] })).rejects.toMatchObject({ status: 403 });
  });

  it("an edit that only adds applies at once, even on a category with items", async () => {
    const cat = await categoryWithItems(custodianA, "Additive", [deptA]);
    const mark = sent.length;
    const res = await gov.saveCategory(custodianA, cat.id, { expectedVersion: cat.version, fields: [reading(), reading({ key: undefined, label: "Serial no.", sortOrder: 1 })] });
    expect(res.status).toBe("APPLIED");
    expect(res.category.fields.map((f) => f.label)).toEqual(["Reading", "Serial no."]);
    expect(await mailTo(headA, mark)).toEqual([`Gov custodian-a changed the category ${testKey} Additive`]);
  });
});

describe("changing data waits for the head", () => {
  it("a custodian's retype waits; the category stays as it was until the head approves", async () => {
    const cat = await categoryWithItems(custodianA, "Waits", [deptA]);
    const mark = sent.length;
    const res = await gov.saveCategory(custodianA, cat.id, retype(cat));
    expect(res.status).toBe("PENDING");
    expect(res.change).toMatchObject({ stages: ["HEAD"], stage: "HEAD", summary: ["Changes “Reading” from text to a number (1 value)"], isMine: true });
    expect(res.category.fields[0].type).toBe("TEXT");
    expect(res.category.pendingChanges).toBe(1);
    expect(await mailTo(headA, mark)).toEqual([`A change to ${testKey} Waits is waiting for your approval`]);

    const { waiting } = await gov.listChanges(headA);
    expect(waiting.map((c) => c.id)).toContain(res.change!.id);
    await expect(gov.decideChange(custodianB, res.change!.id, { approve: true })).rejects.toMatchObject({ status: 403 });

    const done = await gov.decideChange(headA, res.change!.id, { approve: true });
    expect(done.status).toBe("APPROVED");
    const item = await prisma.item.findFirstOrThrow({ where: { categoryId: cat.id } });
    expect((item.props as Record<string, unknown>).reading).toBe(16);
    expect(await mailTo(custodianA, mark)).toEqual([`Your change to ${testKey} Waits was approved`]);
  });

  it("the head's own change to their department's data applies directly", async () => {
    const cat = await categoryWithItems(headA, "Head direct", [deptA]);
    expect((await gov.saveCategory(headA, cat.id, retype(cat))).status).toBe("APPLIED");
  });

  it("a change approved after the category moved on goes stale instead of overwriting", async () => {
    const cat = await categoryWithItems(custodianA, "Stale", [deptA]);
    const res = await gov.saveCategory(custodianA, cat.id, retype(cat));
    await gov.saveCategory(headA, cat.id, { expectedVersion: cat.version, fields: [reading({ type: "NUMBER", unit: "V" })] });
    const done = await gov.decideChange(headA, res.change!.id, { approve: true });
    expect(done.status).toBe("STALE");
  });

  it("the proposer can withdraw; a rejection keeps the category as it was", async () => {
    const cat = await categoryWithItems(custodianA, "Withdraw", [deptA]);
    const first = await gov.saveCategory(custodianA, cat.id, retype(cat));
    expect((await gov.withdrawChange(custodianA, first.change!.id)).status).toBe("WITHDRAWN");
    const second = await gov.saveCategory(custodianA, cat.id, retype(cat));
    const rejected = await gov.decideChange(headA, second.change!.id, { approve: false, note: "Keep it text" });
    expect(rejected).toMatchObject({ status: "REJECTED", trail: [{ approved: false, note: "Keep it text" }] });
  });
});

describe("reaching other departments' items escalates", () => {
  it("head → admin → Property Administration, and the preview says so", async () => {
    const cat = await categoryWithItems(headA, "Shared", [deptA, deptB]);
    const preview = await gov.previewEdit(headA, cat.id, { fields: [reading({ type: "NUMBER" })] });
    expect(preview.decision).toMatchObject({ applies: false, approvers: ["the admin", "Property Administration"], reaches: [`${testKey}-dept-b`] });

    const res = await gov.saveCategory(headA, cat.id, retype(cat));
    expect(res.change).toMatchObject({ stages: ["ADMIN", "PROPERTY_ADMIN"], stage: "ADMIN" });
    expect((await gov.decideChange(sysAdminId, res.change!.id, { approve: true })).stage).toBe("PROPERTY_ADMIN");
    await expect(gov.decideChange(sysAdminId, res.change!.id, { approve: true })).rejects.toMatchObject({ status: 403 });
    expect((await gov.decideChange(propertyAdminId, res.change!.id, { approve: true })).status).toBe("APPROVED");
  });

  it("a custodian's goes through their head first", async () => {
    const cat = await categoryWithItems(custodianA, "Shared 2", [deptA, deptB]);
    const res = await gov.saveCategory(custodianA, cat.id, retype(cat));
    expect(res.change?.stages).toEqual(["HEAD", "ADMIN", "PROPERTY_ADMIN"]);
  });

  it("Property Administration's own edit applies", async () => {
    const cat = await categoryWithItems(headA, "Shared 3", [deptA, deptB]);
    expect((await gov.saveCategory(propertyAdminId, cat.id, retype(cat))).status).toBe("APPLIED");
  });
});

describe("a copy for my department, and removing", () => {
  it("another department copies a category instead of changing it", async () => {
    const source = await categoryWithItems(custodianA, "Copied", [deptA]);
    const copy = await gov.copyCategory(custodianB, source.id);
    expect(copy).toMatchObject({ stewardNodeId: deptB, fields: [{ key: "reading", label: "Reading" }] });
    expect(copy.name.startsWith(`${testKey} Copied (`)).toBe(true);
  });

  it("only its maker, its department's head or Property Administration removes it", async () => {
    const cat = await gov.createCategory(custodianA, { name: `${testKey} Removable`, iconKey: "Box", groupId, countingMode: "SERIALIZED", impairRule: "NEVER", isPlace: false, templateChildren: [], fields: [] });
    await expect(gov.removeCategory(custodianB, cat.id, {})).rejects.toMatchObject({ status: 403 });
    await gov.removeCategory(custodianA, cat.id, {});
    expect(await prisma.resourceCategory.findUnique({ where: { id: cat.id } })).toBeNull();
  });
});
