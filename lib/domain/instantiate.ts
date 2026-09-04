/**
 * Category → real rows — ported from temp_works/src/lib/instantiate.ts, verbatim.
 * This is the single place a Category's template turns into real Items, used both by
 * the real-data importer and the "Add N × <category>" dialog, so a Computer added by
 * hand has exactly the same shape as one from an import.
 */
import type { Category, Item, PropValue } from "./types";

let counter = 0;
export function newId(prefix = "i"): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export interface InstantiateCtx {
  ownerOrgNodeId: string;
  /** Defaults to the owner — a thing is held by whoever owns it until it is lent out. */
  currentOrgNodeId?: string;
  /** Never null — see Item.custodianId. A resource is created into somebody's care. */
  custodianId: string;
  now: string;
}

/**
 * Create an item and its whole default subtree, recursively. Used both by the seed
 * and by the "Add N × <category>" dialog — so a Computer added by hand in year three
 * has exactly the same shape as one from the original import.
 */
export function buildSubtree(
  categories: Record<string, Category>,
  categoryId: string,
  parentId: string | null,
  name: string,
  critical: boolean,
  ctx: InstantiateCtx,
  out: Item[] = [],
  depth = 0,
): Item[] {
  const cat = categories[categoryId];
  if (!cat || depth > 10) return out;

  const id = newId();
  const props: Record<string, PropValue> = {};
  for (const f of cat.fields) props[f.key] = null;

  out.push({
    id,
    parentId,
    categoryId,
    name,
    qty: 1,
    status: "WORKING",
    critical,
    props,
    images: [],
    ownerOrgNodeId: ctx.ownerOrgNodeId,
    currentOrgNodeId: ctx.currentOrgNodeId ?? ctx.ownerOrgNodeId,
    custodianId: ctx.custodianId,
    version: 1,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  });

  for (const slot of cat.defaultChildren) {
    const childCat = categories[slot.categoryId];
    if (!childCat) continue;
    for (let i = 0; i < slot.qty; i++) {
      const childName = slot.qty > 1 ? `${childCat.name} ${i + 1}` : childCat.name;
      buildSubtree(categories, slot.categoryId, id, childName, slot.critical, ctx, out, depth + 1);
    }
  }
  return out;
}

/** `count` siblings of one category under one parent, numbered when there is more than one.
 *  `overrides.baseName`, if given, replaces the category's own name as the numbering
 *  base (a Lab worth naming, not just "Lab 01") — trimmed and falling back to the
 *  category name when blank. `overrides.props` is merged onto each ROOT item created
 *  (never onto a template's own auto-generated children, which keep their normal
 *  blank start) — the creation-modal case of filling a category's fields in at
 *  creation time instead of via a follow-up edit. */
export function instantiateMany(
  categories: Record<string, Category>,
  categoryId: string,
  parentId: string | null,
  count: number,
  ctx: InstantiateCtx,
  critical = false,
  startIndex = 1,
  overrides?: { baseName?: string; props?: Record<string, PropValue> },
): Item[] {
  const cat = categories[categoryId];
  if (!cat) return [];
  const out: Item[] = [];
  const baseName = overrides?.baseName?.trim() || cat.name;
  for (let i = 0; i < count; i++) {
    const n = startIndex + i;
    const name = count > 1 || startIndex > 1 ? `${baseName} ${String(n).padStart(2, "0")}` : baseName;
    const rootIndex = out.length;
    buildSubtree(categories, categoryId, parentId, name, critical, ctx, out);
    if (overrides?.props) Object.assign(out[rootIndex].props, overrides.props);
  }
  return out;
}
