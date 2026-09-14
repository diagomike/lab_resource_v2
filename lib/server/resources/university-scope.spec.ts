import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** DB-backed — role gating and cross-department raw-body assertions are not provable
 *  as pure logic. See mutate.spec.ts's header for the `.env`-loading detail;
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

type ItemsModule = typeof import("./items");
type ScopeModule = typeof import("./scope");
type CategoriesModule = typeof import("./categories");
type PrismaModule = typeof import("../prisma");

let items: ItemsModule;
let scope: ScopeModule;
let categories: CategoriesModule;
let prisma: PrismaModule["prisma"];

let sysAdminId: string;
let seCustodianId: string;
let seHeadId: string; // MANAGER
let chemCustodianId: string;
let storeKeeperId: string;
let staffOnlyId: string;

let groupId: string;
let categoryId: string;
let seItemId: string;
let chemItemId: string;
const testKey = `__test-university-${Date.now()}`;

beforeAll(async () => {
  items = await import("./items");
  scope = await import("./scope");
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

  // No STORE_KEEPER or pure-STAFF account exists in the seed fixture — created here,
  // scoped to this test's own cleanup, rather than widening the shared seed for one
  // spec's negative/positive gate cases.
  const storeKeeper = await prisma.user.create({
    data: {
      email: `${testKey}-store@astu.edu.et`,
      emailLower: `${testKey}-store@astu.edu.et`,
      name: "Test Store Keeper",
      status: "ACTIVE",
      roles: { create: [{ kind: "STORE_KEEPER" }] },
    },
  });
  storeKeeperId = storeKeeper.id;

  const staffOnly = await prisma.user.create({
    data: {
      email: `${testKey}-staff@astu.edu.et`,
      emailLower: `${testKey}-staff@astu.edu.et`,
      name: "Test Staff Only",
      status: "ACTIVE",
      homeNodeId: seNode.id,
      roles: { create: [{ kind: "STAFF" }] },
    },
  });
  staffOnlyId = staffOnly.id;

  const group = await prisma.categoryGroup.create({ data: { name: testKey, sortOrder: 999 } });
  groupId = group.id;
  const category = await categories.create(sysAdminId, {
    key: testKey,
    name: "University Scope Test Category",
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

  const [seItem, chemItem] = await Promise.all([
    prisma.item.create({
      data: { categoryId, name: "SE University-Scope Item", countingMode: "SERIALIZED", status: "WORKING", ownerOrgNodeId: seNode.id, currentOrgNodeId: seNode.id, custodianId: seCustodianId },
    }),
    prisma.item.create({
      data: { categoryId, name: "ChemE University-Scope Item", countingMode: "SERIALIZED", status: "WORKING", ownerOrgNodeId: chemNode.id, currentOrgNodeId: chemNode.id, custodianId: chemCustodianId },
    }),
  ]);
  seItemId = seItem.id;
  chemItemId = chemItem.id;
});

afterAll(async () => {
  await prisma.itemChange.deleteMany({ where: { OR: [{ itemId: { in: [seItemId, chemItemId] } }, { categoryId }] } });
  await prisma.item.deleteMany({ where: { id: { in: [seItemId, chemItemId] } } });
  await prisma.resourceCategory.delete({ where: { id: categoryId } });
  await prisma.categoryGroup.delete({ where: { id: groupId } });
  await prisma.userRole.deleteMany({ where: { userId: { in: [storeKeeperId, staffOnlyId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [storeKeeperId, staffOnlyId] } } });
  await prisma.$disconnect();
});

describe("assertCanBrowseUniversity — the gate itself", () => {
  it("allows SYS_ADMIN, MANAGER, STORE_KEEPER and — since pull transfers (Track 5) — CUSTODIAN", async () => {
    await expect(scope.assertCanBrowseUniversity(sysAdminId)).resolves.toBeUndefined();
    await expect(scope.assertCanBrowseUniversity(seHeadId)).resolves.toBeUndefined();
    await expect(scope.assertCanBrowseUniversity(storeKeeperId)).resolves.toBeUndefined();
    await expect(scope.assertCanBrowseUniversity(seCustodianId)).resolves.toBeUndefined();
  });

  it("refuses a plain STAFF account, with 403", async () => {
    await expect(scope.assertCanBrowseUniversity(staffOnlyId)).rejects.toMatchObject({ status: 403 });
  });
});

describe("university scope override — raw response body, cross-department", () => {
  it("a MANAGER's ordinary search (ORG_SUBTREE) never includes another department's item", async () => {
    const result = await items.search(seHeadId, { q: "University-Scope Item" });
    const names = result.items.map((i) => i.name);
    expect(names).toContain("SE University-Scope Item");
    expect(names).not.toContain("ChemE University-Scope Item");
  });

  it("the SAME MANAGER, with the UNIVERSITY override, sees the other department's item too", async () => {
    const result = await items.search(seHeadId, { q: "University-Scope Item" }, 1, 50, { mode: "UNIVERSITY" });
    const names = result.items.map((i) => i.name);
    expect(names).toContain("SE University-Scope Item");
    expect(names).toContain("ChemE University-Scope Item");
  });

  it("getOne with the UNIVERSITY override resolves an out-of-department item that would otherwise 404", async () => {
    await expect(scope.assertCanSeeItem(seHeadId, chemItemId)).rejects.toMatchObject({ status: 404 });
    const detail = await items.getOne(seHeadId, chemItemId, { mode: "UNIVERSITY" });
    expect(detail.name).toBe("ChemE University-Scope Item");
  });

  it("summary's byEffectiveStatus/total widen under the UNIVERSITY override", async () => {
    const ordinary = await items.summary(seHeadId);
    const university = await items.summary(seHeadId, { mode: "UNIVERSITY" });
    expect(university.total).toBeGreaterThanOrEqual(ordinary.total + 1); // at least ChemE's own item joins the count
  });

  it("summary applies the same filters as the matching-items search", async () => {
    const filtered = await items.summary(seHeadId, undefined, { q: "SE University-Scope Item" });
    const search = await items.search(seHeadId, { q: "SE University-Scope Item" });
    expect(filtered.total).toBe(search.total);
    expect(filtered.total).toBe(1);
    expect(Object.values(filtered.byEffectiveStatus).reduce((sum, count) => sum + count, 0)).toBe(filtered.total);
    expect(filtered.breakdowns.category).toContainEqual(
      expect.objectContaining({ key: categoryId, label: "University Scope Test Category", total: 1 }),
    );
    for (const rows of Object.values(filtered.breakdowns)) {
      expect(rows.reduce((sum, row) => sum + row.total, 0)).toBe(filtered.total);
    }
  });

  it("seeing further grants nothing: the write door stays custody-based even under the UNIVERSITY override", async () => {
    // assertCanMutate takes no mode override at all — it is a fixed, narrower policy
    // (see scope.ts's own header on why read scope and write eligibility are separate
    // questions). A MANAGER who can now SEE the other department's item still cannot
    // write to it.
    await expect(scope.assertCanMutate(seHeadId, [chemItemId])).rejects.toMatchObject({ status: 404 });
  });
});
