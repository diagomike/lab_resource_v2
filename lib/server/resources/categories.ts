import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { CategoryFieldType, CategoryImpactDto, CreateCategoryInput, ItemPropValue, ResourceCategoryDto, UpdateCategoryInput } from "@/lib/shared";
import { prisma } from "../prisma";
import { HttpError } from "../http-error";
import { categoryImpact } from "@/lib/domain/edit-impact";
import { categoryKeyFor, distinctValues, fieldKeyFor, planCategoryMigration } from "@/lib/domain/field-migration";
import { icons as LUCIDE_ICONS } from "lucide-react";
import { CATEGORY_ICONS } from "@/lib/domain/icons";
import type { Category, Item } from "@/lib/domain/types";
import { FIELD_TYPE, toDomainCategory, toDomainItem } from "./adapt";
import { wouldCreateTemplateCycle } from "./template-cycle";
import { validatePropWrite } from "./category-props";
import { LIVE_STATES } from "../scheduling/context";

type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

const CATEGORY_INCLUDE = {
  group: { select: { name: true } },
  fields: { orderBy: { sortOrder: "asc" as const } },
  templateAsParent: { include: { childCategory: { select: { name: true } } } },
  steward: { select: { name: true } },
  createdBy: { select: { name: true } },
  _count: { select: { changes: { where: { status: "PENDING" as const } } } },
} as const;

type CategoryRow = NonNullable<Awaited<ReturnType<typeof loadOne>>>;

async function loadOne(id: string, client: Tx = prisma) {
  return client.resourceCategory.findUnique({ where: { id }, include: CATEGORY_INCLUDE });
}

/** The university-wide steward's name, for categories no department looks after. */
const UNIVERSITY_STEWARD = "Property Administration (university-wide)";

