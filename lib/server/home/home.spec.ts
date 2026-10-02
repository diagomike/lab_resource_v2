import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** Emails, captured instead of sent. */
const sent: { to: string; subject: string }[] = [];
vi.mock("../mail/mail", () => ({ send: async (m: { to: string; subject: string }) => void sent.push({ to: m.to, subject: m.subject }) }));

/** DB-backed — every notice leaves a row under the bell (whatever the email setting),
 *  and Home counts what waits for each person from the same services the screens use.
 *  Runs on its own orphan department. */
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

let home: typeof import("./home");
let notifications: typeof import("./notifications");
let notify: typeof import("../mail/notify");
let places: typeof import("../resources/places");
let categories: typeof import("../resources/categories");
let purchasing: typeof import("../resources/purchasing");
let mutate: typeof import("../resources/mutate");
let prisma: (typeof import("../prisma"))["prisma"];

const testKey = `__test-home-${Date.now()}`;
let sysAdminId: string;
let deptId: string;
let groupId: string;
let labCat: string;
let thingCat: string;
let headId: string;
let custodianId: string;
let quietId: string;
let disabledId: string;
let labId: string;
const createdUserIds: string[] = [];

async function makeUser(suffix: string, roles: string[], extra: { emailNotifications?: boolean; status?: "ACTIVE" | "DISABLED" } = {}) {
  const email = `${testKey}-${suffix}@astu.edu.et`;
  const user = await prisma.user.create({
    data: {
      email,
      emailLower: email,
      name: `Home ${suffix}`,
      status: extra.status ?? "ACTIVE",
      emailNotifications: extra.emailNotifications ?? true,
      homeNodeId: deptId,
      roles: { create: roles.map((kind) => ({ kind: kind as never })) },
    },
  });
  createdUserIds.push(user.id);
  return user.id;
}

beforeAll(async () => {
  home = await import("./home");
  notifications = await import("./notifications");
  notify = await import("../mail/notify");
  places = await import("../resources/places");
  categories = await import("../resources/categories");
  purchasing = await import("../resources/purchasing");
  mutate = await import("../resources/mutate");
  ({ prisma } = await import("../prisma"));

  sysAdminId = (await prisma.user.findFirstOrThrow({ where: { roles: { some: { kind: "SYS_ADMIN" } } } })).id;
  deptId = (await prisma.orgNode.create({ data: { name: `${testKey}-dept`, level: 2, kind: "DEPARTMENT" } })).id;
  await prisma.orgClosure.create({ data: { ancestorId: deptId, descendantId: deptId, depth: 0 } });
  groupId = (await prisma.categoryGroup.create({ data: { name: testKey, sortOrder: 999 } })).id;
  const base = { groupId, countingMode: "SERIALIZED" as const, impairRule: "NEVER" as const, templateChildren: [], iconKey: "Package" };
  labCat = (await categories.create(sysAdminId, { ...base, key: `${testKey}-lab`, name: "Home Lab", isPlace: true, fields: [] })).id;
  thingCat = (await categories.create(sysAdminId, { ...base, key: `${testKey}-thing`, name: "Home Thing", isPlace: false, fields: [] })).id;

  headId = await makeUser("head", ["MANAGER"]);
  await prisma.orgNode.update({ where: { id: deptId }, data: { userId: headId } });
  custodianId = await makeUser("custodian", ["CUSTODIAN"]);
  quietId = await makeUser("quiet", ["CUSTODIAN"], { emailNotifications: false });
  disabledId = await makeUser("disabled", ["CUSTODIAN"], { status: "DISABLED" });
  labId = (await places.createPlace(headId, { categoryId: labCat, name: `${testKey} Lab`, ownerOrgNodeId: deptId, custodianId, props: {} })).id;
}, 60_000);

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.needLine.deleteMany({ where: { orgNodeId: deptId } });
  await prisma.labVersion.deleteMany({ where: { labItemId: labId } });
  const all = await prisma.item.findMany({ where: { ownerOrgNodeId: deptId }, select: { id: true } });
  await prisma.itemChange.deleteMany({ where: { itemId: { in: all.map((i) => i.id) } } });
  for (let pass = 0; pass < 5; pass++) await prisma.item.deleteMany({ where: { ownerOrgNodeId: deptId, children: { none: {} } } });
  await prisma.itemChange.deleteMany({ where: { OR: [{ categoryId: { in: [labCat, thingCat] } }, { actorId: { in: createdUserIds } }] } });
  await prisma.resourceCategory.deleteMany({ where: { id: { in: [labCat, thingCat] } } });
  await prisma.categoryGroup.delete({ where: { id: groupId } });
  await prisma.orgNode.update({ where: { id: deptId }, data: { userId: null } });
  await prisma.userRole.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.orgClosure.deleteMany({ where: { OR: [{ ancestorId: deptId }, { descendantId: deptId }] } });
  await prisma.orgNode.delete({ where: { id: deptId } });
  await prisma.$disconnect();
}, 60_000);

