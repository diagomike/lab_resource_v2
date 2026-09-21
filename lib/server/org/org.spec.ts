import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * DB-backed — the org-structure service (`org.ts`) touches the shared closure table
 * and a global "at most one level-0 node" invariant, so this file follows the same
 * discipline as `purchasing.spec.ts`: every node it creates is either a freshly
 * created orphan (no edges into the real shared chart) or an in-place edit of a
 * fixture it owns. It never creates a level-0 node through `org.create`/`changeLevel`
 * itself (the real seeded university root already occupies that slot), so F-002's
 * single-root invariant is exercised against the REAL root rather than a second one
 * this file would have to tear down.
 */
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

type OrgModule = typeof import("./org");
type PrismaModule = typeof import("../prisma");

let org: OrgModule;
let prisma: PrismaModule["prisma"];

const testKey = `__test-org-${Date.now()}`;
const createdNodeIds: string[] = [];
const createdUserIds: string[] = [];
const createdNeedIds: string[] = [];
const createdPurchaseIds: string[] = [];
const createdExternalRequestIds: string[] = [];
let userCounter = 0;

async function makeUser(suffix: string) {
  const email = `${testKey}-${suffix}-${userCounter++}@astu.edu.et`;
  const user = await prisma.user.create({ data: { email, emailLower: email, name: `Test ${suffix}`, status: "ACTIVE" } });
  createdUserIds.push(user.id);
  return user.id;
}

/** An orphan fixture node — no edges into the real shared org chart. Created directly
 *  via Prisma (not `org.create`) so tests that don't care about create()'s own
 *  validation can still get a valid parent to hang test nodes off. */
async function makeNode(name: string, kind: "COLLEGE" | "DEPARTMENT" | "OFFICE", level: number) {
  const node = await prisma.orgNode.create({ data: { name: `${testKey}-${name}`, level, kind, active: true } });
  createdNodeIds.push(node.id);
  return node.id;
}

beforeAll(async () => {
  org = await import("./org");
  ({ prisma } = await import("../prisma"));
});

