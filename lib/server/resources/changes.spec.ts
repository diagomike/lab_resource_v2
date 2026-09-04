import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** DB-backed — scope resolution, deleted-item history, and batch-contiguity are not
 *  provable as pure logic. See mutate.spec.ts's header for the `.env`-loading detail;
 *  identical here. */
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

type ChangesModule = typeof import("./changes");
type MutateModule = typeof import("./mutate");
type CategoriesModule = typeof import("./categories");
type PrismaModule = typeof import("../prisma");

let changes: ChangesModule;
let applyChange: MutateModule["applyChange"];
let categories: CategoriesModule;
let prisma: PrismaModule["prisma"];

let sysAdminId: string;
let seCustodianId: string;
let seHeadId: string;
let chemCustodianId: string;

let groupId: string;
let categoryId: string;
let seItemId: string;
let seItem2Id: string;
let chemItemId: string;
const testKey = `__test-changelog-${Date.now()}`;

beforeAll(async () => {
  changes = await import("./changes");
  ({ applyChange } = await import("./mutate"));
  categories = await import("./categories");
  ({ prisma } = await import("../prisma"));

  const [sysAdmin, seCustodian, seHead, chemCustodian, seNode, chemNode] = await Promise.all([
    prisma.user.findFirstOrThrow({ where: { roles: { some: { kind: "SYS_ADMIN" } } } }),
    prisma.user.findFirstOrThrow({ where: { email: "custodian.se@astu.edu.et" } }),
    prisma.user.findFirstOrThrow({ where: { email: "head.se@astu.edu.et" } }),
    prisma.user.findFirstOrThrow({ where: { email: "custodian.chem@astu.edu.et" } }),
    prisma.orgNode.findFirstOrThrow({ where: { name: { contains: "Software Engineering" } } }),
    prisma.orgNode.findFirstOrThrow({ where: { name: { contains: "Chemical" } } }),
  ]);
  sysAdminId = sysAdmin.id;
  seCustodianId = seCustodian.id;
  seHeadId = seHead.id;
  chemCustodianId = chemCustodian.id;

  const group = await prisma.categoryGroup.create({ data: { name: testKey, sortOrder: 999 } });
  groupId = group.id;
  const category = await categories.create(sysAdminId, {
    key: testKey,
    name: "Change Log Test Category",
    iconKey: "Package",
    groupId,
    countingMode: "SERIALIZED",
    impairRule: "ANY_CRITICAL",
    canBeRoot: false,
    placement: "ANYWHERE",
    allowedParentCategoryIds: [],
    fields: [],
    templateChildren: [],
  });
  categoryId = category.id;

  const [seItem, seItem2, chemItem] = await Promise.all([
    prisma.item.create({
      data: { categoryId, name: "SE Changelog Item Alpha", countingMode: "SERIALIZED", status: "WORKING", ownerOrgNodeId: seNode.id, currentOrgNodeId: seNode.id, custodianId: seCustodianId },
    }),
    prisma.item.create({
      data: { categoryId, name: "SE Changelog Item Beta", countingMode: "SERIALIZED", status: "WORKING", ownerOrgNodeId: seNode.id, currentOrgNodeId: seNode.id, custodianId: seCustodianId },
    }),
    prisma.item.create({
      data: { categoryId, name: "ChemE Changelog Item", countingMode: "SERIALIZED", status: "WORKING", ownerOrgNodeId: chemNode.id, currentOrgNodeId: chemNode.id, custodianId: chemCustodianId },
    }),
  ]);
  seItemId = seItem.id;
  seItem2Id = seItem2.id;
  chemItemId = chemItem.id;

  // A single-item correction on each side (real snapshot per department).
  await applyChange(seCustodianId, { kind: "setName", itemIds: [seItemId], value: "SE Changelog Item Alpha (renamed)", expectedVersions: { [seItemId]: seItem.version } });
  await applyChange(chemCustodianId, { kind: "setName", itemIds: [chemItemId], value: "ChemE Changelog Item (renamed)", expectedVersions: { [chemItemId]: chemItem.version } });

  // A genuine bulk edit across two SE items — same batchId, same `at`.
  await applyChange(seCustodianId, { kind: "setStatus", itemIds: [seItemId, seItem2Id], value: "BROKEN" });
});

afterAll(async () => {
  await prisma.itemChange.deleteMany({ where: { OR: [{ itemId: { in: [seItemId, seItem2Id, chemItemId] } }, { categoryId }] } });
  await prisma.item.deleteMany({ where: { id: { in: [seItemId, seItem2Id, chemItemId] } } });
  await prisma.resourceCategory.delete({ where: { id: categoryId } });
  await prisma.categoryGroup.delete({ where: { id: groupId } });
  await prisma.$disconnect();
});

