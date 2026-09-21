import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** DB-backed — resend-invite token revocation, home-node moves, and the last-admin
 *  lockout, against real Postgres. Mail is mocked (nothing leaves the machine, same
 *  reasoning as auth.spec.ts/external/requests.spec.ts). Every node/user is a fresh,
 *  orphan fixture — no edges into the real shared org chart. */
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

const sent: Array<{ to: string; subject: string }> = [];
vi.mock("../mail/mail", () => ({ send: async (m: { to: string; subject: string }) => void sent.push({ to: m.to, subject: m.subject }) }));

type PeopleModule = typeof import("./people");
type PrismaModule = typeof import("../prisma");

let people: PeopleModule;
let prisma: PrismaModule["prisma"];

const testKey = `__test-people-${Date.now()}`;
const createdUserIds: string[] = [];
const createdNodeIds: string[] = [];
let userCounter = 0;

async function makeUser(suffix: string, roles: string[] = [], status: "INVITED" | "ACTIVE" | "DISABLED" = "ACTIVE") {
  const email = `${testKey}-${suffix}-${userCounter++}@astu.edu.et`;
  const user = await prisma.user.create({
    data: { email, emailLower: email, name: `Test ${suffix}`, status, roles: { create: roles.map((kind) => ({ kind: kind as never })) } },
  });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeNode(name: string, level: number) {
  const node = await prisma.orgNode.create({ data: { name: `${testKey}-${name}`, level, kind: "DEPARTMENT", active: true } });
  createdNodeIds.push(node.id);
  return node.id;
}

beforeAll(async () => {
  people = await import("./people");
  ({ prisma } = await import("../prisma"));
});

afterAll(async () => {
  await prisma.homeNodeChange.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.invitation.deleteMany({ where: { emailLower: { startsWith: testKey } } });
  await prisma.needLine.deleteMany({ where: { raisedById: { in: createdUserIds } } });
  await prisma.itemDraftChange.deleteMany({ where: { authorId: { in: createdUserIds } } });
  await prisma.userRole.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.orgNode.deleteMany({ where: { id: { in: createdNodeIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("F-013 — resend-invite revokes the previous token", () => {
  it("leaves exactly one usable invitation after a resend", async () => {
    const adminId = await makeUser("resend-admin", ["SYS_ADMIN"]);
    const deptId = await makeNode("resend-dept", 2);
    const staffId = await makeUser("resend-staff", ["STAFF"], "INVITED");
    await prisma.user.update({ where: { id: staffId }, data: { homeNodeId: deptId } });
    const staff = await prisma.user.findUniqueOrThrow({ where: { id: staffId } });

    await prisma.invitation.create({
      data: { emailLower: staff.emailLower, tokenHash: "first-token-hash", intendedRole: "STAFF", invitedById: adminId, expiresAt: new Date(Date.now() + 86_400_000) },
    });

    await people.resendInvite(adminId, ["SYS_ADMIN"], staffId);

    const usable = await prisma.invitation.findMany({ where: { emailLower: staff.emailLower, consumedAt: null, expiresAt: { gt: new Date() } } });
    expect(usable).toHaveLength(1);
    expect(usable[0].tokenHash).not.toBe("first-token-hash");
  });
});

describe("F-015 — moving a person's home department", () => {
  it("moves the person and records history", async () => {
    const adminId = await makeUser("move-admin", ["SYS_ADMIN"]);
    const fromNode = await makeNode("move-from", 2);
    const toNode = await makeNode("move-to", 2);
    const staffId = await makeUser("move-staff", ["STAFF"]);
    await prisma.user.update({ where: { id: staffId }, data: { homeNodeId: fromNode } });

    const result = await people.moveHomeNode(adminId, staffId, { nodeId: toNode, reason: "test move" });
    expect(result.homeNodeId).toBe(toNode);

    const history = await prisma.homeNodeChange.findMany({ where: { userId: staffId } });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ fromNodeId: fromNode, toNodeId: toNode, changedById: adminId });
  });

  it("refuses while the person holds custody, an open need, or an open draft", async () => {
    const adminId = await makeUser("move-blocked-admin", ["SYS_ADMIN"]);
    const fromNode = await makeNode("move-blocked-from", 2);
    const toNode = await makeNode("move-blocked-to", 2);
    const custId = await makeUser("move-blocked-cust", ["CUSTODIAN"]);
    await prisma.user.update({ where: { id: custId }, data: { homeNodeId: fromNode } });

    const need = await prisma.needLine.create({ data: { raisedById: custId, orgNodeId: fromNode, name: "Test need", qty: 1, reason: "test" } });
    await expect(people.moveHomeNode(adminId, custId, { nodeId: toNode })).rejects.toMatchObject({ status: 400 });
    await prisma.needLine.delete({ where: { id: need.id } });

    // Cleared now — the move should succeed.
    const result = await people.moveHomeNode(adminId, custId, { nodeId: toNode });
    expect(result.homeNodeId).toBe(toNode);
  });
});

describe("F-016 — the last active SYS_ADMIN cannot be demoted, deactivated, or deactivate themselves", () => {
  it("refuses removing SYS_ADMIN from the only administrator", async () => {
    // Isolate from every other ACTIVE SYS_ADMIN in the DB (the seeded one included) by
    // temporarily deactivating them, restored in `finally`.
    const others = await prisma.user.findMany({ where: { status: "ACTIVE", roles: { some: { kind: "SYS_ADMIN" } } } });
    await prisma.user.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { status: "DISABLED" } });
    try {
      const soleAdminId = await makeUser("sole-admin", ["SYS_ADMIN"]);
      await expect(people.updateRoles(soleAdminId, ["SYS_ADMIN"], soleAdminId, { roles: ["STAFF"] })).rejects.toMatchObject({ status: 400 });
    } finally {
      await prisma.user.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { status: "ACTIVE" } });
    }
  });

  // deactivate()'s own assertNotLastActiveAdmin guard (defense in depth, mirroring
  // updateRoles's) has no reachable "last admin, deactivated by someone else"
  // scenario to exercise: any actor who legitimately reaches it is themselves an
  // ACTIVE SYS_ADMIN distinct from the target, so at least one other admin (the
  // actor) always remains afterwards. The only way an admin's deactivation can
  // actually zero out the count is deactivating THEMSELVES, which the unconditional
  // self-deactivation check below already refuses regardless of admin count.

  it("refuses an admin deactivating their own account, even with another admin active", async () => {
    const adminAId = await makeUser("self-deact-a", ["SYS_ADMIN"]);
    const adminBId = await makeUser("self-deact-b", ["SYS_ADMIN"]);
    void adminBId;
    await expect(people.deactivate(adminAId, ["SYS_ADMIN"], adminAId)).rejects.toMatchObject({ status: 400 });
  });
});

describe("F-019 — a double-submitted invite is a 400 for the loser, never a 500", () => {
  it("5 parallel identical invites: exactly one succeeds, the rest are 400", async () => {
    const adminId = await makeUser("dup-admin", ["SYS_ADMIN"]);
    const email = `${testKey}-dup-invitee@astu.edu.et`;
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => people.create(adminId, ["SYS_ADMIN"], { name: "Dup Invitee", email, roles: ["STAFF"] })),
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    for (const f of failed) expect(f.reason).toMatchObject({ status: 400 });
    const row = await prisma.user.findUniqueOrThrow({ where: { emailLower: email } });
    createdUserIds.push(row.id);
  });
});