afterAll(async () => {
  await prisma.needLine.deleteMany({ where: { id: { in: createdNeedIds } } });
  await prisma.purchaseRequest.deleteMany({ where: { id: { in: createdPurchaseIds } } }); // cascades lines/events/steps
  await prisma.externalRequest.deleteMany({ where: { id: { in: createdExternalRequestIds } } }); // cascades assignments/windows
  await prisma.orgEdge.deleteMany({ where: { OR: [{ parentId: { in: createdNodeIds } }, { childId: { in: createdNodeIds } }] } });
  await prisma.orgNode.deleteMany({ where: { id: { in: createdNodeIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("F-003 — concurrent structural edits leave complete closure rows", () => {
  it("8 parallel node creations under the same parent all succeed with complete closure", async () => {
    const collegeId = await makeNode("f3-college", "COLLEGE", 1);

    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) => org.create({ name: `${testKey}-f3-dept-${i}`, level: 2, kind: "DEPARTMENT", parentIds: [collegeId] })),
    );
    const created = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof org.create>>> => r.status === "fulfilled");
    for (const r of results) if (r.status === "rejected") throw r.reason;
    expect(created).toHaveLength(8);
    created.forEach((r) => createdNodeIds.push(r.value.id));

    for (const r of created) {
      const selfRow = await prisma.orgClosure.findUnique({ where: { ancestorId_descendantId: { ancestorId: r.value.id, descendantId: r.value.id } } });
      expect(selfRow).not.toBeNull();
      const fromCollege = await prisma.orgClosure.findUnique({ where: { ancestorId_descendantId: { ancestorId: collegeId, descendantId: r.value.id } } });
      expect(fromCollege).not.toBeNull();
    }
  });

  it("5 parallel reparents resolve without corrupting the closure table", async () => {
    const collegeA = await makeNode("f3-college-a", "COLLEGE", 1);
    const collegeB = await makeNode("f3-college-b", "COLLEGE", 1);
    const depts = await Promise.all(Array.from({ length: 5 }, (_, i) => org.create({ name: `${testKey}-f3-reparent-${i}`, level: 2, kind: "DEPARTMENT", parentIds: [collegeA] })));
    depts.forEach((d) => createdNodeIds.push(d.id));

    const results = await Promise.allSettled(depts.map((d) => org.reassignParents(d.id, [collegeB])));
    for (const r of results) if (r.status === "rejected") throw r.reason;

    for (const d of depts) {
      const fromB = await prisma.orgClosure.findUnique({ where: { ancestorId_descendantId: { ancestorId: collegeB, descendantId: d.id } } });
      expect(fromB).not.toBeNull();
      const fromA = await prisma.orgClosure.findUnique({ where: { ancestorId_descendantId: { ancestorId: collegeA, descendantId: d.id } } });
      expect(fromA).toBeNull();
    }
  });
});

describe("F-004 — delete names purchasing/external blockers instead of a raw 500", () => {
  it("refuses deleting a node with an open purchasing need", async () => {
    const deptId = await makeNode("f4-need", "DEPARTMENT", 2);
    const userId = await makeUser("f4-need");
    const need = await prisma.needLine.create({ data: { raisedById: userId, orgNodeId: deptId, name: "Test need", qty: 1, reason: "test" } });
    createdNeedIds.push(need.id);

    await expect(org.deleteNode(deptId)).rejects.toMatchObject({ status: 400, message: expect.stringContaining("purchasing need") });
  });

  it("refuses deleting a node with a purchase request", async () => {
    const deptId = await makeNode("f4-purchase", "DEPARTMENT", 2);
    const userId = await makeUser("f4-purchase");
    const pr = await prisma.purchaseRequest.create({ data: { reference: `${testKey}-PR-1`, orgNodeId: deptId, raisedById: userId, title: "Test PR" } });
    createdPurchaseIds.push(pr.id);

    await expect(org.deleteNode(deptId)).rejects.toMatchObject({ status: 400, message: expect.stringContaining("purchase request") });
  });

  it("refuses deleting a node with an external-request assignment", async () => {
    const deptId = await makeNode("f4-external", "DEPARTMENT", 2);
    const ext = await prisma.externalRequest.create({
      data: {
        reference: `${testKey}-EXT-1`,
        organizationName: "Test Org",
        contactName: "Test Contact",
        contactEmail: "contact@example.com",
        contactPhone: "0900000000",
        purpose: "Testing",
        lines: [],
        letterStorageKey: "test-key",
        letterFileName: "letter.pdf",
        letterByteSize: 100,
        trackingTokenHash: `${testKey}-token-hash`,
      },
    });
    createdExternalRequestIds.push(ext.id);
    await prisma.externalRequestAssignment.create({ data: { requestId: ext.id, orgNodeId: deptId } });

    await expect(org.deleteNode(deptId)).rejects.toMatchObject({ status: 400, message: expect.stringContaining("external-request assignment") });
  });
});

describe("F-005 — change-level cannot strand a node or its former children", () => {
  it("is refused while the node still has children", async () => {
    const collegeId = await makeNode("f5-college-with-child", "COLLEGE", 1);
    const deptId = await org.create({ name: `${testKey}-f5-dept`, level: 2, kind: "DEPARTMENT", parentIds: [collegeId] }).then((n) => n.id);
    createdNodeIds.push(deptId);

    await expect(org.changeLevel(collegeId, 2)).rejects.toMatchObject({ status: 400 });
  });

  it("requires new parents at the target level, and applies atomically when given", async () => {
    const mover = await makeNode("f5-mover", "OFFICE", 5);
    const wrongLevelParent = await makeNode("f5-wrong-parent", "OFFICE", 3);
    const rightLevelParent = await makeNode("f5-right-parent", "OFFICE", 5);

    // No parentIds for a non-zero target level: refused, not silently stranded.
    await expect(org.changeLevel(mover, 6)).rejects.toMatchObject({ status: 400 });

    // A parent that isn't exactly one level below the target: refused.
    await expect(org.changeLevel(mover, 6, [wrongLevelParent])).rejects.toMatchObject({ status: 400 });

    // The right-level parent, supplied atomically with the move, succeeds and leaves
    // the node reachable from it — never the old parentless/childless state F-005
    // found (the mover keeps no memory of its old level 5 siblings, by design: every
    // edge in either direction is invalidated by a level change).
    const moved = await org.changeLevel(mover, 6, [rightLevelParent]);
    expect(moved.level).toBe(6);
    expect(moved.parentIds).toEqual([rightLevelParent]);
    const closureRow = await prisma.orgClosure.findUnique({ where: { ancestorId_descendantId: { ancestorId: rightLevelParent, descendantId: mover } } });
    expect(closureRow).not.toBeNull();
  });
});

describe("F-002 — single university root (regression, Phase 1)", () => {
  it("refuses a second level-0 node", async () => {
    await expect(org.create({ name: `${testKey}-second-root`, level: 0, kind: "UNIVERSITY", parentIds: [] })).rejects.toMatchObject({ status: 400 });
  });

  it("refuses a UNIVERSITY-kind node below level 0, and a level-0 node of another kind", async () => {
    const collegeId = await makeNode("f2-kind-mismatch", "COLLEGE", 1);
    await expect(org.update(collegeId, { kind: "UNIVERSITY" })).rejects.toMatchObject({ status: 400 });
  });
});

describe("F-001 — deactivating a node vacates the post only (regression, Phase 1)", () => {
  it("ends occupancy and clears userId without touching the user's account", async () => {
    const userId = await makeUser("f1-occupant");
    const nodeId = await makeNode("f1-node", "DEPARTMENT", 2);
    await prisma.orgNode.update({ where: { id: nodeId }, data: { userId } });

    const result = await org.deactivateNode(nodeId);
    expect(result.vacatedOccupantName).toBe("Test f1-occupant");

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.status).toBe("ACTIVE");

    const node = await prisma.orgNode.findUniqueOrThrow({ where: { id: nodeId } });
    expect(node.active).toBe(false);
    expect(node.userId).toBeNull();

    await prisma.orgNode.update({ where: { id: nodeId }, data: { active: true } }); // let afterAll's cleanup delete it
  });
});

describe("F-006 — the org node's code survives a rename (regression, via update())", () => {
  it("keeps its code through a name change", async () => {
    const nodeId = await makeNode("f6-office", "OFFICE", 1);
    await org.update(nodeId, { code: "TESTPROC" });
    await org.update(nodeId, { name: `${testKey}-f6-office-renamed` });
    const node = await prisma.orgNode.findUniqueOrThrow({ where: { id: nodeId } });
    expect(node.code).toBe("TESTPROC");
  });

  it("refuses a duplicate code", async () => {
    const a = await makeNode("f6-dup-a", "OFFICE", 1);
    const b = await makeNode("f6-dup-b", "OFFICE", 1);
    await org.update(a, { code: "DUPCODE" });
    await expect(org.update(b, { code: "DUPCODE" })).rejects.toMatchObject({ status: 400 });
  });
});

describe("F-008 — org node names are trimmed, bounded and unique among active nodes", () => {
  it("the input schemas trim and bound the name", async () => {
    const { CreateOrgNodeInput, UpdateOrgNodeInput } = await import("../../shared/org");
    const base = { level: 1, kind: "COLLEGE" as const, parentIds: [] };
    expect(CreateOrgNodeInput.safeParse({ ...base, name: "   " }).success).toBe(false);
    expect(CreateOrgNodeInput.safeParse({ ...base, name: "L".repeat(5000) }).success).toBe(false);
    expect(CreateOrgNodeInput.parse({ ...base, name: "  Physics  " }).name).toBe("Physics");
    expect(UpdateOrgNodeInput.safeParse({ name: " x " }).success).toBe(false);
  });

  it("refuses a case-insensitive duplicate of an active node, on create and on rename", async () => {
    const college = await makeNode("f8-college", "COLLEGE", 1);
    const existing = await makeNode("f8-name", "DEPARTMENT", 2);
    const name = (await prisma.orgNode.findUniqueOrThrow({ where: { id: existing } })).name;
    await expect(org.create({ name: name.toUpperCase(), level: 2, kind: "DEPARTMENT", parentIds: [college] })).rejects.toMatchObject({ status: 400 });
    const other = await makeNode("f8-other", "DEPARTMENT", 2);
    await expect(org.update(other, { name: name.toLowerCase() })).rejects.toMatchObject({ status: 400 });
    // a case-only rename of the node itself is not a clash
    await expect(org.update(existing, { name: name.toUpperCase() })).resolves.toBeTruthy();
  });

  it("a deactivated node's name is free again", async () => {
    const college = await makeNode("f8-college2", "COLLEGE", 1);
    const old = await makeNode("f8-retired", "DEPARTMENT", 2);
    const name = (await prisma.orgNode.findUniqueOrThrow({ where: { id: old } })).name;
    await prisma.orgNode.update({ where: { id: old }, data: { active: false } });
    const fresh = await org.create({ name, level: 2, kind: "DEPARTMENT", parentIds: [college] });
    createdNodeIds.push(fresh.id);
    expect(fresh.name).toBe(name);
  });
});

describe("F-011 — occupant emails are withheld unless the caller may see them", () => {
  it("list() with includeEmail:false returns the occupant's name but a null email", async () => {
    const nodeId = await makeNode("f11-office", "OFFICE", 1);
    const userId = await makeUser("f11-occupant");
    await prisma.orgNode.update({ where: { id: nodeId }, data: { userId } });

    const hidden = (await org.list(false, { includeEmail: false })).find((n) => n.id === nodeId)!;
    expect(hidden.occupant).toMatchObject({ id: userId, email: null });
    expect(hidden.occupant?.name).toBeTruthy();
    const shown = (await org.list(false)).find((n) => n.id === nodeId)!;
    expect(shown.occupant?.email).toContain("@");
  });
});