describe("notices under the bell", () => {
  it("every active recipient gets a row, whatever their email setting; only the opted-in get the email; never the actor", async () => {
    const mark = sent.length;
    await notify.notify([custodianId, quietId, disabledId, headId], headId, {
      subject: `${testKey}: something for you`,
      paragraphs: ["<strong>The chairs</strong> &amp; tables arrived.", "Second paragraph."],
      path: "/approvals?focus=transfer:x",
    });
    const rows = await prisma.notification.findMany({ where: { title: `${testKey}: something for you` } });
    expect(rows.map((r) => r.userId).sort()).toEqual([custodianId, quietId].sort());
    expect(rows[0]).toMatchObject({ body: "The chairs & tables arrived.", path: "/approvals?focus=transfer:x", actorId: headId, readAt: null });
    expect(sent.slice(mark).map((m) => m.to)).toEqual([`${testKey}-custodian@astu.edu.et`]);
  });

  it("lists newest first with the unread count, and marks read one at a time or all at once", async () => {
    const before = await notifications.listNotifications(quietId);
    expect(before.unread).toBe(1);
    expect(before.items[0]).toMatchObject({ title: `${testKey}: something for you`, actorName: "Home head", read: false });
    expect(await notifications.markRead(quietId, { ids: [before.items[0].id] })).toBe(1);
    expect((await notifications.listNotifications(quietId)).unread).toBe(0);
    expect(await notifications.markRead(custodianId, { all: true })).toBeGreaterThan(0);
    expect(await notifications.unreadCount(custodianId)).toBe(0);
  });

  it("nobody marks someone else's notices read", async () => {
    const [row] = await prisma.notification.findMany({ where: { userId: custodianId }, take: 1 });
    await prisma.notification.update({ where: { id: row.id }, data: { readAt: null } });
    expect(await notifications.markRead(headId, { ids: [row.id] })).toBe(0);
    expect(await notifications.unreadCount(custodianId)).toBe(1);
  });

  it("the sweep removes notices older than 90 days", async () => {
    const old = await prisma.notification.create({ data: { userId: quietId, title: "old", body: "", path: "/home", createdAt: new Date(Date.now() - 91 * 86_400_000) } });
    expect(await notifications.sweepOldNotifications()).toBeGreaterThanOrEqual(1);
    expect(await prisma.notification.findUnique({ where: { id: old.id } })).toBeNull();
  });
});

describe("Home", () => {
  it("the custodian heard about the lab they were given, with a link to it", async () => {
    const rows = await prisma.notification.findMany({ where: { userId: custodianId, path: `/places/${labId}` } });
    expect(rows.length).toBe(1);
  });

  it("a need the custodian asks for waits for the head: Home's next step and the Purchasing badge", async () => {
    await purchasing.raiseNeed(custodianId, { labItemId: labId, name: "Oscilloscope", qty: 2, reason: "Two broke this term" });
    const counts = await home.homeCounts(headId);
    expect(counts.purchasing).toBe(1);
    const h = await home.homeFor(headId);
    expect(h.waiting).toEqual([{ kind: "needs", label: "Needs to build into a purchase request", count: 1, path: "/purchasing?tab=needs" }]);
    expect(h.nextStep).toMatchObject({ path: "/purchasing?tab=needs", action: "Build a request" });
    expect(h.glance).toMatchObject({ places: 1 });

    const mine = await home.homeFor(custodianId);
    expect(mine.mine.map((r) => r.label)).toContain(`Oscilloscope × 2 · ${testKey} Lab`);
  });

  it("changes made in a lab and not sent are unfinished work: on Home and the Labs & stores badge", async () => {
    const staged = await mutate.applyChange(custodianId, {
      kind: "createItem",
      parentId: labId,
      categoryId: thingCat,
      count: 1,
      name: "Bench",
      ownerOrgNodeId: deptId,
      custodianId,
      props: {},
    });
    expect(staged).toBeTruthy();
    const h = await home.homeFor(custodianId);
    expect(h.unfinished).toEqual([{ label: `Send your changes for ${testKey} Lab`, detail: "1 change not sent to the head yet.", path: `/places/${labId}?tab=draft` }]);
    expect(h.nextStep).toMatchObject({ title: `Send your changes for ${testKey} Lab` });
    expect((await home.homeCounts(custodianId)).places).toBe(1);
  });

  it("someone with nothing waiting is all caught up", async () => {
    const h = await home.homeFor(quietId);
    expect(h.nextStep).toBeNull();
    expect(h.waiting).toEqual([]);
    expect(h.glance).toBeNull();
    expect(h.admin).toBeNull();
  });
});
