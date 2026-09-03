import "server-only";
import { Prisma } from "@prisma/client";
import type { CategoryFieldType, CategoryImpactDto, CreateCategoryInput, ResourceCategoryDto, UpdateCategoryInput } from "@/lib/shared";
import { prisma } from "../prisma";
import { HttpError } from "../http-error";
import { categoryImpact } from "@/lib/domain/edit-impact";
import type { Category } from "@/lib/domain/types";
import { toDomainCategory, toDomainItem } from "./adapt";
import { wouldCreateTemplateCycle } from "./template-cycle";

const CATEGORY_INCLUDE = {
  group: { select: { name: true } },
  fields: { orderBy: { sortOrder: "asc" as const } },
  templateAsParent: { include: { childCategory: { select: { name: true } } } },
} as const;

type CategoryRow = Awaited<ReturnType<typeof loadOne>>;

async function loadOne(id: string) {
  return prisma.resourceCategory.findUnique({ where: { id }, include: CATEGORY_INCLUDE });
}

function toDto(row: NonNullable<CategoryRow>): ResourceCategoryDto {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    iconKey: row.iconKey,
    groupId: row.groupId,
    groupName: row.group.name,
    countingMode: row.countingMode,
    unit: row.unit,
    impairRule: row.impairRule,
    defaultImageKey: row.defaultImageKey,
    version: row.version,
    active: row.active,
    fields: row.fields.map((f) => ({
      id: f.id,
      key: f.key,
      label: f.label,
      type: f.type,
      options: f.options,
      unit: f.unit,
      summary: f.summary,
      longText: f.longText,
      required: f.required,
      sortOrder: f.sortOrder,
    })),
    templateChildren: row.templateAsParent.map((c) => ({
      id: c.id,
      childCategoryId: c.childCategoryId,
      childCategoryName: c.childCategory.name,
      qty: c.qty,
      critical: c.critical,
    })),
  };
}

export async function list(): Promise<ResourceCategoryDto[]> {
  const rows = await prisma.resourceCategory.findMany({
    include: CATEGORY_INCLUDE,
    orderBy: [{ group: { sortOrder: "asc" } }, { name: "asc" }],
  });
  return rows.map(toDto);
}

export async function getOne(id: string): Promise<ResourceCategoryDto> {
  const row = await loadOne(id);
  if (!row) throw new HttpError(404, "Category not found");
  return toDto(row);
}

function assertEnumFieldsHaveOptions(fields: { type: CategoryFieldType; options: string[]; label: string }[]): void {
  for (const f of fields) {
    if (f.type === "ENUM" && f.options.length === 0) {
      throw new HttpError(400, `"${f.label}" is an enum field and needs at least one option`);
    }
  }
}

async function assertTemplateChildrenValid(parentId: string | null, childCategoryIds: string[]): Promise<void> {
  if (!childCategoryIds.length) return;
  const found = await prisma.resourceCategory.findMany({ where: { id: { in: childCategoryIds } }, select: { id: true } });
  if (found.length !== new Set(childCategoryIds).size) {
    throw new HttpError(400, "One or more default-child categories do not exist");
  }
  if (parentId) {
    const edges = await prisma.categoryTemplateChild.findMany({ select: { parentCategoryId: true, childCategoryId: true } });
    if (wouldCreateTemplateCycle(edges, parentId, childCategoryIds)) {
      throw new HttpError(400, "That default subtree would contain itself — choose parts that do not lead back to this category");
    }
  }
}

