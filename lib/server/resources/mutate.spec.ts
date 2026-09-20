import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The one DB-backed spec in the suite — deliberately so. Every other `*.spec.ts` in
 * this project tests pure logic only (see vitest.config.ts's own header); the bug this
 * file guards against is not pure logic, it is a race between reading a row's version
 * and writing it, which cannot be proven without a real transaction against a real
 * database seeing real concurrent writers. This project always has a live dev Postgres
 * available locally (the same one `npm run dev`/`seed:resources` already require), so
 * that dependency costs nothing here.
 *
 * `.env` is not loaded by Vitest/Vite automatically the way `next dev` loads it (see
 * PROGRESS.md's Phase 7 note on this being checked directly) — read it by hand before
 * anything imports `../prisma`, whose module-level `new PrismaClient()` reads
 * `process.env.DATABASE_URL` once, at import time. Static imports are hoisted above
 * this module's own top-level code in ES module order, so `mutate.ts`/`../prisma` are
 * imported dynamically inside `beforeAll`, after `loadDotEnv()` has already run.
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

type MutateModule = typeof import("./mutate");
type PrismaModule = typeof import("../prisma");

let applyChange: MutateModule["applyChange"];
let prisma: PrismaModule["prisma"];

let sysAdminId: string;
let orgNodeId: string;
let groupId: string;
let categoryId: string;
let itemAId: string;
let itemBId: string;
let itemCId: string;

beforeAll(async () => {
  ({ applyChange } = await import("./mutate"));
  ({ prisma } = await import("../prisma"));

  const sysAdmin = await prisma.user.findFirstOrThrow({ where: { roles: { some: { kind: "SYS_ADMIN" } } } });
  const orgNode = await prisma.orgNode.findFirstOrThrow({ where: { active: true } });
  sysAdminId = sysAdmin.id;
  orgNodeId = orgNode.id;

  const group = await prisma.categoryGroup.create({ data: { name: `__test-version-conflict-${Date.now()}`, sortOrder: 999 } });
  groupId = group.id;
  const category = await prisma.resourceCategory.create({
    data: { key: `__test-version-conflict-${Date.now()}`, name: "Version Conflict Test Category", iconKey: "box", groupId, countingMode: "SERIALIZED" },
  });
  categoryId = category.id;

  const makeItem = (name: string) =>
    prisma.item.create({
      data: { categoryId, name, countingMode: "SERIALIZED", status: "WORKING", ownerOrgNodeId: orgNodeId, currentOrgNodeId: orgNodeId, custodianId: sysAdminId },
    });
  const [itemA, itemB, itemC] = await Promise.all([makeItem("Version Conflict Item A"), makeItem("Version Conflict Item B"), makeItem("Version Conflict Item C")]);
  itemAId = itemA.id;
  itemBId = itemB.id;
  itemCId = itemC.id;
});

afterAll(async () => {
  await prisma.itemChange.deleteMany({ where: { itemId: { in: [itemAId, itemBId, itemCId] } } });
  await prisma.item.deleteMany({ where: { id: { in: [itemAId, itemBId, itemCId] } } });
  await prisma.resourceCategory.delete({ where: { id: categoryId } });
  await prisma.categoryGroup.delete({ where: { id: groupId } });
  await prisma.$disconnect();
});

describe("applyChange — item version-conflict atomicity", () => {
  it("refuses the whole bulk edit when any one item's version is stale, and writes nothing — not even to the items whose version matched", async () => {
    const beforeA = await prisma.item.findUniqueOrThrow({ where: { id: itemAId } });
    const beforeB = await prisma.item.findUniqueOrThrow({ where: { id: itemBId } });
    const changesBefore = await prisma.itemChange.count({ where: { itemId: { in: [itemAId, itemBId] } } });

    await expect(
      applyChange(sysAdminId, {
        kind: "setStatus",
        itemIds: [itemAId, itemBId],
        value: "BROKEN",
        // A's version is correct; B's is deliberately stale.
        expectedVersions: { [itemAId]: beforeA.version, [itemBId]: beforeB.version + 1 },
      }),
    ).rejects.toMatchObject({ status: 409, body: { code: "VERSION_CONFLICT" } });

    const afterA = await prisma.item.findUniqueOrThrow({ where: { id: itemAId } });
    const afterB = await prisma.item.findUniqueOrThrow({ where: { id: itemBId } });
    // Neither item changed — including A, whose version DID match. A whole-refusal
    // that still wrote A's status would be a partial apply wearing a 409 disguise.
    expect(afterA.version).toBe(beforeA.version);
    expect(afterA.status).toBe(beforeA.status);
    expect(afterB.version).toBe(beforeB.version);
    expect(afterB.status).toBe(beforeB.status);

    const changesAfter = await prisma.itemChange.count({ where: { itemId: { in: [itemAId, itemBId] } } });
    expect(changesAfter).toBe(changesBefore);
  });

  it("applies cleanly when every version matches", async () => {
    const before = await prisma.item.findUniqueOrThrow({ where: { id: itemAId } });
    const result = await applyChange(sysAdminId, {
      kind: "setStatus",
      itemIds: [itemAId],
      value: "BROKEN",
      expectedVersions: { [itemAId]: before.version },
    });
    expect(result).toEqual({ applied: 1, itemIds: [itemAId] });

    const after = await prisma.item.findUniqueOrThrow({ where: { id: itemAId } });
    expect(after.version).toBe(before.version + 1);
    expect(after.status).toBe("BROKEN");
  });

  it("under two real concurrent writers racing the same expected version, exactly one succeeds and the other gets a version conflict — proving the check and the write are atomic, not just sequential", async () => {
    const before = await prisma.item.findUniqueOrThrow({ where: { id: itemCId } });

    const [r1, r2] = await Promise.allSettled([
      applyChange(sysAdminId, { kind: "setName", itemIds: [itemCId], value: "Version Conflict Item C — writer 1", expectedVersions: { [itemCId]: before.version } }),
      applyChange(sysAdminId, { kind: "setName", itemIds: [itemCId], value: "Version Conflict Item C — writer 2", expectedVersions: { [itemCId]: before.version } }),
    ]);

    const fulfilled = [r1, r2].filter((r) => r.status === "fulfilled");
    const rejected = [r1, r2].filter((r): r is PromiseRejectedResult => r.status === "rejected");
    // The pre-fix version of this check (a plain findMany BEFORE the transaction
    // opened) let both writers pass — both would read the same stale-but-then-current
    // version, both would proceed to write. This is the test that would have caught
    // that: with the check-and-write atomic, only the writer who actually holds the
    // row's lock when it checks can still find its expected version current.
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ status: 409, body: { code: "VERSION_CONFLICT" } });

    const after = await prisma.item.findUniqueOrThrow({ where: { id: itemCId } });
    // Exactly one increment — not zero (both refused) and not two (both applied).
    expect(after.version).toBe(before.version + 1);
    expect(["Version Conflict Item C — writer 1", "Version Conflict Item C — writer 2"]).toContain(after.name);
  });
});

