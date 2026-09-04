import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * DB-backed, mirroring mutate.spec.ts's own approach and its rationale (real
 * authorization, real cross-department scope, and a real transaction are not provable
 * as pure logic — custom-props.spec.ts/filters.spec.ts/edit-impact.spec.ts already
 * cover everything that IS pure). See mutate.spec.ts's header for the `.env`-loading
 * detail; identical here.
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
type ItemsModule = typeof import("./items");
type PrismaModule = typeof import("../prisma");

let applyChange: MutateModule["applyChange"];
let filterFields: ItemsModule["filterFields"];
let getOne: ItemsModule["getOne"];
let prisma: PrismaModule["prisma"];

let sysAdminId: string;
let seCustodianId: string;
let seHeadId: string; // MANAGER, NOT the custodian of the test item — the authorization negative case
let chemCustodianId: string;

let groupId: string;
let categoryId: string;
let seItemId: string;
let chemItemId: string;

beforeAll(async () => {
  ({ applyChange } = await import("./mutate"));
  ({ filterFields, getOne } = await import("./items"));
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

  const group = await prisma.categoryGroup.create({ data: { name: `__test-custom-props-${Date.now()}`, sortOrder: 999 } });
  groupId = group.id;
  const category = await prisma.resourceCategory.create({
    data: {
      key: `__test-custom-props-${Date.now()}`,
      name: "Custom Props Test Category",
      iconKey: "Package",
      groupId,
      countingMode: "SERIALIZED",
      fields: { create: [{ key: "brand", label: "Brand", type: "TEXT", sortOrder: 0 }] },
    },
  });
  categoryId = category.id;

  const [seItem, chemItem] = await Promise.all([
    prisma.item.create({
      data: { categoryId, name: "SE Custom Props Item", countingMode: "SERIALIZED", status: "WORKING", ownerOrgNodeId: seNode.id, currentOrgNodeId: seNode.id, custodianId: seCustodianId },
    }),
    prisma.item.create({
      data: { categoryId, name: "ChemE Custom Props Item", countingMode: "SERIALIZED", status: "WORKING", ownerOrgNodeId: chemNode.id, currentOrgNodeId: chemNode.id, custodianId: chemCustodianId },
    }),
  ]);
  seItemId = seItem.id;
  chemItemId = chemItem.id;
});

afterAll(async () => {
  await prisma.itemChange.deleteMany({ where: { itemId: { in: [seItemId, chemItemId] } } });
  await prisma.item.deleteMany({ where: { id: { in: [seItemId, chemItemId] } } });
  await prisma.resourceCategory.delete({ where: { id: categoryId } });
  await prisma.categoryGroup.delete({ where: { id: groupId } });
  await prisma.$disconnect();
});

describe("custom properties — creation, persistence, and typing", () => {
  it("creates a custom property, persists its exact type and value across a reload, and logs an audit line naming the key", async () => {
    const before = await prisma.item.findUniqueOrThrow({ where: { id: seItemId } });
    const result = await applyChange(seCustodianId, {
      kind: "addCustomProperty",
      itemIds: [seItemId],
      key: "Asset Tag",
      type: "NUMBER",
      value: 42,
      expectedVersions: { [seItemId]: before.version },
    });
    expect(result).toEqual({ applied: 1, itemIds: [seItemId] });

    const detail = await getOne(seCustodianId, seItemId);
    expect(detail.customProps["Asset Tag"]).toEqual({ type: "NUMBER", value: 42 });

    const audit = await prisma.itemChange.findFirst({ where: { itemId: seItemId, kind: "addCustomProperty", field: "Asset Tag" } });
    expect(audit).toMatchObject({ before: null, after: 42 });
  });

  it("edits an existing custom property's value, keeping its declared type, and logs before/after", async () => {
    const before = await getOne(seCustodianId, seItemId);
    const v = before.version;
    await applyChange(seCustodianId, {
      kind: "setCustomProperty",
      itemIds: [seItemId],
      key: "Asset Tag",
      value: 99,
      expectedVersions: { [seItemId]: v },
    });

    const after = await getOne(seCustodianId, seItemId);
    expect(after.customProps["Asset Tag"]).toEqual({ type: "NUMBER", value: 99 });

    const audit = await prisma.itemChange.findFirst({ where: { itemId: seItemId, kind: "setCustomProperty", field: "Asset Tag" }, orderBy: { at: "desc" } });
    expect(audit).toMatchObject({ before: 42, after: 99 });
  });

  it("removes a custom property entirely, and logs its final value as `before`", async () => {
    const before = await getOne(seCustodianId, seItemId);
    await applyChange(seCustodianId, { kind: "removeCustomProperty", itemIds: [seItemId], key: "Asset Tag", expectedVersions: { [seItemId]: before.version } });

    const after = await getOne(seCustodianId, seItemId);
    expect(after.customProps["Asset Tag"]).toBeUndefined();

    const audit = await prisma.itemChange.findFirst({ where: { itemId: seItemId, kind: "removeCustomProperty", field: "Asset Tag" } });
    expect(audit).toMatchObject({ before: 99, after: null });
  });
});

