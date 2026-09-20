import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The category-level twin of mutate.spec.ts — DB-backed for the same reason: the bug
 * this guards against (a version check racing the write it is meant to guard) is not
 * provable as pure logic. See that file's own header for the `.env`-loading rationale;
 * identical here since both import `../prisma`.
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

type CategoriesModule = typeof import("./categories");
type PrismaModule = typeof import("../prisma");

let categories: CategoriesModule;
let prisma: PrismaModule["prisma"];
let sysAdminId: string;
let groupId: string;

beforeAll(async () => {
  categories = await import("./categories");
  ({ prisma } = await import("../prisma"));

  const sysAdmin = await prisma.user.findFirstOrThrow({ where: { roles: { some: { kind: "SYS_ADMIN" } } } });
  sysAdminId = sysAdmin.id;

  const group = await prisma.categoryGroup.create({ data: { name: `__test-categories-${Date.now()}`, sortOrder: 999 } });
  groupId = group.id;
});

afterAll(async () => {
  await prisma.resourceCategory.deleteMany({ where: { groupId } });
  await prisma.categoryGroup.delete({ where: { id: groupId } });
  await prisma.$disconnect();
});

function key(label: string): string {
  return `__test-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("categories — validation", () => {
  it("rejects a duplicate field key on create, before it ever reaches the database", async () => {
    await expect(
      categories.create(sysAdminId, {
        key: key("dup-field"),
        name: "Dup Field Test",
        iconKey: "Package",
        groupId,
        countingMode: "SERIALIZED",
        impairRule: "ANY_CRITICAL",
        canBeRoot: false,
        placement: "ANYWHERE",
        allowedParentCategoryIds: [],
        fields: [
          { key: "x", label: "X", type: "TEXT", options: [], summary: false, longText: false, required: false, sortOrder: 0 },
          { key: "x", label: "X again", type: "TEXT", options: [], summary: false, longText: false, required: false, sortOrder: 1 },
        ],
        templateChildren: [],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects a duplicate template child on create", async () => {
    const part = await categories.create(sysAdminId, {
      key: key("part"),
      name: "Part",
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

    await expect(
      categories.create(sysAdminId, {
        key: key("dup-child"),
        name: "Dup Child Test",
        iconKey: "Package",
        groupId,
        countingMode: "SERIALIZED",
        impairRule: "ANY_CRITICAL",
        canBeRoot: false,
        placement: "ANYWHERE",
        allowedParentCategoryIds: [],
        fields: [],
        templateChildren: [
          { childCategoryId: part.id, qty: 1, critical: false },
          { childCategoryId: part.id, qty: 2, critical: false },
        ],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects a category that would build from itself, direct self-reference via update", async () => {
    const self = await categories.create(sysAdminId, {
      key: key("self"),
      name: "Self Reference Test",
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

    await expect(
      categories.update(sysAdminId, self.id, {
        expectedVersion: self.version,
        templateChildren: [{ childCategoryId: self.id, qty: 1, critical: false }],
        purgeKeys: [],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("categories — deleting a category used as another's default part", () => {
  it("blocks by default, and only proceeds once the collateral change is explicitly confirmed", async () => {
    const part = await categories.create(sysAdminId, {
      key: key("blockable-part"),
      name: "Blockable Part",
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
    const whole = await categories.create(sysAdminId, {
      key: key("whole"),
      name: "Whole",
      iconKey: "Package",
      groupId,
      countingMode: "SERIALIZED",
      impairRule: "ANY_CRITICAL",
      canBeRoot: false,
      placement: "ANYWHERE",
      allowedParentCategoryIds: [],
      fields: [],
      templateChildren: [{ childCategoryId: part.id, qty: 1, critical: false }],
    });

    await expect(categories.remove(sysAdminId, part.id)).rejects.toMatchObject({ status: 409, body: { code: "TEMPLATE_CHILD_IN_USE" } });
    // Still there — the blocked attempt wrote nothing.
    await expect(categories.getOne(part.id)).resolves.toMatchObject({ id: part.id });

    await categories.remove(sysAdminId, part.id, { confirmTemplateRemoval: true });
    await expect(categories.getOne(part.id)).rejects.toMatchObject({ status: 404 });

    const wholeAfter = await categories.getOne(whole.id);
    expect(wholeAfter.templateChildren.find((c) => c.childCategoryId === part.id)).toBeUndefined();

    const audit = await prisma.itemChange.findFirst({ where: { categoryId: whole.id, field: `part ${part.id}` } });
    expect(audit).not.toBeNull();
  });
});

describe("categories — atomic version-conflict handling", () => {
  it("refuses a stale whole-object write and leaves the category completely untouched", async () => {
    const cat = await categories.create(sysAdminId, {
      key: key("stale"),
      name: "Stale Version Test",
      iconKey: "Package",
      groupId,
      countingMode: "SERIALIZED",
      impairRule: "ANY_CRITICAL",
      canBeRoot: false,
      placement: "ANYWHERE",
      allowedParentCategoryIds: [],
      fields: [{ key: "note", label: "Note", type: "TEXT", options: [], summary: false, longText: false, required: false, sortOrder: 0 }],
      templateChildren: [],
    });

    await expect(
      categories.update(sysAdminId, cat.id, {
        expectedVersion: cat.version + 1, // deliberately stale
        name: "Should not apply",
        fields: [],
        purgeKeys: [],
      }),
    ).rejects.toMatchObject({ status: 409, body: { code: "VERSION_CONFLICT" } });

    const after = await categories.getOne(cat.id);
    expect(after.version).toBe(cat.version);
    expect(after.name).toBe("Stale Version Test");
    expect(after.fields).toHaveLength(1);
  });

  it("under two real concurrent writers racing the same expected version, exactly one succeeds and the other gets a version conflict", async () => {
    const cat = await categories.create(sysAdminId, {
      key: key("race"),
      name: "Race Test",
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

    const [r1, r2] = await Promise.allSettled([
      categories.update(sysAdminId, cat.id, { expectedVersion: cat.version, name: "Race Test — writer 1", fields: [], purgeKeys: [] }),
      categories.update(sysAdminId, cat.id, { expectedVersion: cat.version, name: "Race Test — writer 2", fields: [], purgeKeys: [] }),
    ]);

    const fulfilled = [r1, r2].filter((r) => r.status === "fulfilled");
    const rejected = [r1, r2].filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ status: 409, body: { code: "VERSION_CONFLICT" } });

    const after = await categories.getOne(cat.id);
    // Exactly one increment — not zero (both refused) and not two (both silently applied).
    expect(after.version).toBe(cat.version + 1);
    expect(["Race Test — writer 1", "Race Test — writer 2"]).toContain(after.name);
  });
});

describe("F-027 — BULK to SERIALIZED is refused (409), never a raw 500, while real stock exists", () => {
  it("refuses the switch while an item holds a quantity other than 1, and leaves the category untouched", async () => {
    const cat = await categories.create(sysAdminId, {
      key: key("bulk-to-serialized"),
      name: "F027 Ethanol",
      iconKey: "Package",
      groupId,
      countingMode: "BULK",
      unit: "L",
      impairRule: "NEVER",
      canBeRoot: true,
      placement: "ANYWHERE",
      allowedParentCategoryIds: [],
      fields: [],
      templateChildren: [],
    });
    const orgNode = await prisma.orgNode.findFirstOrThrow({ where: { active: true } });
    const item = await prisma.item.create({
      data: { categoryId: cat.id, name: "F027 Ethanol Stock", countingMode: "BULK", qty: 25, status: "WORKING", ownerOrgNodeId: orgNode.id, currentOrgNodeId: orgNode.id, custodianId: sysAdminId },
    });

    await expect(
      categories.update(sysAdminId, cat.id, { expectedVersion: cat.version, countingMode: "SERIALIZED", fields: [], purgeKeys: [] }),
    ).rejects.toMatchObject({ status: 409 });

    const untouched = await categories.getOne(cat.id);
    expect(untouched.countingMode).toBe("BULK");
    expect(untouched.version).toBe(cat.version); // nothing applied, not even a version bump
    const itemAfter = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    expect(itemAfter.countingMode).toBe("BULK");
    expect(Number(itemAfter.qty)).toBe(25);

    await prisma.item.delete({ where: { id: item.id } });
  });
});

describe("F-051 — bookingMode cannot be removed while future reservations exist", () => {
  it("refuses changing bookingMode away from ROOM while a future reservation depends on it", async () => {
    const cat = await categories.create(sysAdminId, {
      key: key("room-bookable"),
      name: "F051 Room Category",
      iconKey: "Package",
      groupId,
      countingMode: "SERIALIZED",
      impairRule: "NEVER",
      canBeRoot: true,
      placement: "ANYWHERE",
      allowedParentCategoryIds: [],
      bookingMode: "ROOM",
      fields: [],
      templateChildren: [],
    });
    const orgNode = await prisma.orgNode.findFirstOrThrow({ where: { active: true } });
    const room = await prisma.item.create({
      data: { categoryId: cat.id, name: "F051 Room", countingMode: "SERIALIZED", status: "WORKING", ownerOrgNodeId: orgNode.id, currentOrgNodeId: orgNode.id, custodianId: sysAdminId },
    });
    const future = new Date(Date.now() + 86_400_000);
    const reservation = await prisma.reservation.create({
      data: {
        source: "STAFF",
        state: "CONFIRMED",
        title: "F051 Future Booking",
        labItemId: room.id,
        startsAt: future,
        endsAt: new Date(future.getTime() + 3_600_000),
        resources: { create: [{ itemId: room.id, startsAt: future, endsAt: new Date(future.getTime() + 3_600_000), blocking: true }] },
      },
    });

    await expect(categories.update(sysAdminId, cat.id, { expectedVersion: cat.version, bookingMode: "NOT_BOOKABLE", fields: [], purgeKeys: [] })).rejects.toMatchObject({
      status: 409,
    });

    await prisma.reservation.delete({ where: { id: reservation.id } });
    const updated = await categories.update(sysAdminId, cat.id, { expectedVersion: cat.version, bookingMode: "NOT_BOOKABLE", fields: [], purgeKeys: [] });
    expect(updated.bookingMode).toBe("NOT_BOOKABLE");
    await prisma.item.delete({ where: { id: room.id } });
  });
});

describe("F-027 — BULK to SERIALIZED, the safe case", () => {
  it("allows the switch once every item already holds qty 1", async () => {
    const cat = await categories.create(sysAdminId, {
      key: key("bulk-to-serialized-ok"),
      name: "F027 Widget",
      iconKey: "Package",
      groupId,
      countingMode: "BULK",
      unit: "Unit",
      impairRule: "NEVER",
      canBeRoot: true,
      placement: "ANYWHERE",
      allowedParentCategoryIds: [],
      fields: [],
      templateChildren: [],
    });
    const orgNode = await prisma.orgNode.findFirstOrThrow({ where: { active: true } });
    const item = await prisma.item.create({
      data: { categoryId: cat.id, name: "F027 Widget Stock", countingMode: "BULK", qty: 1, status: "WORKING", ownerOrgNodeId: orgNode.id, currentOrgNodeId: orgNode.id, custodianId: sysAdminId },
    });

    const updated = await categories.update(sysAdminId, cat.id, { expectedVersion: cat.version, countingMode: "SERIALIZED", fields: [], purgeKeys: [] });
    expect(updated.countingMode).toBe("SERIALIZED");

    await prisma.item.delete({ where: { id: item.id } });
  });
});

describe("F-030 — category name/key/icon hygiene", () => {
  it("the input schema trims names, caps their length and pins the key to a slug", async () => {
    const { CreateCategoryInput } = await import("../../shared/resources/category");
    const ok = { key: "good-key", name: "  Good  ", iconKey: "Box", groupId: "g", countingMode: "SERIALIZED" as const };
    expect(CreateCategoryInput.parse(ok).name).toBe("Good");
    expect(CreateCategoryInput.safeParse({ ...ok, name: "   " }).success).toBe(false);
    expect(CreateCategoryInput.safeParse({ ...ok, name: "N".repeat(2000) }).success).toBe(false);
    expect(CreateCategoryInput.safeParse({ ...ok, key: "has spaces here" }).success).toBe(false);
    expect(CreateCategoryInput.safeParse({ ...ok, key: "Upper" }).success).toBe(false);
  });

  it("refuses an icon that is not in the registry, on create and on update", async () => {
    const base = { name: "F030 Icon", groupId, countingMode: "SERIALIZED" as const, impairRule: "NEVER" as const, canBeRoot: true, placement: "ANYWHERE" as const, allowedParentCategoryIds: [], fields: [], templateChildren: [] };
    await expect(categories.create(sysAdminId, { ...base, key: key("bad-icon"), iconKey: "NoSuchIcon" })).rejects.toMatchObject({ status: 400 });
    const cat = await categories.create(sysAdminId, { ...base, key: key("good-icon"), iconKey: "Box" });
    await expect(categories.update(sysAdminId, cat.id, { expectedVersion: cat.version, iconKey: "NoSuchIcon", purgeKeys: [] })).rejects.toMatchObject({ status: 400 });
  });
});

describe("F-029 — required fields", () => {
  it("the impact preview counts existing items that lack a newly required field", async () => {
    const cat = await categories.create(sysAdminId, {
      key: key("req-preview"), name: "F029 Preview", iconKey: "Box", groupId, countingMode: "SERIALIZED", impairRule: "NEVER",
      canBeRoot: true, placement: "ANYWHERE", allowedParentCategoryIds: [], fields: [], templateChildren: [],
    });
    const orgNode = await prisma.orgNode.findFirstOrThrow({ where: { active: true } });
    const item = await prisma.item.create({
      data: { categoryId: cat.id, name: "F029 Item", countingMode: "SERIALIZED", qty: 1, status: "WORKING", ownerOrgNodeId: orgNode.id, currentOrgNodeId: orgNode.id, custodianId: sysAdminId },
    });
    const impact = await categories.previewImpact(cat.id, {
      fields: [{ key: "tag", label: "Asset tag", type: "TEXT", options: [], summary: false, longText: false, required: true, sortOrder: 0 }],
    });
    const note = impact.notes.find((n) => n.id === "cat-field-required-tag");
    expect(note?.severity).toBe("warning");
    expect(note?.title).toMatch(/1 existing item/);
    await prisma.item.delete({ where: { id: item.id } });
  });
});

describe("F-028 — a field type change cannot leave unreadable values behind", () => {
  it("is refused while an item holds an incompatible value, and allowed when the field is purged in the same save", async () => {
    const cat = await categories.create(sysAdminId, {
      key: key("type-change"), name: "F028 Type", iconKey: "Box", groupId, countingMode: "SERIALIZED", impairRule: "NEVER",
      canBeRoot: true, placement: "ANYWHERE", allowedParentCategoryIds: [], templateChildren: [],
      fields: [{ key: "reading", label: "Reading", type: "TEXT", options: [], summary: false, longText: false, required: false, sortOrder: 0 }],
    });
    const orgNode = await prisma.orgNode.findFirstOrThrow({ where: { active: true } });
    const item = await prisma.item.create({
      data: { categoryId: cat.id, name: "F028 Item", countingMode: "SERIALIZED", qty: 1, status: "WORKING", props: { reading: "about five" }, ownerOrgNodeId: orgNode.id, currentOrgNodeId: orgNode.id, custodianId: sysAdminId },
    });
    const numeric = [{ key: "reading", label: "Reading", type: "NUMBER" as const, options: [], summary: false, longText: false, required: false, sortOrder: 0 }];

    await expect(categories.update(sysAdminId, cat.id, { expectedVersion: cat.version, fields: numeric, purgeKeys: [] })).rejects.toMatchObject({ status: 409 });
    expect((await categories.getOne(cat.id)).fields[0].type).toBe("TEXT");

    const done = await categories.update(sysAdminId, cat.id, { expectedVersion: cat.version, fields: numeric, purgeKeys: ["reading"] });
    expect(done.fields[0].type).toBe("NUMBER");
    const after = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    expect((after.props as Record<string, unknown>).reading).toBeUndefined();
    await prisma.item.delete({ where: { id: item.id } });
  });

  it("allows a change every stored value survives", async () => {
    const cat = await categories.create(sysAdminId, {
      key: key("type-safe"), name: "F028 Safe", iconKey: "Box", groupId, countingMode: "SERIALIZED", impairRule: "NEVER",
      canBeRoot: true, placement: "ANYWHERE", allowedParentCategoryIds: [], templateChildren: [],
      fields: [{ key: "reading", label: "Reading", type: "TEXT", options: [], summary: false, longText: false, required: false, sortOrder: 0 }],
    });
    const done = await categories.update(sysAdminId, cat.id, {
      expectedVersion: cat.version, purgeKeys: [],
      fields: [{ key: "reading", label: "Reading", type: "NUMBER", options: [], summary: false, longText: false, required: false, sortOrder: 0 }],
    });
    expect(done.fields[0].type).toBe("NUMBER");
  });
});