describe("F-041 — an item named in a pending transfer request cannot be moved out from under it", () => {
  it("refuses moveInTree while a PENDING ChangeRequest names the item", async () => {
    const item = await prisma.item.create({
      data: { categoryId, name: "F041 Move Blocker Item", countingMode: "SERIALIZED", status: "WORKING", ownerOrgNodeId: orgNodeId, currentOrgNodeId: orgNodeId, custodianId: sysAdminId },
    });
    const destination = await prisma.item.create({
      data: { categoryId, name: "F041 Move Destination", countingMode: "SERIALIZED", status: "WORKING", ownerOrgNodeId: orgNodeId, currentOrgNodeId: orgNodeId, custodianId: sysAdminId },
    });
    const request = await prisma.changeRequest.create({
      data: {
        payload: { kind: "transferItem", itemIds: [item.id], transfer: { targetParentId: "some-other-item", targetOrgNodeId: orgNodeId, targetCustodianId: null } },
        requesterId: sysAdminId,
        status: "PENDING",
        baseVersions: { [item.id]: item.version },
        summary: "F-041 test pending transfer",
      },
    });

    await expect(applyChange(sysAdminId, { kind: "moveInTree", itemIds: [item.id], value: destination.id })).rejects.toMatchObject({ status: 409 });

    const unchanged = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    expect(unchanged.parentId).toBeNull(); // never moved

    await prisma.changeRequest.delete({ where: { id: request.id } });
    await prisma.item.deleteMany({ where: { id: { in: [item.id, destination.id] } } });
  });
});
