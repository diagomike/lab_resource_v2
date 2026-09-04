import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * DB-backed for the same reason placement.mutate.spec.ts is (its own header, and
 * mutate.spec.ts's before it) — proving `createItem`'s `name`/`props` fields (2026-
 * 09-04: "when he creates labs he should name the lab and be able to fill properties
 * in the creation modal") are actually applied and validated on the live write path,
 * and proving the same-day MANAGER write-policy widening (`scope.assertCanMutate`)
 * is wired into `createItem`-beneath-a-parent, not just edits to an existing item.
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
let seCustodianId: string;
let seHeadId: string;
let chemHeadId: string;

let groupId: string;
// canBeRoot:true, ONLY_LISTED empty allow-list — the same "a lab is a root and
// nothing else" shape the real Lab category has, with a room/seats field pair.
let labLikeCategoryId: string;
// canBeRoot:false, ANYWHERE — an ordinary part that may go inside anything, for the
// create-BENEATH-a-parent case (assertCanMutate, not assertCanCreateRoot).
let partCategoryId: string;
let seNodeId: string;
// Owned by SE, custodied by the ordinary SE custodian — NOT by seHeadId — so a create
// underneath it exercises the MANAGER-without-custody widening specifically.
let seParentItemId: string;
let createdItemIds: string[] = [];

beforeAll(async () => {
  ({ applyChange } = await import("./mutate"));
  ({ prisma } = await import("../prisma"));

  const [sysAdmin, seCustodian, seHead, chemHead, seNode] = await Promise.all([
    prisma.user.findFirstOrThrow({ where: { roles: { some: { kind: "SYS_ADMIN" } } } }),
    prisma.user.findFirstOrThrow({ where: { email: "custodian.se@astu.edu.et" } }),
    prisma.user.findFirstOrThrow({ where: { email: "head.se@astu.edu.et" } }),
    prisma.user.findFirstOrThrow({ where: { email: "head.chem@astu.edu.et" } }),
    prisma.orgNode.findFirstOrThrow({ where: { name: { contains: "Software Engineering" } } }),
  ]);
  sysAdminId = sysAdmin.id;
  seCustodianId = seCustodian.id;
  seHeadId = seHead.id;
  chemHeadId = chemHead.id;
  seNodeId = seNode.id;

  const stamp = Date.now();
  const group = await prisma.categoryGroup.create({ data: { name: `__test-create-item-${stamp}`, sortOrder: 999 } });
  groupId = group.id;
  const category = await prisma.resourceCategory.create({
    data: {
      key: `__test-create-item-lab-${stamp}`,
      name: "Create-Item Test Lab",
      iconKey: "Building2",
      groupId,
      countingMode: "SERIALIZED",
      canBeRoot: true,
      placement: "ONLY_LISTED",
      fields: {
        create: [
          { key: "room", label: "Room", type: "TEXT", sortOrder: 0 },
          { key: "seats", label: "Seats", type: "NUMBER", sortOrder: 1 },
          { key: "level", label: "Level", type: "ENUM", options: ["Beginner", "Advanced"], sortOrder: 2 },
        ],
      },
    },
  });
  labLikeCategoryId = category.id;

  const partCategory = await prisma.resourceCategory.create({
    data: { key: `__test-create-item-part-${stamp}`, name: "Create-Item Test Part", iconKey: "Package", groupId, countingMode: "SERIALIZED" },
  });
  partCategoryId = partCategory.id;

  const seParentItem = await prisma.item.create({
    data: {
      categoryId: labLikeCategoryId,
      name: "Create-Item Test SE Parent",
      countingMode: "SERIALIZED",
      status: "WORKING",
      ownerOrgNodeId: seNodeId,
      currentOrgNodeId: seNodeId,
      custodianId: seCustodianId,
    },
  });
  seParentItemId = seParentItem.id;
  createdItemIds.push(seParentItemId);
});

afterAll(async () => {
  await prisma.itemChange.deleteMany({ where: { itemId: { in: createdItemIds } } });
  await prisma.item.deleteMany({ where: { id: { in: createdItemIds } } });
  await prisma.resourceCategory.deleteMany({ where: { id: { in: [labLikeCategoryId, partCategoryId] } } });
  await prisma.categoryGroup.delete({ where: { id: groupId } });
  await prisma.$disconnect();
});

describe("applyCreateItem — name and props at creation", () => {
  it("uses a given name instead of the category's own auto-generated default", async () => {
    const result = await applyChange(sysAdminId, {
      kind: "createItem",
      parentId: null,
      categoryId: labLikeCategoryId,
      count: 1,
      name: "Software Laboratory — B509-R7",
      ownerOrgNodeId: seNodeId,
      custodianId: seCustodianId,
    });
    createdItemIds.push(...result.itemIds);
    const item = await prisma.item.findUniqueOrThrow({ where: { id: result.itemIds[0] } });
    expect(item.name).toBe("Software Laboratory — B509-R7");
  });

  it("applies given props, validated against each field's own type", async () => {
    // Already typed, not a raw form-field string — the client (AddModal's own
    // buildProps()) does that string→number/boolean coercion before this ever goes
    // over the wire, the same discipline setProperty's own callers already follow;
    // validatePropWrite itself only validates, it does not coerce a string.
    const result = await applyChange(sysAdminId, {
      kind: "createItem",
      parentId: null,
      categoryId: labLikeCategoryId,
      count: 1,
      name: "Props Test Lab",
      props: { room: "C-105", seats: 20, level: "Advanced" },
      ownerOrgNodeId: seNodeId,
      custodianId: seCustodianId,
    });
    createdItemIds.push(...result.itemIds);
    const item = await prisma.item.findUniqueOrThrow({ where: { id: result.itemIds[0] } });
    const props = item.props as Record<string, unknown>;
    expect(props.room).toBe("C-105");
    expect(props.seats).toBe(20);
    expect(props.level).toBe("Advanced");
  });

  it("rejects a NUMBER field given a raw string — the server validates the type, it does not coerce it", async () => {
    await expect(
      applyChange(sysAdminId, {
        kind: "createItem",
        parentId: null,
        categoryId: labLikeCategoryId,
        count: 1,
        name: "Uncoerced Lab",
        props: { seats: "20" as unknown as number },
        ownerOrgNodeId: seNodeId,
        custodianId: seCustodianId,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects a prop key the category does not define, the same as setProperty does", async () => {
    await expect(
      applyChange(sysAdminId, {
        kind: "createItem",
        parentId: null,
        categoryId: labLikeCategoryId,
        count: 1,
        name: "Bad Key Lab",
        props: { notAField: "x" },
        ownerOrgNodeId: seNodeId,
        custodianId: seCustodianId,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects an ENUM value outside the field's own options", async () => {
    await expect(
      applyChange(sysAdminId, {
        kind: "createItem",
        parentId: null,
        categoryId: labLikeCategoryId,
        count: 1,
        name: "Bad Enum Lab",
        props: { level: "Not A Real Level" },
        ownerOrgNodeId: seNodeId,
        custodianId: seCustodianId,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("uses the given name as the numbering base when count > 1", async () => {
    const result = await applyChange(sysAdminId, {
      kind: "createItem",
      parentId: null,
      categoryId: labLikeCategoryId,
      count: 2,
      name: "Named Batch",
      ownerOrgNodeId: seNodeId,
      custodianId: seCustodianId,
    });
    createdItemIds.push(...result.itemIds);
    const items = await prisma.item.findMany({ where: { id: { in: result.itemIds } }, orderBy: { name: "asc" } });
    expect(items.map((i) => i.name)).toEqual(["Named Batch 01", "Named Batch 02"]);
  });

  it("lets a MANAGER create a root in their own department without custody of anything (2026-09-04 policy widening)", async () => {
    const result = await applyChange(seHeadId, {
      kind: "createItem",
      parentId: null,
      categoryId: labLikeCategoryId,
      count: 1,
      name: "Head-Created Lab",
      ownerOrgNodeId: seNodeId,
      custodianId: seCustodianId,
    });
    createdItemIds.push(...result.itemIds);
    expect(result.applied).toBe(1);
  });

  it("still refuses a MANAGER from a different department creating a root owned by SE", async () => {
    await expect(
      applyChange(chemHeadId, {
        kind: "createItem",
        parentId: null,
        categoryId: labLikeCategoryId,
        count: 1,
        name: "Should Not Create",
        ownerOrgNodeId: seNodeId,
        custodianId: seCustodianId,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("lets a MANAGER create beneath an existing parent in their own department that they do not personally custody", async () => {
    // seParentItemId is custodied by seCustodianId, NOT seHeadId — this is the
    // create-BENEATH-a-parent path (assertAuthorized → scope.assertCanMutate on the
    // parent), distinct from the root-creation path (assertCanCreateRoot) the two
    // tests above exercise.
    const result = await applyChange(seHeadId, {
      kind: "createItem",
      parentId: seParentItemId,
      categoryId: partCategoryId,
      count: 1,
      name: "Head-Added Part",
    });
    createdItemIds.push(...result.itemIds);
    expect(result.applied).toBe(1);
  });

  it("still refuses a MANAGER from a different department creating beneath that same SE parent", async () => {
    await expect(
      applyChange(chemHeadId, {
        kind: "createItem",
        parentId: seParentItemId,
        categoryId: partCategoryId,
        count: 1,
        name: "Should Not Create",
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