describe("changes.browse — scope, per role", () => {
  // itemName snapshots the item's name AT THE MOMENT of each row's own change — for a
  // setName change specifically that is the PRE-rename name (the row's own `field`/
  // `before`/`after` carry the rename itself), so these fixtures are found by their
  // ORIGINAL name, not the one they were renamed to.
  it("SYS_ADMIN sees rows from every department, plus category-targeted rows", async () => {
    const page = await changes.browse(sysAdminId, { q: "Changelog" });
    const names = page.entries.map((e) => e.itemName);
    expect(names).toContain("SE Changelog Item Alpha");
    expect(names).toContain("ChemE Changelog Item");
  });

  it("a department MANAGER (ORG_SUBTREE) sees their own department's item rows and category rows, never the other department's", async () => {
    const page = await changes.browse(seHeadId, { q: "Changelog" });
    const names = page.entries.map((e) => e.itemName);
    expect(names).toContain("SE Changelog Item Alpha");
    expect(names).not.toContain("ChemE Changelog Item");
  });

  it("a custodian (MY_CUSTODY) sees only rows for items they directly custody, never another department's", async () => {
    const page = await changes.browse(seCustodianId, { q: "Changelog" });
    const names = page.entries.map((e) => e.itemName);
    expect(names).toContain("SE Changelog Item Alpha");
    expect(names).not.toContain("ChemE Changelog Item");

    const chemPage = await changes.browse(chemCustodianId, { q: "Changelog" });
    const chemNames = chemPage.entries.map((e) => e.itemName);
    expect(chemNames).toContain("ChemE Changelog Item");
    expect(chemNames).not.toContain("SE Changelog Item Alpha");
  });

  it("a category-targeted entry (the test category's own creation) is visible to every role, including a custodian with no reach into the category admin surface itself", async () => {
    const [asAdmin, asHead, asSeCustodian, asChemCustodian] = await Promise.all([
      changes.browse(sysAdminId, { categoryId }),
      changes.browse(seHeadId, { categoryId }),
      changes.browse(seCustodianId, { categoryId }),
      changes.browse(chemCustodianId, { categoryId }),
    ]);
    for (const page of [asAdmin, asHead, asSeCustodian, asChemCustodian]) {
      expect(page.entries.some((e) => e.targetKind === "CATEGORY" && e.kind === "editCategory")).toBe(true);
    }
  });

  it("never returns a row with a null scope snapshot to anyone but a university-wide role", async () => {
    // Simulates a legacy row written before the snapshot columns existed, or one
    // whose scope genuinely cannot be determined — inserted directly, bypassing
    // mutate.ts (which always populates the snapshot for a real change).
    const orphan = await prisma.itemChange.create({
      data: { actorId: sysAdminId, kind: "setName", targetKind: "ITEM", itemId: null, itemName: `${testKey}-orphan-snapshot-row`, note: "test fixture" },
    });
    try {
      const asAdmin = await changes.browse(sysAdminId, { q: `${testKey}-orphan-snapshot-row` });
      const asHead = await changes.browse(seHeadId, { q: `${testKey}-orphan-snapshot-row` });
      const asCustodian = await changes.browse(seCustodianId, { q: `${testKey}-orphan-snapshot-row` });
      expect(asAdmin.entries.map((e) => e.id)).toContain(orphan.id);
      expect(asHead.entries.map((e) => e.id)).not.toContain(orphan.id);
      expect(asCustodian.entries.map((e) => e.id)).not.toContain(orphan.id);
    } finally {
      await prisma.itemChange.delete({ where: { id: orphan.id } });
    }
  });
});

describe("changes.browse — a deleted item's history stays authorized for the right people", () => {
  it("keeps a deleted item's earlier entries visible to whoever could see it, marks the row as itemExists: false, and never leaks it to the other department", async () => {
    const before = await prisma.item.findUniqueOrThrow({ where: { id: seItem2Id } });
    await applyChange(seCustodianId, { kind: "deleteItem", itemIds: [seItem2Id], expectedVersions: { [seItem2Id]: before.version } });

    const asHead = await changes.browse(seHeadId, { q: "Changelog Item Beta" });
    expect(asHead.entries.length).toBeGreaterThan(0);
    expect(asHead.entries.every((e) => e.itemId === seItem2Id)).toBe(true);
    const deleteRow = asHead.entries.find((e) => e.kind === "deleteItem");
    expect(deleteRow).toBeDefined();
    expect(deleteRow!.itemExists).toBe(false);
    expect(deleteRow!.itemName).toBe("SE Changelog Item Beta"); // the snapshot, unaffected by the row's own deletion

    const asChem = await changes.browse(chemCustodianId, { q: "Changelog Item Beta" });
    expect(asChem.entries).toHaveLength(0);
  });
});

describe("changes.browse — bulk grouping, search, and pagination", () => {
  it("gives every row of one bulk operation the same batchId and the same timestamp, contiguous under the server's own ordering", async () => {
    const page = await changes.browse(sysAdminId, { kind: "setStatus", q: "Changelog Item Alpha" });
    const bulkRow = page.entries.find((e) => e.kind === "setStatus" && e.itemId === seItemId);
    expect(bulkRow?.batchId).toBeTruthy();

    const fullBatch = await prisma.itemChange.findMany({ where: { batchId: bulkRow!.batchId! } });
    expect(fullBatch).toHaveLength(2);
    expect(new Set(fullBatch.map((r) => r.at.getTime())).size).toBe(1); // identical timestamp
  });

  it("full-text search matches item name, field, and actor name", async () => {
    const byItemName = await changes.browse(sysAdminId, { q: "Changelog Item Alpha" });
    expect(byItemName.total).toBeGreaterThan(0);

    const byActor = await changes.browse(sysAdminId, { q: "Girma Wolde" });
    expect(byActor.entries.some((e) => e.actorName === "Girma Wolde")).toBe(true);
  });

  it("paginates without ever returning more than pageSize, and total reflects the true count", async () => {
    const full = await changes.browse(sysAdminId, { q: "Changelog" });
    expect(full.total).toBeGreaterThanOrEqual(4);

    const page1 = await changes.browse(sysAdminId, { q: "Changelog" }, 1, 2);
    const page2 = await changes.browse(sysAdminId, { q: "Changelog" }, 2, 2);
    expect(page1.entries).toHaveLength(2);
    expect(page1.total).toBe(full.total);
    expect(page2.total).toBe(full.total);
    const page1Ids = new Set(page1.entries.map((e) => e.id));
    expect(page2.entries.every((e) => !page1Ids.has(e.id))).toBe(true); // no overlap
  });
});
