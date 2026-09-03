import type {
  CategoryField as PrismaCategoryField,
  CategoryTemplateChild as PrismaCategoryTemplateChild,
  Item as PrismaItem,
  ItemImage as PrismaItemImage,
  Prisma,
  ResourceCategory as PrismaResourceCategory,
} from "@prisma/client";
import type { Category, FieldDef, FieldType, Item, ItemImage, PropValue } from "@/lib/domain/types";

/**
 * Prisma row → lib/domain shape, both directions' single crossing point. No
 * "server-only" — pure mapping, no Prisma client import, directly usable from a spec
 * with plain fixture objects (as adapt.spec.ts does) as easily as from live rows.
 *
 * lib/domain/** is written against its own internal vocabulary (types.ts's own
 * comment explains why: separate from both the Prisma models and lib/shared's wire
 * DTOs). Every server module that calls into a ported domain function — items.ts,
 * mutate.ts, categories.ts — goes through here rather than hand-rolling the
 * translation at each call site.
 */

const FIELD_TYPE: Record<PrismaCategoryField["type"], FieldType> = {
  TEXT: "text",
  NUMBER: "number",
  ENUM: "enum",
  BOOLEAN: "boolean",
};

function decimalToNumber(v: Prisma.Decimal | number): number {
  return typeof v === "number" ? v : v.toNumber();
}

/** No object-storage driver exists yet (Phase 9 of
 *  ~/.claude/plans/wait-i-want-gentle-haven.md) — a stand-in URL under the same path
 *  that phase's serving endpoint will occupy, so nothing downstream has to change
 *  shape when the real driver lands, only what this function returns. */
export function imageUrl(storageKey: string): string {
  return `/api/resources/images/${storageKey}`;
}

export function toDomainItemImage(row: PrismaItemImage): ItemImage {
  return { id: row.id, src: imageUrl(row.storageKey), caption: row.caption ?? undefined };
}

export function toDomainItem(row: PrismaItem, images: PrismaItemImage[] = []): Item {
  return {
    id: row.id,
    parentId: row.parentId,
    categoryId: row.categoryId,
    name: row.name,
    qty: decimalToNumber(row.qty),
    status: row.status,
    critical: row.critical,
    props: (row.props as Record<string, PropValue>) ?? {},
    images: images.map(toDomainItemImage),
    ownerOrgNodeId: row.ownerOrgNodeId,
    currentOrgNodeId: row.currentOrgNodeId,
    custodianId: row.custodianId,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toDomainField(row: PrismaCategoryField): FieldDef {
  return {
    key: row.key,
    label: row.label,
    type: FIELD_TYPE[row.type],
    options: row.options.length ? row.options : undefined,
    unit: row.unit ?? undefined,
    summary: row.summary,
    long: row.longText,
  };
}

export function toDomainCategory(
  row: PrismaResourceCategory & { group: { name: string } },
  fields: PrismaCategoryField[],
  templateChildren: PrismaCategoryTemplateChild[],
): Category {
  return {
    id: row.id,
    name: row.name,
    iconKey: row.iconKey,
    countingMode: row.countingMode,
    unit: row.unit ?? undefined,
    fields: fields.map(toDomainField),
    defaultChildren: templateChildren.map((c) => ({ categoryId: c.childCategoryId, qty: c.qty, critical: c.critical })),
    impairRule: row.impairRule,
    group: row.group.name,
    defaultImage: row.defaultImageKey ? imageUrl(row.defaultImageKey) : undefined,
    version: row.version,
  };
}

/** Builds the `Record<string, Category>` lib/domain's functions take, from a batch of
 *  rows loaded with their fields/templateChildren relations included. */
export function toDomainCategoryMap(
  rows: Array<PrismaResourceCategory & { group: { name: string }; fields: PrismaCategoryField[]; templateAsParent: PrismaCategoryTemplateChild[] }>,
): Record<string, Category> {
  const out: Record<string, Category> = {};
  for (const row of rows) out[row.id] = toDomainCategory(row, row.fields, row.templateAsParent);
  return out;
}