export async function create(actorId: string, input: CreateCategoryInput): Promise<ResourceCategoryDto> {
  assertEnumFieldsHaveOptions(input.fields);
  const group = await prisma.categoryGroup.findUnique({ where: { id: input.groupId } });
  if (!group) throw new HttpError(400, "Choose an existing group");
  const existingKey = await prisma.resourceCategory.findUnique({ where: { key: input.key } });
  if (existingKey) throw new HttpError(400, `A category with key "${input.key}" already exists`);
  await assertTemplateChildrenValid(null, input.templateChildren.map((c) => c.childCategoryId));

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.resourceCategory.create({
      data: {
        key: input.key,
        name: input.name,
        iconKey: input.iconKey,
        groupId: input.groupId,
        countingMode: input.countingMode,
        unit: input.unit ?? null,
        impairRule: input.impairRule,
      },
    });
    if (input.fields.length) {
      await tx.categoryField.createMany({
        data: input.fields.map((f) => ({
          categoryId: row.id,
          key: f.key,
          label: f.label,
          type: f.type,
          options: f.options,
          unit: f.unit ?? null,
          summary: f.summary,
          longText: f.longText,
          required: f.required,
          sortOrder: f.sortOrder,
        })),
      });
    }
    if (input.templateChildren.length) {
      await tx.categoryTemplateChild.createMany({
        data: input.templateChildren.map((c) => ({
          parentCategoryId: row.id,
          childCategoryId: c.childCategoryId,
          qty: c.qty,
          critical: c.critical,
        })),
      });
    }
    await tx.itemChange.create({
      data: {
        actorId,
        kind: "editCategory",
        targetKind: "CATEGORY",
        itemName: row.name,
        categoryId: row.id,
        field: "created",
        after: row.name,
      },
    });
    return row;
  });

  return getOne(created.id);
}

/**
 * A whole-object write, refused (not merged) against a stale `expectedVersion`. Every
 * genuine alteration writes its own ItemChange line — "dropped the Type field, added
 * Warranty" rather than one opaque "edited" — mirroring
 * temp_works/src/lib/store.ts's `describeCategoryEdit`.
 *
 * Two side effects a category edit can trigger on every item already filed under it:
 * a counting-mode change rewrites the denormalised `Item.countingMode` (and forces
 * `qty` back to 1 for BULK → SERIALIZED, the direction that actually invalidates a
 * stored quantity); `purgeKeys` deletes the named prop keys from every item's `props`
 * — explicit and opt-in, since simply dropping a field from the schema strands its
 * values (dormant, not deleted) by default.
 */
