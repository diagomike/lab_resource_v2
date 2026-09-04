import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * DB-backed for the same reason mutate.spec.ts is (its own header explains the
 * `.env`-loading dance) — `canPlace`'s pure logic already has its own spec
 * (lib/domain/placement.spec.ts); what needs a real transaction is proving
 * `assertPlacementAllowed` is actually wired into `applyCreateItem`/`applyMoveInTree`/
 * `applyTransferItem`'s live write path, and that a refusal leaves the row untouched.
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

// canBeRoot:true, ONLY_LISTED with an empty allow-list — "a root and nothing else",
// the same shape the seed gives Lab/Store.
let rootOnlyCategoryId: string;
// canBeRoot:false, ANYWHERE — an ordinary part that may go inside anything.
let openCategoryId: string;
// canBeRoot:false, ONLY_LISTED, allow-listing ONLY openContainerCategoryId below.
let restrictedCategoryId: string;
// canBeRoot:false, ANYWHERE — the one container restrictedCategoryId is allowed into.
let openContainerCategoryId: string;
// canBeRoot:false, ANYWHERE — a second, unlisted container restrictedCategoryId is NOT allowed into.
let otherContainerCategoryId: string;

let openContainerItemId: string;
let otherContainerItemId: string;
let restrictedItemId: string;

beforeAll(async () => {
  ({ applyChange } = await import("./mutate"));
  ({ prisma } = await import("../prisma"));

  const sysAdmin = await prisma.user.findFirstOrThrow({ where: { roles: { some: { kind: "SYS_ADMIN" } } } });
  const orgNode = await prisma.orgNode.findFirstOrThrow({ where: { active: true } });
  sysAdminId = sysAdmin.id;
  orgNodeId = orgNode.id;

  const stamp = Date.now();
  const group = await prisma.categoryGroup.create({ data: { name: `__test-placement-${stamp}`, sortOrder: 999 } });
  groupId = group.id;

  const [rootOnly, open, openContainer, otherContainer] = await Promise.all([
    prisma.resourceCategory.create({
      data: { key: `__test-placement-root-${stamp}`, name: "Placement Root Only", iconKey: "box", groupId, countingMode: "SERIALIZED", canBeRoot: true, placement: "ONLY_LISTED" },
    }),
    prisma.resourceCategory.create({
      data: { key: `__test-placement-open-${stamp}`, name: "Placement Open", iconKey: "box", groupId, countingMode: "SERIALIZED" },
    }),
    prisma.resourceCategory.create({
      data: { key: `__test-placement-container-${stamp}`, name: "Placement Open Container", iconKey: "box", groupId, countingMode: "SERIALIZED" },
    }),
    prisma.resourceCategory.create({
      data: { key: `__test-placement-other-${stamp}`, name: "Placement Other Container", iconKey: "box", groupId, countingMode: "SERIALIZED" },
    }),
  ]);
  rootOnlyCategoryId = rootOnly.id;
  openCategoryId = open.id;
  openContainerCategoryId = openContainer.id;
  otherContainerCategoryId = otherContainer.id;

  const restricted = await prisma.resourceCategory.create({
    data: { key: `__test-placement-restricted-${stamp}`, name: "Placement Restricted", iconKey: "box", groupId, countingMode: "SERIALIZED", placement: "ONLY_LISTED" },
  });
  restrictedCategoryId = restricted.id;
  await prisma.categoryPlacementRule.create({ data: { childCategoryId: restrictedCategoryId, parentCategoryId: openContainerCategoryId } });

  const makeItem = (categoryId: string, name: string) =>
    prisma.item.create({
      data: { categoryId, name, countingMode: "SERIALIZED", status: "WORKING", ownerOrgNodeId: orgNodeId, currentOrgNodeId: orgNodeId, custodianId: sysAdminId },
    });
  const [openContainerItem, otherContainerItem, restrictedItem] = await Promise.all([
    makeItem(openContainerCategoryId, "Placement Open Container Item"),
    makeItem(otherContainerCategoryId, "Placement Other Container Item"),
    makeItem(restrictedCategoryId, "Placement Restricted Item"),
  ]);
  openContainerItemId = openContainerItem.id;
  otherContainerItemId = otherContainerItem.id;
  restrictedItemId = restrictedItem.id;
});