function toDto(row: CategoryRow): ResourceCategoryDto {
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
    isPlace: row.isPlace,
    bookingMode: row.bookingMode,
    publicListed: row.publicListed,
    description: row.description,
    stewardNodeId: row.stewardNodeId,
    stewardName: row.steward?.name ?? UNIVERSITY_STEWARD,
    createdById: row.createdById,
    createdByName: row.createdBy?.name ?? null,
    pendingChanges: row._count.changes,
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
      hint: f.hint,
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

/** For each detail of one category: how many items hold a value, and the distinct
 *  values (up to 40) — what the editor shows ("25 in use"), asks about before a rename,
 *  and turns into a choice's options when a text detail becomes a choice. */
export async function fieldUsage(categoryId: string): Promise<{ counts: Record<string, number>; values: Record<string, string[]> }> {
  const row = await loadOne(categoryId);
  if (!row) throw new HttpError(404, "Category not found");
  const items = (await prisma.item.findMany({ where: { categoryId, deletedAt: null } })).map((i) => toDomainItem(i));
  const counts: Record<string, number> = {};
  const values: Record<string, string[]> = {};
  for (const f of row.fields) {
    counts[f.key] = items.filter((i) => i.props[f.key] !== null && i.props[f.key] !== undefined && i.props[f.key] !== "").length;
    if (counts[f.key]) values[f.key] = distinctValues(items, f.key, { key: f.key, label: f.label, type: FIELD_TYPE[f.type], unit: f.unit ?? undefined });
  }
  return { counts, values };
}

function assertEnumFieldsHaveOptions(fields: { type: CategoryFieldType; options: string[]; label: string }[]): void {
  for (const f of fields) {
    if (f.type === "ENUM" && f.options.length === 0) {
      throw new HttpError(400, `“${f.label}” is a choice and needs at least one option`);
    }
  }
}

function assertNoDuplicateLabels(fields: { label: string }[]): void {
  const seen = new Set<string>();
  for (const f of fields) {
    const k = f.label.trim().toLowerCase();
    if (seen.has(k)) throw new HttpError(400, `Two details are called “${f.label.trim()}” — give each its own name`);
    seen.add(k);
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
 *  self-reference too — a category cannot be built from itself). */
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

/** Scheduling reserves individual units by time window; stock is never reserved that
 *  way (see prisma/schema.prisma's BookingMode note). */
function assertBookableCountingMode(bookingMode: string | undefined, countingMode: string): void {
  if (bookingMode && bookingMode !== "NOT_BOOKABLE" && countingMode !== "SERIALIZED") {
    throw new HttpError(400, "Only a category of individual units can be booked — bulk stock is never reserved by time.");
  }
}

/** F-030: an unknown icon key silently rendered the fallback glyph; refuse it at the door. */
function assertKnownIcon(iconKey: string | undefined): void {
  // The curated set (lib/domain/icons.ts) includes lucide aliases — Layers3, Waves —
  // that lucide's own `icons` map lists only under their newer names.
  if (iconKey !== undefined && !Object.prototype.hasOwnProperty.call(LUCIDE_ICONS, iconKey) && !Object.prototype.hasOwnProperty.call(CATEGORY_ICONS, iconKey)) {
    throw new HttpError(400, "Unknown icon \"" + iconKey + "\" — pick one from the icon list.");
  }
}

type FieldInput = NonNullable<UpdateCategoryInput["fields"]>[number];
type KeyedField = FieldInput & { key: string };

/**
 * A detail's key is its identity, never shown: an existing detail keeps the key it has;
 * a new one is given one from its label, unique against every key in use or used
 * before (`taken`) — so two details can never collide, whatever they are called.
 */
function withKeys(fields: FieldInput[], taken: string[]): KeyedField[] {
  const given = fields.map((f) => f.key).filter((k): k is string => !!k);
  if (new Set(given).size !== given.length) throw new HttpError(400, "Two details share one identity — reload the category and try again");
  const used = new Set([...taken, ...given]);
  return fields.map((f) => {
    if (f.key) return { ...f, key: f.key };
    const key = fieldKeyFor(f.label, used);
    used.add(key);
    return { ...f, key };
  });
}

const fieldRowData = (f: KeyedField, i: number) => ({
  key: f.key,
  label: f.label.trim(),
  type: f.type,
  options: f.type === "ENUM" ? f.options.map((o) => o.trim()).filter(Boolean) : [],
  unit: f.type === "NUMBER" ? (f.unit?.trim() || null) : null,
  summary: f.summary,
  longText: f.type === "TEXT" ? f.longText : false,
  required: f.required,
  sortOrder: i,
  hint: f.hint?.trim() || null,
});

export async function create(actorId: string, input: CreateCategoryInput, opts: { stewardNodeId?: string | null } = {}): Promise<ResourceCategoryDto> {
  assertKnownIcon(input.iconKey);
  assertBookableCountingMode(input.bookingMode, input.countingMode);
  assertEnumFieldsHaveOptions(input.fields);
  assertNoDuplicateLabels(input.fields);
  assertNoDuplicateTemplateChildren(input.templateChildren);
  const group = await prisma.categoryGroup.findUnique({ where: { id: input.groupId } });
  if (!group) throw new HttpError(400, "Choose an existing group");
  const takenNames = await prisma.resourceCategory.findFirst({ where: { name: { equals: input.name.trim(), mode: "insensitive" } }, select: { id: true } });
  if (takenNames) throw new HttpError(400, `A category called “${input.name.trim()}” already exists — open it, or give this one a more specific name`);
  let key = input.key;
  if (key) {
    if (await prisma.resourceCategory.findUnique({ where: { key } })) throw new HttpError(400, `A category with key "${key}" already exists`);
  } else {
    key = categoryKeyFor(input.name, (await prisma.resourceCategory.findMany({ select: { key: true } })).map((r) => r.key));
  }
  await assertTemplateChildrenValid(prisma, null, input.templateChildren.map((c) => c.childCategoryId));
  const fields = withKeys(input.fields, []);

  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      const row = await tx.resourceCategory.create({
        data: {
          key: key!,
          name: input.name,
          iconKey: input.iconKey,
          groupId: input.groupId,
          countingMode: input.countingMode,
          unit: input.countingMode === "BULK" ? (input.unit ?? null) : null,
          impairRule: input.impairRule,
          isPlace: input.isPlace,
          bookingMode: input.bookingMode ?? "NOT_BOOKABLE",
          publicListed: input.publicListed ?? false,
          description: input.description || null,
          stewardNodeId: opts.stewardNodeId ?? null,
          createdById: actorId,
        },
      });
      if (fields.length) await tx.categoryField.createMany({ data: fields.map((f, i) => ({ categoryId: row.id, ...fieldRowData(f, i) })) });
      if (input.templateChildren.length) {
        await tx.categoryTemplateChild.createMany({
          data: input.templateChildren.map((c) => ({ parentCategoryId: row.id, childCategoryId: c.childCategoryId, qty: c.qty, critical: c.critical })),
        });
      }
      await tx.itemChange.create({
        data: { actorId, kind: "editCategory", targetKind: "CATEGORY", itemName: row.name, categoryId: row.id, field: "created", after: row.name },
      });
      return row;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new HttpError(400, `A category with key "${key}" already exists`);
    }
    throw err;
  }

  return getOne(created.id);
}