export async function update(actorId: string, id: string, input: UpdateCategoryInput): Promise<ResourceCategoryDto> {
  const before = await loadOne(id);
  if (!before) throw new HttpError(404, "Category not found");
  if (before.version !== input.expectedVersion) {
    throw new HttpError(409, "Version conflict", {
      message: "This category has changed since you loaded it.",
      code: "VERSION_CONFLICT",
      expectedVersion: input.expectedVersion,
      actualVersion: before.version,
    });
  }

  const nextFields = input.fields ?? before.fields.map((f) => ({ ...f, unit: f.unit ?? undefined }));
  assertEnumFieldsHaveOptions(nextFields);

  if (input.groupId && input.groupId !== before.groupId) {
    const group = await prisma.categoryGroup.findUnique({ where: { id: input.groupId } });
    if (!group) throw new HttpError(400, "Choose an existing group");
  }

  const nextTemplateChildren = input.templateChildren ?? before.templateAsParent.map((c) => ({ childCategoryId: c.childCategoryId, qty: c.qty, critical: c.critical }));
  if (input.templateChildren) {
    await assertTemplateChildrenValid(id, nextTemplateChildren.map((c) => c.childCategoryId));
  }

  const beforeDomain = toDomainCategory(before, before.fields, before.templateAsParent);
  const afterDomain: Category = {
    ...beforeDomain,
    name: input.name ?? beforeDomain.name,
    iconKey: input.iconKey ?? beforeDomain.iconKey,
    countingMode: input.countingMode ?? beforeDomain.countingMode,
    unit: input.unit === undefined ? beforeDomain.unit : (input.unit ?? undefined),
    impairRule: input.impairRule ?? beforeDomain.impairRule,
    fields: nextFields.map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type === "TEXT" ? "text" : f.type === "NUMBER" ? "number" : f.type === "ENUM" ? "enum" : "boolean",
      options: f.options?.length ? f.options : undefined,
      unit: f.unit ?? undefined,
      summary: f.summary,
      long: "longText" in f ? f.longText : (f as { long?: boolean }).long,
    })),
    defaultChildren: nextTemplateChildren.map((c) => ({ categoryId: c.childCategoryId, qty: c.qty, critical: c.critical })),
  };

  const items = await prisma.item.findMany({ where: { categoryId: id, deletedAt: null } });
  const domainItems = items.map((i) => toDomainItem(i));
  const diff = describeCategoryEdit(beforeDomain, afterDomain);

  const countingModeChanged = input.countingMode !== undefined && input.countingMode !== before.countingMode;
  const purgeKeys = input.purgeKeys ?? [];

  await prisma.$transaction(async (tx) => {
    await tx.resourceCategory.update({
      where: { id },
      data: {
        version: { increment: 1 },
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.iconKey !== undefined ? { iconKey: input.iconKey } : {}),
        ...(input.groupId !== undefined ? { groupId: input.groupId } : {}),
        ...(input.countingMode !== undefined ? { countingMode: input.countingMode } : {}),
        ...(input.unit !== undefined ? { unit: input.unit } : {}),
        ...(input.impairRule !== undefined ? { impairRule: input.impairRule } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
    });

    if (input.fields) {
      await tx.categoryField.deleteMany({ where: { categoryId: id } });
      if (input.fields.length) {
        await tx.categoryField.createMany({
          data: input.fields.map((f) => ({
            categoryId: id,
            key: f.key,
            label: f.label,
            type: f.type,
            options: f.options,
            unit: f.unit ?? null,
            summary: f.summary,
            longText: f.longText,
            required: f.required,
            sortOrder: f.sortOrder,
          })),
        });
      }
    }

    if (input.templateChildren) {
      await tx.categoryTemplateChild.deleteMany({ where: { parentCategoryId: id } });
      if (input.templateChildren.length) {
        await tx.categoryTemplateChild.createMany({
          data: input.templateChildren.map((c) => ({ parentCategoryId: id, childCategoryId: c.childCategoryId, qty: c.qty, critical: c.critical })),
        });
      }
    }

    if (countingModeChanged) {
      await tx.item.updateMany({ where: { categoryId: id }, data: { countingMode: input.countingMode! } });
      if (input.countingMode === "SERIALIZED") {
        await tx.item.updateMany({ where: { categoryId: id }, data: { qty: 1 } });
      }
    }

    for (const key of purgeKeys) {
      await tx.$executeRawUnsafe(`UPDATE "Item" SET props = props - $1 WHERE "categoryId" = $2`, key, id);
    }

    for (const d of diff) {
      await tx.itemChange.create({
        data: {
          actorId,
          kind: "editCategory",
          targetKind: "CATEGORY",
          itemName: afterDomain.name,
          categoryId: id,
          field: d.field,
          before: d.before === undefined ? undefined : d.before === null ? Prisma.DbNull : (d.before as Prisma.InputJsonValue),
          after: d.after === undefined ? undefined : d.after === null ? Prisma.DbNull : (d.after as Prisma.InputJsonValue),
          note: input.note,
        },
      });
    }
    if (purgeKeys.length) {
      await tx.itemChange.create({
        data: {
          actorId,
          kind: "editCategory",
          targetKind: "CATEGORY",
          itemName: afterDomain.name,
          categoryId: id,
          field: "purgeKeys",
          before: purgeKeys,
          after: Prisma.DbNull,
          note: `Purged from ${domainItems.length} item(s)`,
        },
      });
    }
  });

  return getOne(id);
}

export async function remove(id: string): Promise<void> {
  const row = await loadOne(id);
  if (!row) throw new HttpError(404, "Category not found");
  const itemCount = await prisma.item.count({ where: { categoryId: id } });
  if (itemCount > 0) {
    throw new HttpError(409, "Cannot delete category", {
      message: `Cannot delete "${row.name}" — ${itemCount} item(s) are still filed under it`,
      code: "DELETE_BLOCKED",
      itemCount,
    });
  }
  await prisma.resourceCategory.delete({ where: { id } });
}

/** The blast-radius preview for a pending category edit — computed, never persisted.
 *  Draft carries the same optional fields UpdateCategoryInput does, minus
 *  expectedVersion/purgeKeys/note (a preview does not commit anything). */