afterAll(async () => {
  const itemIds = [openContainerItemId, otherContainerItemId, restrictedItemId];
  await prisma.itemChange.deleteMany({ where: { itemId: { in: itemIds } } });
  await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  await prisma.categoryPlacementRule.deleteMany({ where: { childCategoryId: restrictedCategoryId } });
  await prisma.resourceCategory.deleteMany({
    where: { id: { in: [rootOnlyCategoryId, openCategoryId, openContainerCategoryId, otherContainerCategoryId, restrictedCategoryId] } },
  });
  await prisma.categoryGroup.delete({ where: { id: groupId } });
  await prisma.$disconnect();
});

describe("applyChange — placement enforcement", () => {
  it("refuses to create a root-level item of a category that cannot be a root", async () => {
    await expect(
      applyChange(sysAdminId, {
        kind: "createItem",
        categoryId: openCategoryId,
        parentId: null,
        count: 1,
        ownerOrgNodeId: orgNodeId,
        currentOrgNodeId: orgNodeId,
        custodianId: sysAdminId,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("allows creating a root-level item of a category that may be a root", async () => {
    const result = await applyChange(sysAdminId, {
      kind: "createItem",
      categoryId: rootOnlyCategoryId,
      parentId: null,
      count: 1,
      ownerOrgNodeId: orgNodeId,
      currentOrgNodeId: orgNodeId,
      custodianId: sysAdminId,
    });
    expect(result.applied).toBe(1);
    await prisma.item.deleteMany({ where: { id: { in: result.itemIds } } });
  });

  it("refuses to create an item under a container that is not on its category's allow-list", async () => {
    await expect(
      applyChange(sysAdminId, { kind: "createItem", categoryId: restrictedCategoryId, parentId: otherContainerItemId, count: 1 }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("allows creating an item under a container that is on its category's allow-list", async () => {
    const result = await applyChange(sysAdminId, { kind: "createItem", categoryId: restrictedCategoryId, parentId: openContainerItemId, count: 1 });
    expect(result.applied).toBe(1);
    await prisma.item.deleteMany({ where: { id: { in: result.itemIds } } });
  });

  it("refuses to move a restricted item into an unlisted container, leaving it untouched", async () => {
    const before = await prisma.item.findUniqueOrThrow({ where: { id: restrictedItemId } });
    await expect(applyChange(sysAdminId, { kind: "moveInTree", itemIds: [restrictedItemId], value: otherContainerItemId })).rejects.toMatchObject({ status: 400 });
    const after = await prisma.item.findUniqueOrThrow({ where: { id: restrictedItemId } });
    expect(after.parentId).toBe(before.parentId);
    expect(after.version).toBe(before.version);
  });

  it("refuses to move a restricted item to the top level, since its category cannot be a root", async () => {
    await expect(applyChange(sysAdminId, { kind: "moveInTree", itemIds: [restrictedItemId], value: null })).rejects.toMatchObject({ status: 400 });
  });

  it("allows moving a restricted item into a listed container", async () => {
    const result = await applyChange(sysAdminId, { kind: "moveInTree", itemIds: [restrictedItemId], value: openContainerItemId });
    expect(result.applied).toBe(1);
    const after = await prisma.item.findUniqueOrThrow({ where: { id: restrictedItemId } });
    expect(after.parentId).toBe(openContainerItemId);
  });

  it("refuses to transfer a restricted item into an unlisted destination, leaving it untouched", async () => {
    const before = await prisma.item.findUniqueOrThrow({ where: { id: restrictedItemId } });
    await expect(
      applyChange(sysAdminId, {
        kind: "transferItem",
        itemIds: [restrictedItemId],
        transfer: { targetParentId: otherContainerItemId, targetOrgNodeId: orgNodeId, targetCustodianId: null },
      }),
    ).rejects.toMatchObject({ status: 400 });
    const after = await prisma.item.findUniqueOrThrow({ where: { id: restrictedItemId } });
    expect(after.parentId).toBe(before.parentId);
    expect(after.currentOrgNodeId).toBe(before.currentOrgNodeId);
    expect(after.version).toBe(before.version);
  });
});