/** An edit as services pass it: the erase/fill/move choices are optional (the route's
 *  schema defaults them). */
export type UpdateArgs = Omit<UpdateCategoryInput, "purgeKeys" | "fills" | "optionMoves"> & Partial<Pick<UpdateCategoryInput, "purgeKeys" | "fills" | "optionMoves">>;
export type EditDraft = Omit<UpdateArgs, "expectedVersion" | "note">;

/** Everything an edit is judged against: the category as it is, as it would be, and the
 *  items it reaches — shared by the impact preview, the governance check and the write. */
export interface EditContext {
  row: CategoryRow;
  before: Category & { bookingMode: string; publicListed: boolean; description: string | null };
  after: Category & { bookingMode: string; publicListed: boolean; description: string | null };
  fields: KeyedField[];
  items: Array<{ id: string; name: string; ownerOrgNodeId: string }>;
  domainItems: Item[];
}

export async function editContext(id: string, draft: EditDraft, client: Tx = prisma): Promise<EditContext> {
  const row = await loadOne(id, client);
  if (!row) throw new HttpError(404, "Category not found");
  const fields = draft.fields ? withKeys(draft.fields, row.fields.map((f) => f.key)) : row.fields.map((f) => ({ ...f, unit: f.unit ?? undefined }));
  const children = draft.templateChildren ?? row.templateAsParent.map((c) => ({ childCategoryId: c.childCategoryId, qty: c.qty, critical: c.critical }));
  const beforeDomain = toDomainCategory(row, row.fields, row.templateAsParent);
  const before = { ...beforeDomain, bookingMode: row.bookingMode, publicListed: row.publicListed, description: row.description };
  const after = {
    ...before,
    name: draft.name ?? before.name,
    iconKey: draft.iconKey ?? before.iconKey,
    countingMode: draft.countingMode ?? before.countingMode,
    unit: draft.unit === undefined ? before.unit : (draft.unit ?? undefined),
    impairRule: draft.impairRule ?? before.impairRule,
    isPlace: draft.isPlace ?? before.isPlace,
    bookingMode: draft.bookingMode ?? before.bookingMode,
    publicListed: draft.publicListed ?? before.publicListed,
    description: draft.description === undefined ? before.description : draft.description,
    fields: fields.map((f) => ({
      key: f.key,
      label: f.label.trim(),
      type: FIELD_TYPE[f.type],
      options: f.type === "ENUM" && f.options?.length ? f.options : undefined,
      unit: f.type === "NUMBER" ? (f.unit ?? undefined) : undefined,
      summary: f.summary,
      long: f.longText,
      required: f.required || undefined,
    })),
    defaultChildren: children.map((c) => ({ categoryId: c.childCategoryId, qty: c.qty, critical: c.critical })),
  };
  const rows = await client.item.findMany({ where: { categoryId: id, deletedAt: null } });
  return { row, before, after, fields, items: rows.map((r) => ({ id: r.id, name: r.name, ownerOrgNodeId: r.ownerOrgNodeId })), domainItems: rows.map((r) => toDomainItem(r)) };
}

