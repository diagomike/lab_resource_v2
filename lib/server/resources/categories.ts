import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { CategoryFieldType, CategoryImpactDto, CreateCategoryInput, ResourceCategoryDto, UpdateCategoryInput } from "@/lib/shared";
import { prisma } from "../prisma";
import { HttpError } from "../http-error";
import { categoryImpact } from "@/lib/domain/edit-impact";
import { canPlace } from "@/lib/domain/placement";
import type { Category } from "@/lib/domain/types";
import { toDomainCategory, toDomainCategoryMap, toDomainItem } from "./adapt";
import { wouldCreateTemplateCycle } from "./template-cycle";
import { LIVE_STATES } from "../scheduling/context";

type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

const CATEGORY_INCLUDE = {
  group: { select: { name: true } },
  fields: { orderBy: { sortOrder: "asc" as const } },
  templateAsParent: { include: { childCategory: { select: { name: true } } } },
  placementRulesAsChild: { include: { parentCategory: { select: { id: true, name: true } } } },
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
    canBeRoot: row.canBeRoot,
    placement: row.placement,
    bookingMode: row.bookingMode,
    publicListed: row.publicListed,
    allowedParents: row.placementRulesAsChild.map((r) => ({ id: r.id, parentCategoryId: r.parentCategoryId, parentCategoryName: r.parentCategory.name })),
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

/** How many items are currently filed under this category — the Category Studio's
 *  usage count, and what blocks a delete. Exposed separately from the DTO (rather than
 *  denormalised onto it) since it changes on every item write, not every category
 *  write. */
export async function usageCounts(): Promise<Record<string, number>> {
  const rows = await prisma.item.groupBy({ by: ["categoryId"], _count: { _all: true } });
  return Object.fromEntries(rows.map((r) => [r.categoryId, r._count._all]));
}

/** How many items already hold a non-empty value under each of this category's field
 *  keys — what locks a field's key input in the Studio editor (renaming a key in use
 *  would silently strand its values) and what the impact preview's own field-removed
 *  note counts. Scoped to ONE category at a time — an editor only ever needs this for
 *  the category currently open, not every row in a list. */
export async function fieldUsageCounts(categoryId: string): Promise<Record<string, number>> {
  const items = await prisma.item.findMany({ where: { categoryId, deletedAt: null }, select: { props: true } });
  const counts: Record<string, number> = {};
  for (const item of items) {
    const props = item.props as Record<string, unknown>;
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === "") continue;
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return counts;
}

function assertEnumFieldsHaveOptions(fields: { type: CategoryFieldType; options: string[]; label: string }[]): void {
  for (const f of fields) {
    if (f.type === "ENUM" && f.options.length === 0) {
      throw new HttpError(400, `"${f.label}" is an enum field and needs at least one option`);
    }
  }
}

/** Two categories filed under the same storage key would silently overwrite each
 *  other's stored values — caught here as a clean 400 rather than left to become a
 *  Zod-schema-compile surprise the first time category-props.ts builds a shape from
 *  these rows. */
function assertNoDuplicateFieldKeys(fields: { key: string }[]): void {
  const seen = new Set<string>();
  for (const f of fields) {
    if (seen.has(f.key)) throw new HttpError(400, `The field key "${f.key}" is used more than once`);
    seen.add(f.key);
  }
}

/** A category cannot be listed as its own default part twice — the schema's own
 *  `@@unique([parentCategoryId, childCategoryId])` would catch this as a raw
 *  constraint error; catching it here keeps that a named 400 instead. */
function assertNoDuplicateTemplateChildren(children: { childCategoryId: string }[]): void {
  const seen = new Set<string>();
  for (const c of children) {
    if (seen.has(c.childCategoryId)) throw new HttpError(400, "A category cannot be listed as a default part more than once");
    seen.add(c.childCategoryId);
  }
}

/** Every default-child id must exist, and adding this set must not create a direct or
 *  indirect cycle in the template graph (`wouldCreateTemplateCycle` covers direct
 *  self-reference too — a category cannot be built from itself). Takes a `client`
 *  parameter (plain `prisma` from `create`, the transaction's `tx` from `update`) so
 *  the same validation runs whether or not it is already inside a transaction. */
async function assertTemplateChildrenValid(client: Tx, parentId: string | null, childCategoryIds: string[]): Promise<void> {
  if (!childCategoryIds.length) return;
  const found = await client.resourceCategory.findMany({ where: { id: { in: childCategoryIds } }, select: { id: true } });
  if (found.length !== new Set(childCategoryIds).size) {
    throw new HttpError(400, "One or more default-child categories do not exist");
  }
  if (parentId) {
    const edges = await client.categoryTemplateChild.findMany({ select: { parentCategoryId: true, childCategoryId: true } });
    if (wouldCreateTemplateCycle(edges, parentId, childCategoryIds)) {
      throw new HttpError(400, "That default subtree would contain itself — choose parts that do not lead back to this category");
    }
  }
}

/** An allow-list entry must not be duplicated (the schema's own
 *  `@@unique([childCategoryId, parentCategoryId])` would otherwise surface as a raw
 *  constraint error) and every id in it must name a real category. No cycle check —
 *  unlike template children, an allow-list is not a build graph; a category naming
 *  itself as its own allowed parent is a legitimate "a small box may nest inside a
 *  bigger one of the same kind", not a structural error (the physical item tree's own
 *  `isWithinSubtree` guard is what actually prevents an item nesting inside itself). */
async function assertPlacementRulesValid(client: Tx, parentCategoryIds: string[]): Promise<void> {
  if (!parentCategoryIds.length) return;
  const seen = new Set<string>();
  for (const id of parentCategoryIds) {
    if (seen.has(id)) throw new HttpError(400, "A category cannot be listed as an allowed parent more than once");
    seen.add(id);
  }
  const found = await client.resourceCategory.findMany({ where: { id: { in: parentCategoryIds } }, select: { id: true } });
  if (found.length !== parentCategoryIds.length) {
    throw new HttpError(400, "One or more allowed-parent categories do not exist");
  }
}

/** Scheduling reserves individual units by time window; stock is never reserved that
 *  way (see prisma/schema.prisma's BookingMode note). */
function assertBookableCountingMode(bookingMode: string | undefined, countingMode: string): void {
  if (bookingMode && bookingMode !== "NOT_BOOKABLE" && countingMode !== "SERIALIZED") {
    throw new HttpError(400, "Only a category of individual units can be booked — bulk stock is never reserved by time.");
  }
}

export async function create(actorId: string, input: CreateCategoryInput): Promise<ResourceCategoryDto> {
  assertBookableCountingMode(input.bookingMode, input.countingMode);
  assertEnumFieldsHaveOptions(input.fields);
  assertNoDuplicateFieldKeys(input.fields);
  assertNoDuplicateTemplateChildren(input.templateChildren);
  const group = await prisma.categoryGroup.findUnique({ where: { id: input.groupId } });
  if (!group) throw new HttpError(400, "Choose an existing group");
  const existingKey = await prisma.resourceCategory.findUnique({ where: { key: input.key } });
  if (existingKey) throw new HttpError(400, `A category with key "${input.key}" already exists`);
  await assertTemplateChildrenValid(prisma, null, input.templateChildren.map((c) => c.childCategoryId));
  await assertPlacementRulesValid(prisma, input.allowedParentCategoryIds);

  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      const row = await tx.resourceCategory.create({
        data: {
          key: input.key,
          name: input.name,
          iconKey: input.iconKey,
          groupId: input.groupId,
          countingMode: input.countingMode,
          unit: input.unit ?? null,
          impairRule: input.impairRule,
          canBeRoot: input.canBeRoot,
          placement: input.placement,
          bookingMode: input.bookingMode ?? "NOT_BOOKABLE",
          publicListed: input.publicListed ?? false,
        },
      });
      if (input.allowedParentCategoryIds.length) {
        await tx.categoryPlacementRule.createMany({
          data: input.allowedParentCategoryIds.map((parentCategoryId) => ({ childCategoryId: row.id, parentCategoryId })),
        });
      }
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
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new HttpError(400, `A category with key "${input.key}" already exists`);
    }
    throw err;
  }

  return getOne(created.id);
}