describe("custom properties — collisions and validation", () => {
  it("refuses a duplicate custom-property key on the same item", async () => {
    const before = await getOne(seCustodianId, seItemId);
    await applyChange(seCustodianId, {
      kind: "addCustomProperty",
      itemIds: [seItemId],
      key: "Dup Key",
      type: "TEXT",
      value: "x",
      expectedVersions: { [seItemId]: before.version },
    });
    const after1 = await getOne(seCustodianId, seItemId);

    await expect(
      applyChange(seCustodianId, { kind: "addCustomProperty", itemIds: [seItemId], key: "dup key", type: "TEXT", value: "y", expectedVersions: { [seItemId]: after1.version } }),
    ).rejects.toMatchObject({ status: 400 });

    const after2 = await getOne(seCustodianId, seItemId);
    expect(after2.version).toBe(after1.version); // refused, nothing written

    await applyChange(seCustodianId, { kind: "removeCustomProperty", itemIds: [seItemId], key: "Dup Key", expectedVersions: { [seItemId]: after1.version } });
  });

  it("refuses a custom-property key that collides with the category's own field", async () => {
    const before = await getOne(seCustodianId, seItemId);
    await expect(
      applyChange(seCustodianId, { kind: "addCustomProperty", itemIds: [seItemId], key: "Brand", type: "TEXT", value: "x", expectedVersions: { [seItemId]: before.version } }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("refuses an unsafe key and a value of the wrong type", async () => {
    const before = await getOne(seCustodianId, seItemId);
    await expect(
      applyChange(seCustodianId, { kind: "addCustomProperty", itemIds: [seItemId], key: "bad:key", type: "TEXT", value: "x", expectedVersions: { [seItemId]: before.version } }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      applyChange(seCustodianId, { kind: "addCustomProperty", itemIds: [seItemId], key: "Weight", type: "NUMBER", value: "heavy", expectedVersions: { [seItemId]: before.version } }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("custom properties — version conflicts, authorization, and scope", () => {
  it("refuses a stale addCustomProperty write and applies nothing", async () => {
    const before = await getOne(seCustodianId, seItemId);
    await expect(
      applyChange(seCustodianId, {
        kind: "addCustomProperty",
        itemIds: [seItemId],
        key: "Stale Test",
        type: "TEXT",
        value: "x",
        expectedVersions: { [seItemId]: before.version + 1 },
      }),
    ).rejects.toMatchObject({ status: 409, body: { code: "VERSION_CONFLICT" } });

    const after = await getOne(seCustodianId, seItemId);
    expect(after.version).toBe(before.version);
    expect(after.customProps["Stale Test"]).toBeUndefined();
  });

  it("lets the item's own custodian add and edit a custom property directly, with no approval chain", async () => {
    const before = await getOne(seCustodianId, seItemId);
    const result = await applyChange(seCustodianId, {
      kind: "addCustomProperty",
      itemIds: [seItemId],
      key: "Custody Test",
      type: "BOOLEAN",
      value: true,
      expectedVersions: { [seItemId]: before.version },
    });
    expect(result.applied).toBe(1);
  });

  it("refuses a MANAGER who is not the item's custodian, the same 404 an out-of-scope write already uses", async () => {
    const before = await getOne(sysAdminId, seItemId);
    await expect(
      applyChange(seHeadId, {
        kind: "addCustomProperty",
        itemIds: [seItemId],
        key: "Should Not Apply",
        type: "TEXT",
        value: "x",
        expectedVersions: { [seItemId]: before.version },
      }),
    ).rejects.toMatchObject({ status: 404 });

    const after = await getOne(sysAdminId, seItemId);
    expect(after.version).toBe(before.version);
    expect(after.customProps["Should Not Apply"]).toBeUndefined();
  });

  it("SYS_ADMIN can add a custom property on an item outside their own org", async () => {
    const before = await getOne(sysAdminId, chemItemId);
    const result = await applyChange(sysAdminId, {
      kind: "addCustomProperty",
      itemIds: [chemItemId],
      key: "Admin Test",
      type: "TEXT",
      value: "ok",
      expectedVersions: { [chemItemId]: before.version },
    });
    expect(result.applied).toBe(1);
  });

  it("keeps custom-property key discovery scoped per department — an SE custodian's filter fields never name a ChemE item's custom key, and vice versa", async () => {
    const seFields = await filterFields(seCustodianId, []);
    const chemFields = await filterFields(chemCustodianId, []);

    const seIds = seFields.map((f) => f.id);
    const chemIds = chemFields.map((f) => f.id);

    expect(seIds).toContain("custom:Custody Test");
    expect(seIds).not.toContain("custom:Admin Test");
    expect(chemIds).toContain("custom:Admin Test");
    expect(chemIds).not.toContain("custom:Custody Test");
  });
});