/** Fill values, typed and checked against the detail they fill. */
function typedFills(ctx: EditContext, fills: Record<string, ItemPropValue>): Record<string, ItemPropValue> {
  const out: Record<string, ItemPropValue> = {};
  for (const [key, value] of Object.entries(fills)) {
    if (value === null || value === "") continue;
    const f = ctx.fields.find((x) => x.key === key);
    if (!f) throw new HttpError(400, "Fill in only details this category has.");
    out[key] = validatePropWrite({ key: f.key, label: f.label, type: f.type, options: f.options }, value);
  }
  return out;
}

function assertOptionMoves(ctx: EditContext, moves: NonNullable<UpdateArgs["optionMoves"]>): void {
  for (const [key, map] of Object.entries(moves)) {
    const f = ctx.after.fields.find((x) => x.key === key);
    for (const target of Object.values(map)) {
      if (target !== null && !(f?.options ?? []).includes(target)) throw new HttpError(400, `Move values to one of “${f?.label ?? key}”’s options.`);
    }
  }
}

/**
 * A whole-object write, refused (not merged) against a stale `expectedVersion`. Every
 * genuine alteration writes its own ItemChange line — "dropped the Type field, added
 * Warranty" rather than one opaque "edited" — mirroring
 * temp_works/src/lib/store.ts's `describeCategoryEdit`.
 *
 * The version check and every read the edit depends on run INSIDE the transaction,
 * against a `SELECT ... FOR UPDATE` lock (lib/server/resources/mutate.ts explains why a
 * check made before the transaction opens can be invalidated by a second writer).
 *
 * Values items hold follow the definition (lib/domain/field-migration.ts): a retyped
 * detail's values are converted; what can't be converted, a removed detail's values and
 * a removed choice's values are kept on each item as an extra detail — or erased when
 * named in `purgeKeys`; `optionMoves` moves a removed choice's values to another option;
 * `fills` fills a detail on the items that have none. Nothing is stranded unseen.
 *
 * This is the write itself; who may make it, and whether it waits for approval, is
 * lib/server/resources/category-governance.ts.
 */