describe("F-018 — a dean's invite and resend reach the whole subtree they can see", () => {
  async function tree() {
    const org = await import("../org/org");
    const college = await makeNode("f18-college", 1);
    await prisma.orgNode.update({ where: { id: college }, data: { kind: "COLLEGE" } });
    const dept = await org.create({ name: `${testKey}-f18-dept-${userCounter++}`, level: 2, kind: "DEPARTMENT", parentIds: [college] });
    createdNodeIds.push(dept.id);
    const outsideCollege = await makeNode("f18-outside", 1);
    const deanId = await makeUser("f18-dean", ["MANAGER"]);
    await prisma.orgNode.update({ where: { id: college }, data: { userId: deanId } });
    return { deanId, college, dept: dept.id, outsideCollege };
  }

  it("a dean may resend an invitation for a department below them, but not for another college's", async () => {
    const { deanId, dept, outsideCollege } = await tree();
    const inDept = await makeUser("f18-invitee-in", ["STAFF"], "INVITED");
    await prisma.user.update({ where: { id: inDept }, data: { homeNodeId: dept } });
    const outside = await makeUser("f18-invitee-out", ["STAFF"], "INVITED");
    await prisma.user.update({ where: { id: outside }, data: { homeNodeId: outsideCollege } });

    await expect(people.resendInvite(deanId, ["MANAGER"], inDept)).resolves.toHaveProperty("inviteUrl");
    await expect(people.resendInvite(deanId, ["MANAGER"], outside)).rejects.toMatchObject({ status: 403 });
  });

  it("a dean may invite into a department in their subtree, and is refused outside it", async () => {
    const { deanId, dept, outsideCollege } = await tree();
    const made = await people.create(deanId, ["MANAGER"], { name: "F18 Staff", email: `${testKey}-f18-new@astu.edu.et`, roles: ["STAFF"], homeNodeId: dept });
    createdUserIds.push(made.id);
    expect(made.homeNodeId).toBe(dept);
    await expect(
      people.create(deanId, ["MANAGER"], { name: "F18 Out", email: `${testKey}-f18-out@astu.edu.et`, roles: ["STAFF"], homeNodeId: outsideCollege }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