export async function previewImpact(id: string, draft: Omit<UpdateCategoryInput, "expectedVersion" | "purgeKeys" | "note">): Promise<CategoryImpactDto> {
  const before = await loadOne(id);
  if (!before) throw new HttpError(404, "Category not found");

  const beforeDomain = toDomainCategory(before, before.fields, before.templateAsParent);
  const nextFields = draft.fields ?? before.fields.map((f) => ({ ...f, unit: f.unit ?? undefined }));
  const nextTemplateChildren = draft.templateChildren ?? before.templateAsParent.map((c) => ({ childCategoryId: c.childCategoryId, qty: c.qty, critical: c.critical }));
  const afterDomain: Category = {
    ...beforeDomain,
    name: draft.name ?? beforeDomain.name,
    iconKey: draft.iconKey ?? beforeDomain.iconKey,
    countingMode: draft.countingMode ?? beforeDomain.countingMode,
    unit: draft.unit === undefined ? beforeDomain.unit : (draft.unit ?? undefined),
    impairRule: draft.impairRule ?? beforeDomain.impairRule,
    fields: nextFields.map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type === "TEXT" ? "text" : f.type === "NUMBER" ? "number" : f.type === "ENUM" ? "enum" : "boolean",
      options: f.options?.length ? f.options : undefined,
      unit: f.unit ?? undefined,
      summary: f.summary,
      long: "longText" in f ? f.longText : (f as { long?: boolean }).long,
    })),
    defaultChildren: nextTemplateChildren.map((c) => ({ categoryId: c.childCategoryId, qty: c.qty, critical: c.critical })),
  };

  const items = await prisma.item.findMany({ where: { categoryId: id, deletedAt: null } });
  const domainItems = items.map((i) => toDomainItem(i));
  const notes = categoryImpact(beforeDomain, afterDomain, domainItems);

  return {
    affectedItemCount: domainItems.length,
    notes: notes.map((n) => ({ severity: n.severity, message: n.detail ? `${n.title} — ${n.detail}` : n.title })),
  };
}

/** One audit line per genuine alteration — ported from
 *  temp_works/src/lib/store.ts's `describeCategoryEdit`, verbatim in shape. */
function describeCategoryEdit(prev: Category, next: Category): Array<{ field: string; before?: unknown; after?: unknown }> {
  const out: Array<{ field: string; before?: unknown; after?: unknown }> = [];
  const scalar = (label: string, a: unknown, b: unknown) => {
    if (a !== b) out.push({ field: label, before: a ?? null, after: b ?? null });
  };
  scalar("name", prev.name, next.name);
  scalar("group", prev.group, next.group);
  scalar("icon", prev.iconKey, next.iconKey);
  scalar("counting mode", prev.countingMode, next.countingMode);
  scalar("unit", prev.unit, next.unit);
  scalar("failure rule", prev.impairRule, next.impairRule);

  const describeField = (f: Category["fields"][number]) =>
    `${f.label} (${f.type}${f.options?.length ? `: ${f.options.join("/")}` : ""}${f.unit ? `, ${f.unit}` : ""})`;

  const prevFields = new Map(prev.fields.map((f) => [f.key, f]));
  const nextFields = new Map(next.fields.map((f) => [f.key, f]));
  for (const [key, f] of prevFields) {
    if (!nextFields.has(key)) out.push({ field: `field ${key}`, before: describeField(f), after: null });
  }
  for (const [key, f] of nextFields) {
    const prevField = prevFields.get(key);
    if (!prevField) out.push({ field: `field ${key}`, before: null, after: describeField(f) });
    else if (JSON.stringify(prevField) !== JSON.stringify(f)) {
      out.push({ field: `field ${key}`, before: describeField(prevField), after: describeField(f) });
    }
  }

  const prevParts = new Map(prev.defaultChildren.map((c) => [c.categoryId, c]));
  const nextParts = new Map(next.defaultChildren.map((c) => [c.categoryId, c]));
  const partLabel = (c: { qty: number; critical: boolean }) => `${c.qty}×${c.critical ? " critical" : ""}`;
  for (const [id, c] of prevParts) {
    if (!nextParts.has(id)) out.push({ field: `part ${id}`, before: partLabel(c), after: null });
  }
  for (const [id, c] of nextParts) {
    const prevPart = prevParts.get(id);
    if (!prevPart) out.push({ field: `part ${id}`, before: null, after: partLabel(c) });
    else if (prevPart.qty !== c.qty || prevPart.critical !== c.critical) {
      out.push({ field: `part ${id}`, before: partLabel(prevPart), after: partLabel(c) });
    }
  }

  return out;
}
