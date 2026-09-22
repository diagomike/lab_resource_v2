import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * DB-backed for the same reason placement.mutate.spec.ts is (its own header, and
 * mutate.spec.ts's before it) — proving `createItem`'s `name`/`props`/`customProps`
 * fields are actually applied and validated on the live write path,
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
let previewChange: MutateModule["previewChange"];
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
  ({ applyChange, previewChange } = await import("./mutate"));
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
      name: "Given-Name Test Laboratory — Bx-Ry",
      ownerOrgNodeId: seNodeId,
      custodianId: seCustodianId,
    });
    createdItemIds.push(...result.itemIds);
    const item = await prisma.item.findUniqueOrThrow({ where: { id: result.itemIds[0] } });
    expect(item.name).toBe("Given-Name Test Laboratory — Bx-Ry");
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

  it("applies typed custom properties to every root in a multi-create batch", async () => {
    const result = await applyChange(sysAdminId, {
      kind: "createItem",
      parentId: null,
      categoryId: labLikeCategoryId,
      count: 2,
      name: "Custom Batch",
      customProps: {
        "Local code": { type: "TEXT", value: "SE-42" },
        Calibrated: { type: "BOOLEAN", value: true },
        "Warranty months": { type: "NUMBER", value: 18 },
      },
      ownerOrgNodeId: seNodeId,
      custodianId: seCustodianId,
    });
    createdItemIds.push(...result.itemIds);
    const items = await prisma.item.findMany({ where: { id: { in: result.itemIds } } });
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item.customProps).toEqual({
        "Local code": { type: "TEXT", value: "SE-42" },
        Calibrated: { type: "BOOLEAN", value: true },
        "Warranty months": { type: "NUMBER", value: 18 },
      });
    }
  });

  it("rejects custom keys that collide with category fields or one another", async () => {
    await expect(
      applyChange(sysAdminId, {
        kind: "createItem",
        parentId: null,
        categoryId: labLikeCategoryId,
        count: 1,
        customProps: { Room: { type: "TEXT", value: "duplicate" } },
        ownerOrgNodeId: seNodeId,
        custodianId: seCustodianId,
      }),
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      applyChange(sysAdminId, {
        kind: "createItem",
        parentId: null,
        categoryId: labLikeCategoryId,
        count: 1,
        customProps: {
          "Local code": { type: "TEXT", value: "one" },
          local_code: { type: "TEXT", value: "two" },
        },
        ownerOrgNodeId: seNodeId,
        custodianId: seCustodianId,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects a custom property whose stored value does not match its declared type", async () => {
    await expect(
      applyChange(sysAdminId, {
        kind: "createItem",
        parentId: null,
        categoryId: labLikeCategoryId,
        count: 1,
        customProps: { Voltage: { type: "NUMBER", value: "220" } },
        ownerOrgNodeId: seNodeId,
        custodianId: seCustodianId,
      }),
    ).rejects.toMatchObject({ status: 400 });
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

  it("refuses a MANAGER creating a root even in their own department — heads approve, custodians edit (2026-09-22)", async () => {
    await expect(
      applyChange(seHeadId, {
        kind: "createItem",
        parentId: null,
        categoryId: labLikeCategoryId,
        count: 1,
        name: "Head-Created Lab",
        ownerOrgNodeId: seNodeId,
        custodianId: seCustodianId,
      }),
    ).rejects.toMatchObject({ status: 403 });
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

  it("refuses a MANAGER creating beneath a parent in their own department they do not custody (2026-09-22)", async () => {
    // seParentItemId is custodied by seCustodianId, NOT seHeadId — the
    // create-BENEATH-a-parent path (assertAuthorized → scope.assertCanMutate on the
    // parent), distinct from the root-creation path above.
    await expect(
      applyChange(seHeadId, {
        kind: "createItem",
        parentId: seParentItemId,
        categoryId: partCategoryId,
        count: 1,
        name: "Head-Added Part",
      }),
    ).rejects.toMatchObject({ status: 404 });
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

describe("sibling names — continued numbering, gap filling, uniqueness (2026-09-22)", () => {
  const namesUnder = async () =>
    (await prisma.item.findMany({ where: { parentId: seParentItemId, deletedAt: null, categoryId: partCategoryId }, select: { name: true } })).map((i) => i.name).sort();
  const add = async (count: number, dryRun = false) => {
    const input = { kind: "createItem" as const, parentId: seParentItemId, categoryId: partCategoryId, count, name: "Seat" };
    const result = dryRun ? await previewChange(sysAdminId, input) : await applyChange(sysAdminId, input);
    if (!dryRun) createdItemIds.push(...result.itemIds);
    return result;
  };

  it("a second batch continues the numbering, and a deleted number is filled first", async () => {
    await add(3);
    await add(2);
    expect(await namesUnder()).toEqual(["Seat 01", "Seat 02", "Seat 03", "Seat 04", "Seat 05"]);

    const seat02 = await prisma.item.findFirstOrThrow({ where: { parentId: seParentItemId, name: "Seat 02", deletedAt: null } });
    await applyChange(sysAdminId, { kind: "deleteItem", itemIds: [seat02.id] });
    const preview = await add(2, true);
    expect(preview.plannedNames).toEqual(["Seat 02", "Seat 06"]);
    expect(await namesUnder()).not.toContain("Seat 06"); // a dry run creates nothing
    await add(2);
    expect(await namesUnder()).toEqual(["Seat 01", "Seat 02", "Seat 03", "Seat 04", "Seat 05", "Seat 06"]);
  });

  it("refuses renaming onto a sibling's name, whatever the case or spacing", async () => {
    const seat03 = await prisma.item.findFirstOrThrow({ where: { parentId: seParentItemId, name: "Seat 03", deletedAt: null } });
    await expect(applyChange(sysAdminId, { kind: "setName", itemIds: [seat03.id], value: "Seat 04" })).rejects.toMatchObject({ status: 409 });
    await expect(applyChange(sysAdminId, { kind: "setName", itemIds: [seat03.id], value: " seat   04 " })).rejects.toMatchObject({ status: 409 });
  });

  it("numbers several siblings renamed to one name instead of duplicating it", async () => {
    const two = await prisma.item.findMany({ where: { parentId: seParentItemId, name: { in: ["Seat 05", "Seat 06"] }, deletedAt: null } });
    await applyChange(sysAdminId, { kind: "setName", itemIds: two.map((i) => i.id), value: "Spare" });
    const names = await namesUnder();
    expect(names).toContain("Spare 01");
    expect(names).toContain("Spare 02");
  });

  it("refuses an explicitly numbered name that already exists", async () => {
    await expect(
      applyChange(sysAdminId, { kind: "createItem", parentId: seParentItemId, categoryId: partCategoryId, count: 1, name: "Seat 01" }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