export async function update(actorId: string, id: string, input: UpdateArgs): Promise<ResourceCategoryDto> {
  assertKnownIcon(input.iconKey);
  await prisma.$transaction(
    async (tx) => {
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

      const ctx = await editContext(id, input, tx);
      const { row: before } = ctx;

      assertBookableCountingMode(input.bookingMode ?? before.bookingMode, input.countingMode ?? before.countingMode);

      // F-051: turning a category away from ROOM/EQUIPMENT used to leave every future
      // reservation and class session against its items live but orphaned. Refused
      // while any future live reservation exists; the custodian cancels them first.
      if (input.bookingMode !== undefined && input.bookingMode !== before.bookingMode && before.bookingMode !== "NOT_BOOKABLE") {
        const futureReservations = await tx.reservation.count({
          where: { state: { in: LIVE_STATES }, endsAt: { gt: new Date() }, OR: [{ lab: { categoryId: id } }, { resources: { some: { item: { categoryId: id } } } }] },
        });
        if (futureReservations > 0) {
          throw new HttpError(409, `Cannot change booking mode — ${futureReservations} future reservation(s) still depend on it.`);
        }
      }

      assertEnumFieldsHaveOptions(ctx.fields.map((f) => ({ type: f.type, options: f.options ?? [], label: f.label })));
      if (input.fields) assertNoDuplicateLabels(input.fields);

      if (input.groupId && input.groupId !== before.groupId) {
        const group = await tx.categoryGroup.findUnique({ where: { id: input.groupId } });
        if (!group) throw new HttpError(400, "Choose an existing group");
      }
      if (input.name !== undefined && input.name.trim().toLowerCase() !== before.name.trim().toLowerCase()) {
        const clash = await tx.resourceCategory.findFirst({ where: { id: { not: id }, name: { equals: input.name.trim(), mode: "insensitive" } }, select: { id: true } });
        if (clash) throw new HttpError(400, `A category called “${input.name.trim()}” already exists`);
      }
      // The stable key seeds/imports target — Item.categoryId never references it.
      if (input.key !== undefined && input.key !== before.key) {
        const clash = await tx.resourceCategory.findUnique({ where: { key: input.key } });
        if (clash) throw new HttpError(400, `A category with key "${input.key}" already exists`);
      }

      if (input.templateChildren) {
        assertNoDuplicateTemplateChildren(input.templateChildren);
        await assertTemplateChildrenValid(tx, id, input.templateChildren.map((c) => c.childCategoryId));
      }

      const countingModeChanged = input.countingMode !== undefined && input.countingMode !== before.countingMode;
      // F-027: BULK → SERIALIZED would silently turn "25 L of ethanol" into "1".
      // Refused while any item holds a quantity other than 1.
      if (countingModeChanged && input.countingMode === "SERIALIZED") {
        const rows = await tx.item.findMany({ where: { categoryId: id, deletedAt: null, NOT: { qty: 1 } }, select: { id: true, name: true, qty: true } });
        if (rows.length) {
          throw new HttpError(409, "Cannot switch to serialized counting", {
            message: `${rows.length} item(s) of this category hold a quantity other than 1 (e.g. "${rows[0].name}" at ${Number(rows[0].qty)}) — switching to serialized counting would silently reset them to 1. Split them into individual units first.`,
            itemIds: rows.map((i) => i.id),
          });
        }
      }

      assertOptionMoves(ctx, input.optionMoves ?? {});
      const plan = planCategoryMigration(ctx.before, ctx.after, ctx.domainItems, { erase: input.purgeKeys ?? [], fills: typedFills(ctx, input.fills ?? {}), optionMoves: input.optionMoves ?? {} });

      const diff = describeCategoryEdit(ctx.before, ctx.after);
      if (input.key !== undefined && input.key !== before.key) diff.push({ field: "key", before: before.key, after: input.key });
      if (input.bookingMode !== undefined && input.bookingMode !== before.bookingMode) diff.push({ field: "booking mode", before: before.bookingMode, after: input.bookingMode });
      if (input.publicListed !== undefined && input.publicListed !== before.publicListed) diff.push({ field: "public portal", before: before.publicListed, after: input.publicListed });
      if (input.description !== undefined && (input.description || null) !== before.description) diff.push({ field: "description", before: before.description, after: input.description || null });

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
          ...(input.isPlace !== undefined ? { isPlace: input.isPlace } : {}),
          ...(input.bookingMode !== undefined ? { bookingMode: input.bookingMode } : {}),
          ...(input.publicListed !== undefined ? { publicListed: input.publicListed } : {}),
          ...(input.description !== undefined ? { description: input.description || null } : {}),
        },
      });

      if (input.fields) {
        await tx.categoryField.deleteMany({ where: { categoryId: id } });
        if (ctx.fields.length) await tx.categoryField.createMany({ data: ctx.fields.map((f, i) => ({ categoryId: id, ...fieldRowData(f, i) })) });
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

      // The values items hold, following the new definition.
      for (const m of plan.items) {
        await tx.item.update({
          where: { id: m.itemId },
          data: { props: m.props as Prisma.InputJsonValue, customProps: m.customProps as unknown as Prisma.InputJsonValue, version: { increment: 1 } },
        });
      }

      for (const d of diff) {
        await tx.itemChange.create({
          data: {
            actorId,
            kind: "editCategory",
            targetKind: "CATEGORY",
            itemName: ctx.after.name,
            categoryId: id,
            field: d.field,
            before: d.before === undefined ? undefined : d.before === null ? Prisma.DbNull : (d.before as Prisma.InputJsonValue),
            after: d.after === undefined ? undefined : d.after === null ? Prisma.DbNull : (d.after as Prisma.InputJsonValue),
            note: input.note,
          },
        });
      }
      if (plan.items.length) {
        const parts = [
          plan.converted && `${plan.converted} converted`,
          plan.filled && `${plan.filled} filled in`,
          plan.kept.length && `${plan.kept.length} kept as extra details`,
          plan.erased.length && `${plan.erased.length} erased`,
        ].filter(Boolean);
        await tx.itemChange.create({
          data: {
            actorId,
            kind: "editCategory",
            targetKind: "CATEGORY",
            itemName: ctx.after.name,
            categoryId: id,
            field: "values",
            after: `${parts.join(", ")} on ${plan.items.length} item(s)`,
            note: input.note,
          },
        });
      }
    },
    { timeout: 120_000, maxWait: 10_000 },
  );

  return getOne(id);
}