/**
 * A whole-object write, refused (not merged) against a stale `expectedVersion`. Every
 * genuine alteration writes its own ItemChange line — "dropped the Type field, added
 * Warranty" rather than one opaque "edited" — mirroring
 * temp_works/src/lib/store.ts's `describeCategoryEdit`.
 *
 * The version check and every read the diff/impact computation depends on now run
 * INSIDE the same transaction as the write, against a `SELECT ... FOR UPDATE` lock —
 * see lib/server/resources/mutate.ts's own note (the item-level twin of this bug,
 * fixed first) on why a check made before the transaction opens can be invalidated by
 * a second writer in between. `getOne(id)` re-reads after the transaction commits,
 * outside the lock, since nothing about rendering the final DTO needs it held.
 *
 * Two side effects a category edit can trigger on every item already filed under it:
 * a counting-mode change rewrites the denormalised `Item.countingMode` (and forces
 * `qty` back to 1 for BULK → SERIALIZED, the direction that actually invalidates a
 * stored quantity); `purgeKeys` deletes the named prop keys from every item's `props`
 * — explicit and opt-in, since simply dropping a field from the schema strands its
 * values (dormant, not deleted) by default.
 */
export async function update(actorId: string, id: string, input: UpdateCategoryInput): Promise<ResourceCategoryDto> {
  await prisma.$transaction(async (tx) => {
    const lock = await tx.$queryRaw<{ id: string; version: number }[]>`
      SELECT id, version FROM "ResourceCategory" WHERE id = ${id} FOR UPDATE
    `;
    if (!lock.length) throw new HttpError(404, "Category not found");
    if (lock[0].version !== input.expectedVersion) {
      throw new HttpError(409, "Version conflict", {
        message: "This category has changed since you loaded it.",
        code: "VERSION_CONFLICT",
        expectedVersion: input.expectedVersion,
        actualVersion: lock[0].version,
      });
    }

    const before = await tx.resourceCategory.findUnique({ where: { id }, include: CATEGORY_INCLUDE });
    if (!before) throw new HttpError(404, "Category not found");

    assertBookableCountingMode(input.bookingMode ?? before.bookingMode, input.countingMode ?? before.countingMode);

    // F-051 of the 2026-09-15 campaign: turning a category away from ROOM/EQUIPMENT
    // used to leave every future reservation and class session against its items
    // live but orphaned — the room simply vanished from Schedule (getLab/
    // listCalendar 404 for a non-ROOM category), with nobody told and nothing left
    // to manage it from. Refused while any future live reservation exists; the
    // custodian cancels them first (which notifies people) or waits them out.
    if (input.bookingMode !== undefined && input.bookingMode !== before.bookingMode && before.bookingMode !== "NOT_BOOKABLE") {
      const futureReservations = await tx.reservation.count({
        where: { state: { in: LIVE_STATES }, endsAt: { gt: new Date() }, OR: [{ lab: { categoryId: id } }, { resources: { some: { item: { categoryId: id } } } }] },
      });
      if (futureReservations > 0) {
        throw new HttpError(409, `Cannot change booking mode — ${futureReservations} future reservation(s) still depend on it.`);
      }
    }

    const nextFields = input.fields ?? before.fields.map((f) => ({ ...f, unit: f.unit ?? undefined }));
    assertEnumFieldsHaveOptions(nextFields);
    if (input.fields) assertNoDuplicateFieldKeys(input.fields);

    if (input.groupId && input.groupId !== before.groupId) {
      const group = await tx.categoryGroup.findUnique({ where: { id: input.groupId } });
      if (!group) throw new HttpError(400, "Choose an existing group");
    }

    // The stable key seeds/imports target — editable, but Item.categoryId is a cuid
    // FK that never references it, so renaming it moves nothing else.
    if (input.key !== undefined && input.key !== before.key) {
      const clash = await tx.resourceCategory.findUnique({ where: { key: input.key } });
      if (clash) throw new HttpError(400, `A category with key "${input.key}" already exists`);
    }

    const nextTemplateChildren = input.templateChildren ?? before.templateAsParent.map((c) => ({ childCategoryId: c.childCategoryId, qty: c.qty, critical: c.critical }));
    if (input.templateChildren) {
      assertNoDuplicateTemplateChildren(input.templateChildren);
      await assertTemplateChildrenValid(tx, id, nextTemplateChildren.map((c) => c.childCategoryId));
    }

    const nextAllowedParentCategoryIds = input.allowedParentCategoryIds ?? before.placementRulesAsChild.map((r) => r.parentCategoryId);
    if (input.allowedParentCategoryIds) {
      await assertPlacementRulesValid(tx, input.allowedParentCategoryIds);
    }

    const beforeDomain = toDomainCategory(before, before.fields, before.templateAsParent, before.placementRulesAsChild);
    const afterDomain: Category = {
      ...beforeDomain,
      name: input.name ?? beforeDomain.name,
      iconKey: input.iconKey ?? beforeDomain.iconKey,
      countingMode: input.countingMode ?? beforeDomain.countingMode,
      unit: input.unit === undefined ? beforeDomain.unit : (input.unit ?? undefined),
      impairRule: input.impairRule ?? beforeDomain.impairRule,
      canBeRoot: input.canBeRoot ?? beforeDomain.canBeRoot,
      placement: input.placement ?? beforeDomain.placement,
      allowedParentCategoryIds: nextAllowedParentCategoryIds,
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

    const items = await tx.item.findMany({ where: { categoryId: id, deletedAt: null } });
    const domainItems = items.map((i) => toDomainItem(i));
    const diff = describeCategoryEdit(beforeDomain, afterDomain);
    // "key" lives on the Prisma row, not the domain Category shape describeCategoryEdit
    // diffs against, so it gets its own scalar line here rather than joining that list.
    if (input.key !== undefined && input.key !== before.key) {
      diff.push({ field: "key", before: before.key, after: input.key });
    }
    // Scheduling/portal flags live on the Prisma row only, same as "key" above.
    if (input.bookingMode !== undefined && input.bookingMode !== before.bookingMode) {
      diff.push({ field: "booking mode", before: before.bookingMode, after: input.bookingMode });
    }
    if (input.publicListed !== undefined && input.publicListed !== before.publicListed) {
      diff.push({ field: "public portal", before: before.publicListed, after: input.publicListed });
    }

    const countingModeChanged = input.countingMode !== undefined && input.countingMode !== before.countingMode;
    const purgeKeys = input.purgeKeys ?? [];

    // F-027 of the 2026-09-15 campaign: BULK -> SERIALIZED used to fail with a raw
    // 500 (the code set countingMode first, then qty = 1 in a second statement,
    // and the CHECK constraint fired on the first) — and even fixed to run
    // atomically, the switch silently turns "25 L of ethanol" into "1", with no
    // warning beyond a generic preview line. Refused outright while any item of
    // the category still holds a quantity other than 1; splitting into individual
    // units is a distinct, explicit action this does not attempt.
    if (countingModeChanged && input.countingMode === "SERIALIZED") {
      const withRealQty = items.filter((i) => Number(i.qty) !== 1);
      if (withRealQty.length) {
        throw new HttpError(409, "Cannot switch to serialized counting", {
          message: `${withRealQty.length} item(s) of this category hold a quantity other than 1 (e.g. "${withRealQty[0].name}" at ${Number(withRealQty[0].qty)}) — switching to serialized counting would silently reset them to 1. Split them into individual units first.`,
          itemIds: withRealQty.map((i) => i.id),
        });
      }
    }

    await tx.resourceCategory.update({
      where: { id },
      data: {
        version: { increment: 1 },
        ...(input.key !== undefined ? { key: input.key } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.iconKey !== undefined ? { iconKey: input.iconKey } : {}),
        ...(input.groupId !== undefined ? { groupId: input.groupId } : {}),
        ...(input.countingMode !== undefined ? { countingMode: input.countingMode } : {}),
        ...(input.unit !== undefined ? { unit: input.unit } : {}),
        ...(input.impairRule !== undefined ? { impairRule: input.impairRule } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.canBeRoot !== undefined ? { canBeRoot: input.canBeRoot } : {}),
        ...(input.placement !== undefined ? { placement: input.placement } : {}),
        ...(input.bookingMode !== undefined ? { bookingMode: input.bookingMode } : {}),
        ...(input.publicListed !== undefined ? { publicListed: input.publicListed } : {}),
      },
    });

    if (input.allowedParentCategoryIds) {
      await tx.categoryPlacementRule.deleteMany({ where: { childCategoryId: id } });
      if (input.allowedParentCategoryIds.length) {
        await tx.categoryPlacementRule.createMany({
          data: input.allowedParentCategoryIds.map((parentCategoryId) => ({ childCategoryId: id, parentCategoryId })),
        });
      }
    }

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

/** Deleting a category that ANOTHER category still lists as a default part would
 *  silently cascade-delete that `CategoryTemplateChild` row (the schema's own
 *  `onDelete: Cascade` on `childCategory`) — quietly rewriting a different category's
 *  default subtree with no one having agreed to that. Blocked by default; the caller
 *  explicitly confirms the collateral removal (`opts.confirmTemplateRemoval`) rather
 *  than being blocked outright, matching this project's "present and confirm, don't
 *  silently cascade" rule for consequential writes. */
export async function remove(actorId: string, id: string, opts?: { confirmTemplateRemoval?: boolean }): Promise<void> {
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

  const usedAsChild = await prisma.categoryTemplateChild.findMany({
    where: { childCategoryId: id },
    include: { parentCategory: { select: { id: true, name: true } } },
  });
  const parents = [...new Map(usedAsChild.map((c) => [c.parentCategory.id, c.parentCategory.name])).entries()];

  if (parents.length && !opts?.confirmTemplateRemoval) {
    const names = parents.map(([, name]) => name);
    throw new HttpError(409, "Cannot delete category", {
      message: `"${row.name}" is a default part of ${names.join(", ")}. Deleting it would silently drop it from ${names.length === 1 ? "that category's" : "those categories'"} default subtree unless you confirm that collateral change.`,
      code: "TEMPLATE_CHILD_IN_USE",
      parentCategoryNames: names,
    });
  }

  await prisma.$transaction(async (tx) => {
    for (const [parentId, parentName] of parents) {
      await tx.itemChange.create({
        data: {
          actorId,
          kind: "editCategory",
          targetKind: "CATEGORY",
          itemName: parentName,
          categoryId: parentId,
          field: `part ${id}`,
          before: `${row.name} (deleted)`,
          after: Prisma.DbNull,
          note: `"${row.name}" was deleted, removing it from this category's default subtree`,
        },
      });
    }
    await tx.resourceCategory.delete({ where: { id } });
  });
}

/** The blast-radius preview for a pending category edit — computed, never persisted.
 *  Draft carries the same optional fields UpdateCategoryInput does, minus
 *  expectedVersion/purgeKeys/note (a preview does not commit anything). */
export async function previewImpact(id: string, draft: Omit<UpdateCategoryInput, "expectedVersion" | "purgeKeys" | "note">): Promise<CategoryImpactDto> {
  const before = await loadOne(id);
  if (!before) throw new HttpError(404, "Category not found");

  const beforeDomain = toDomainCategory(before, before.fields, before.templateAsParent, before.placementRulesAsChild);
  const nextFields = draft.fields ?? before.fields.map((f) => ({ ...f, unit: f.unit ?? undefined }));
  const nextTemplateChildren = draft.templateChildren ?? before.templateAsParent.map((c) => ({ childCategoryId: c.childCategoryId, qty: c.qty, critical: c.critical }));
  const nextAllowedParentCategoryIds = draft.allowedParentCategoryIds ?? before.placementRulesAsChild.map((r) => r.parentCategoryId);
  const afterDomain: Category = {
    ...beforeDomain,
    name: draft.name ?? beforeDomain.name,
    iconKey: draft.iconKey ?? beforeDomain.iconKey,
    countingMode: draft.countingMode ?? beforeDomain.countingMode,
    unit: draft.unit === undefined ? beforeDomain.unit : (draft.unit ?? undefined),
    impairRule: draft.impairRule ?? beforeDomain.impairRule,
    canBeRoot: draft.canBeRoot ?? beforeDomain.canBeRoot,
    placement: draft.placement ?? beforeDomain.placement,
    allowedParentCategoryIds: nextAllowedParentCategoryIds,
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

  const placementWarning = await placementContradictionWarning(id, afterDomain);
  if (placementWarning) notes.push(placementWarning);

  return {
    affectedItemCount: domainItems.length,
    notes: notes.map((n) => ({ id: n.id, severity: n.severity, title: n.title, detail: n.detail, orphanKeys: n.orphanKeys ?? [] })),
  };
}

/** A template edge ("Computer is built from Motherboard") and a placement rule
 *  ("Motherboard may be placed inside Computer") are two independent, separately
 *  edited configurations — nothing keeps them in sync automatically. This is a
 *  deliberate warning, not a block: `categoryImpact`'s own notes stay pure (no
 *  database access), so this lives here in the server layer instead, where the full
 *  category map that `canPlace` needs is available via `toDomainCategoryMap`. */
async function placementContradictionWarning(categoryId: string, afterDomain: Category): Promise<CategoryImpactDto["notes"][number] | null> {
  if (!afterDomain.defaultChildren.length) return null;
  const rows = await prisma.resourceCategory.findMany({
    include: { group: { select: { name: true } }, fields: true, templateAsParent: true, placementRulesAsChild: true },
  });
  const categories = toDomainCategoryMap(rows);
  categories[categoryId] = afterDomain;

  const contradicting = afterDomain.defaultChildren.filter((c) => !canPlace(categories, c.categoryId, categoryId));
  if (!contradicting.length) return null;

  const names = contradicting.map((c) => categories[c.categoryId]?.name ?? c.categoryId);
  return {
    id: "placement-contradiction",
    severity: "warning",
    title: "Default parts that this category's own placement rules would refuse",
    detail: `${names.join(", ")} ${names.length === 1 ? "is" : "are"} a default part of this category, but ${names.length === 1 ? "its" : "their"} own placement rule does not allow it to be placed here. The two configurations disagree — creating from this template would violate the child's placement rule.`,
    orphanKeys: [],
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
  scalar("can be root", prev.canBeRoot, next.canBeRoot);
  scalar("placement mode", prev.placement, next.placement);

  const prevAllowedParents = new Set(prev.allowedParentCategoryIds);
  const nextAllowedParents = new Set(next.allowedParentCategoryIds);
  if (prevAllowedParents.size !== nextAllowedParents.size || [...prevAllowedParents].some((id) => !nextAllowedParents.has(id))) {
    out.push({ field: "allowed parents", before: [...prevAllowedParents], after: [...nextAllowedParents] });
  }

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