/** Deleting a category that ANOTHER category still lists as a default part would
 *  silently cascade-delete that `CategoryTemplateChild` row — blocked by default; the
 *  caller explicitly confirms the collateral removal (`opts.confirmTemplateRemoval`). */
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

/** What an edit would do — computed, never persisted. Who decides it is added by
 *  category-governance.ts `previewEdit`. */
export async function previewImpact(id: string, draft: EditDraft): Promise<Omit<CategoryImpactDto, "decision">> {
  const ctx = await editContext(id, draft);
  const notes = categoryImpact(ctx.before, ctx.after, ctx.domainItems);

  const placementWarning = await placementContradictionWarning(ctx.after);
  if (placementWarning) notes.push(placementWarning);

  // F-051: the preview used to say only "Reaches N existing items" while every future
  // booking and class on those rooms stayed live — the same count update() refuses on.
  if (draft.bookingMode !== undefined && draft.bookingMode !== ctx.row.bookingMode && ctx.row.bookingMode !== "NOT_BOOKABLE") {
    const future = await prisma.reservation.count({
      where: { state: { in: LIVE_STATES }, endsAt: { gt: new Date() }, OR: [{ lab: { categoryId: id } }, { resources: { some: { item: { categoryId: id } } } }] },
    });
    if (future > 0) {
      notes.push({
        id: "future-reservations",
        severity: "destructive",
        title: `${future} future booking${future === 1 ? "" : "s"} and class session${future === 1 ? "" : "s"} depend on this`,
        detail: "This change will be refused until they are cancelled (which notifies the people booked) or have passed.",
      });
    }
  }

  return {
    affectedItemCount: ctx.domainItems.length,
    notes: notes.map((n) => {
      const field = ctx.fields.find((f) => f.key === (n.optionMove?.key ?? n.fill?.key));
      return {
        id: n.id,
        severity: n.severity,
        title: n.title,
        detail: n.detail,
        orphanKeys: n.orphanKeys ?? [],
        examples: n.examples ?? [],
        ...(n.optionMove ? { optionMove: { ...n.optionMove, options: field?.options ?? [] } } : {}),
        ...(n.fill && field ? { fill: { ...n.fill, type: field.type, options: field.options ?? [] } } : {}),
      };
    }),
  };
}

/** A place can't be anyone's part (it never sits inside anything) — said in the preview
 *  rather than left to fail when the template is first used. */
async function placementContradictionWarning(afterDomain: Category): Promise<ReturnType<typeof categoryImpact>[number] | null> {
  if (!afterDomain.defaultChildren.length) return null;
  const places = await prisma.resourceCategory.findMany({ where: { id: { in: afterDomain.defaultChildren.map((c) => c.categoryId) }, isPlace: true }, select: { name: true } });
  if (!places.length) return null;
  const names = places.map((p) => p.name);
  return {
    id: "placement-contradiction",
    severity: "warning",
    title: "A place can't be a part",
    detail: `${names.join(", ")} ${names.length === 1 ? "is a place" : "are places"} (top level only), so ${names.length === 1 ? "it" : "they"} can't be built into this.`,
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
  scalar("place", prev.isPlace ?? false, next.isPlace ?? false);

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
