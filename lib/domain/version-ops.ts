/**
 * Lab versions — Draft and Ideal as whole named trees (2026-09-22 rework).
 *
 * A version is a copy of one lab's tree: every row (`VItem`) either stands for a real
 * item (`sourceItemId`) or was added in the version (`sourceItemId: null`). The
 * custodian edits the copy with the same vocabulary the register uses (rename, set
 * status, add N × category, remove, move…); nothing here touches the live register.
 *
 *  - `applyVersionOp` — one edit against the copy, validated the way the write door
 *    would validate it (placement, sibling-name uniqueness, serialized quantity).
 *  - `diffVersion`    — what the copy would change if merged into Current: changed
 *    fields, additions, removals — the readable lines the head approves.
 *  - `idealStats`     — Ideal vs Current per category, and which ideal items have no
 *    real counterpart yet (the purchase list).
 *
 * Pure: no I/O, so the server (lab-versions.ts) and the tests share one truth.
 */
import type { Category, CustomProp, ItemStatus, PropValue } from "./types";
import { canPlace } from "./placement";
import { allocateNames, findNameClash } from "./naming";
import { instantiateMany } from "./instantiate";

export interface VItem {
  id: string;
  parentId: string | null;
  sourceItemId: string | null;
  categoryId: string;
  name: string;
  qty: number;
  status: ItemStatus;
  critical: boolean;
  props: Record<string, PropValue>;
  customProps: Record<string, CustomProp>;
}

/** A live register row, as far as a diff needs it. */
export interface LiveItem {
  id: string;
  parentId: string | null;
  categoryId: string;
  name: string;
  qty: number;
  status: ItemStatus;
  props: Record<string, PropValue>;
  customProps: Record<string, CustomProp>;
}

/** The edits a version accepts — the stageable part of the register's own vocabulary.
 *  Ids name VersionItems (the server translates real item ids first). Ownership,
 *  custody and transfers are never part of a lab version. */
export type VersionOp =
  | { kind: "createItem"; parentId: string; categoryId: string; count: number; name?: string; props?: Record<string, PropValue> }
  | { kind: "setName"; itemIds: string[]; value: string }
  | { kind: "setStatus"; itemIds: string[]; value: ItemStatus }
  | { kind: "setQuantity"; itemIds: string[]; value: number }
  | { kind: "setProperty"; itemIds: string[]; propKey: string; value: PropValue }
  | { kind: "addCustomProperty"; itemIds: string[]; key: string; type: CustomProp["type"]; value: PropValue }
  | { kind: "setCustomProperty"; itemIds: string[]; key: string; value: PropValue }
  | { kind: "removeCustomProperty"; itemIds: string[]; key: string }
  | { kind: "deleteItem"; itemIds: string[] }
  | { kind: "moveInTree"; itemIds: string[]; value: string };

export const VERSION_OP_KINDS = [
  "createItem",
  "setName",
  "setStatus",
  "setQuantity",
  "setProperty",
  "addCustomProperty",
  "setCustomProperty",
  "removeCustomProperty",
  "deleteItem",
  "moveInTree",
] as const;

/** A refusal with a message fit to show the custodian as-is. */
export class VersionOpError extends Error {}

export const STATUS_LABEL: Record<ItemStatus, string> = {
  WORKING: "Working",
  BROKEN: "Broken",
  UNDER_MAINTENANCE: "Under maintenance",
  LOST: "Lost",
  CONSUMED: "Consumed",
};

function childrenOf(items: VItem[], parentId: string | null): VItem[] {
  return items.filter((i) => i.parentId === parentId);
}

function subtreeIds(items: VItem[], rootIds: string[]): Set<string> {
  const out = new Set(rootIds);
  let grew = true;
  while (grew) {
    grew = false;
    for (const i of items) if (i.parentId && out.has(i.parentId) && !out.has(i.id)) (out.add(i.id), (grew = true));
  }
  return out;
}

/**
 * One edit against a version's rows. Returns the new rows (the input is never
 * mutated) and the ids it touched. `newId` names added rows.
 */
export function applyVersionOp(
  items: VItem[],
  op: VersionOp,
  ctx: { categories: Record<string, Category>; newId: () => string },
): { items: VItem[]; touched: string[] } {
  const byId = new Map(items.map((i) => [i.id, i]));
  const root = items.find((i) => i.parentId === null);
  const need = (id: string) => {
    const it = byId.get(id);
    if (!it) throw new VersionOpError("That item isn't part of this lab.");
    return it;
  };
  const patch = (ids: string[], f: (i: VItem) => VItem) => {
    for (const id of ids) need(id);
    const set = new Set(ids);
    return { items: items.map((i) => (set.has(i.id) ? f(i) : i)), touched: ids };
  };

  switch (op.kind) {
    case "createItem": {
      const parent = need(op.parentId);
      const cat = ctx.categories[op.categoryId];
      if (!cat) throw new VersionOpError("Choose an existing category.");
      if (!Number.isInteger(op.count) || op.count < 1 || op.count > 200) throw new VersionOpError("Add between 1 and 200 at a time.");
      if (!canPlace(ctx.categories, op.categoryId, parent.categoryId)) {
        throw new VersionOpError(`A ${cat.name} can't be placed inside ${parent.name}.`);
      }
      const base = op.name?.trim() || cat.name;
      const siblings = childrenOf(items, parent.id).map((i) => i.name);
      let names: string[];
      if (op.count === 1 && /\s\d+$/.test(base)) {
        if (findNameClash([base], siblings)) throw new VersionOpError(`"${base}" already exists here — choose another name.`);
        names = [base];
      } else names = allocateNames(base, siblings, op.count);
      const built = instantiateMany(
        ctx.categories,
        op.categoryId,
        parent.id,
        op.count,
        { ownerOrgNodeId: "-", custodianId: "-", now: new Date(0).toISOString() },
        false,
        1,
        { props: op.props, rootNames: names },
      );
      // instantiate's own ids → this version's ids.
      const idMap = new Map(built.map((b) => [b.id, ctx.newId()]));
      const added: VItem[] = built.map((b) => ({
        id: idMap.get(b.id)!,
        parentId: b.parentId === parent.id ? parent.id : idMap.get(b.parentId!)!,
        sourceItemId: null,
        categoryId: b.categoryId,
        name: b.name,
        qty: b.qty,
        status: b.status,
        critical: b.critical,
        props: b.props,
        customProps: {},
      }));
      return { items: [...items, ...added], touched: added.filter((a) => a.parentId === parent.id).map((a) => a.id) };
    }
    case "setName": {
      const value = op.value.trim().replace(/\s+/g, " ");
      if (!value) throw new VersionOpError("A name can't be blank.");
      const targets = op.itemIds.map(need);
      const groups = new Map<string, VItem[]>();
      for (const t of targets) groups.set(t.parentId ?? "", [...(groups.get(t.parentId ?? "") ?? []), t]);
      const newName = new Map<string, string>();
      for (const group of groups.values()) {
        const ids = new Set(group.map((g) => g.id));
        const siblings = childrenOf(items, group[0].parentId).filter((i) => !ids.has(i.id)).map((i) => i.name);
        if (group.length === 1) {
          if (findNameClash([value], siblings)) throw new VersionOpError(`"${value}" already exists here — choose another name.`);
          newName.set(group[0].id, value);
        } else allocateNames(value, siblings, group.length).forEach((n, k) => newName.set(group[k].id, n));
      }
      return patch(op.itemIds, (i) => ({ ...i, name: newName.get(i.id)! }));
    }
    case "setStatus":
      return patch(op.itemIds, (i) => ({ ...i, status: op.value }));
    case "setQuantity": {
      if (!Number.isFinite(op.value) || op.value < 0) throw new VersionOpError("Quantity must be zero or more.");
      for (const id of op.itemIds) {
        const it = need(id);
        if (ctx.categories[it.categoryId]?.countingMode === "SERIALIZED" && op.value !== 1) {
          throw new VersionOpError("Serialized items always have a quantity of 1.");
        }
      }
      return patch(op.itemIds, (i) => ({ ...i, qty: op.value }));
    }
    case "setProperty": {
      for (const id of op.itemIds) {
        const it = need(id);
        if (!ctx.categories[it.categoryId]?.fields.some((f) => f.key === op.propKey)) {
          throw new VersionOpError(`${it.name} has no "${op.propKey}" property.`);
        }
      }
      return patch(op.itemIds, (i) => ({ ...i, props: { ...i.props, [op.propKey]: op.value } }));
    }
    case "addCustomProperty":
      return patch(op.itemIds, (i) => {
        if (i.customProps[op.key]) throw new VersionOpError(`${i.name} already has "${op.key}".`);
        return { ...i, customProps: { ...i.customProps, [op.key]: { type: op.type, value: op.value } } };
      });
    case "setCustomProperty":
      return patch(op.itemIds, (i) => {
        const cur = i.customProps[op.key];
        if (!cur) throw new VersionOpError(`${i.name} has no "${op.key}" property.`);
        return { ...i, customProps: { ...i.customProps, [op.key]: { ...cur, value: op.value } } };
      });
    case "removeCustomProperty":
      return patch(op.itemIds, (i) => {
        const next = { ...i.customProps };
        delete next[op.key];
        return { ...i, customProps: next };
      });
    case "deleteItem": {
      for (const id of op.itemIds) {
        if (need(id).id === root?.id) throw new VersionOpError("The lab itself can't be removed from its own version.");
      }
      const gone = subtreeIds(items, op.itemIds);
      return { items: items.filter((i) => !gone.has(i.id)), touched: op.itemIds };
    }
    case "moveInTree": {
      const target = need(op.value);
      const moving = op.itemIds.map(need);
      const inside = subtreeIds(items, op.itemIds);
      for (const m of moving) {
        if (m.id === root?.id) throw new VersionOpError("The lab itself can't be moved.");
        if (inside.has(target.id)) throw new VersionOpError(`${m.name} can't be moved inside itself.`);
        if (!canPlace(ctx.categories, m.categoryId, target.categoryId)) {
          throw new VersionOpError(`${m.name} can't be placed inside ${target.name}.`);
        }
      }
      const arriving = moving.filter((m) => m.parentId !== target.id);
      const ids = new Set(arriving.map((m) => m.id));
      const clash = findNameClash(
        arriving.map((m) => m.name),
        childrenOf(items, target.id).filter((i) => !ids.has(i.id)).map((i) => i.name),
      );
      if (clash) throw new VersionOpError(`Something named "${clash}" is already in ${target.name}.`);
      return patch(op.itemIds, (i) => ({ ...i, parentId: target.id }));
    }
  }
}

// ── Diff: what merging would change ──────────────────────────────────────

export interface DiffEntry {
  kind: "added" | "removed" | "changed";
  /** The version row (added/changed) — null for a removal. */
  versionItemId: string | null;
  /** The real item (changed/removed) — null for an addition. */
  sourceItemId: string | null;
  name: string;
  categoryId: string;
  /** Readable, e.g. "Status: Working → Broken", "Added in Block 510 R8 (with 11 parts)",
   *  "Moved from Block 510 R8 into Workstation 20 › Computer › Motherboard". */
  lines: string[];
  /** Where a marker belongs in the live register: the item itself, or for an addition
   *  its nearest real ancestor. */
  markerItemId: string | null;
}

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

/**
 * The version's difference from the live register. `baseIds` — the real items the
 * version was copied from: a copied item missing from the version is a removal; a live
 * item that arrived after the copy was taken is NOT (the version never knew it).
 * Additions and removals are reported top-most only, with their parts counted.
 */
export function diffVersion(
  version: VItem[],
  live: LiveItem[],
  baseIds: Iterable<string>,
  labels: { categoryName: (id: string) => string; fieldLabel?: (categoryId: string, key: string) => string },
): DiffEntry[] {
  const liveById = new Map(live.map((l) => [l.id, l]));
  const vById = new Map(version.map((v) => [v.id, v]));
  const linked = new Map(version.filter((v) => v.sourceItemId).map((v) => [v.sourceItemId!, v]));
  const out: DiffEntry[] = [];

  const realAncestor = (v: VItem): string | null => {
    let cur: VItem | undefined = v.parentId ? vById.get(v.parentId) : undefined;
    while (cur) {
      if (cur.sourceItemId && liveById.has(cur.sourceItemId)) return cur.sourceItemId;
      cur = cur.parentId ? vById.get(cur.parentId) : undefined;
    }
    return null;
  };
  // Where something sits, as a path below the lab ("Workstation 20 › Computer ›
  // Motherboard") — R2-5 of the 2026-09-23 run: "Moved into Motherboard" didn't say
  // which of 25 workstations. The lab itself is named only when it IS the place.
  const pathIn = (id: string | null, byId: Map<string, { name: string; parentId: string | null }>): string => {
    const names: string[] = [];
    let cur = id ? byId.get(id) : undefined;
    while (cur) {
      if (cur.parentId === null && names.length) break;
      names.unshift(cur.name);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return names.join(" › ") || "—";
  };
  const countBelow = (rootId: string, rows: Array<{ id: string; parentId: string | null }>): number => {
    let n = 0;
    const stack = [rootId];
    while (stack.length) {
      const id = stack.pop()!;
      for (const r of rows) if (r.parentId === id) (n++, stack.push(r.id));
    }
    return n;
  };

  for (const v of version) {
    if (!v.sourceItemId) {
      const parent = v.parentId ? vById.get(v.parentId) : undefined;
      if (parent && !parent.sourceItemId) continue; // inside another addition — counted there
      const parts = countBelow(v.id, version);
      out.push({
        kind: "added",
        versionItemId: v.id,
        sourceItemId: null,
        name: v.name,
        categoryId: v.categoryId,
        lines: [`Added${parent ? ` in ${pathIn(parent.id, vById)}` : ""}${parts ? ` (with ${parts} part${parts === 1 ? "" : "s"})` : ""}`],
        markerItemId: realAncestor(v),
      });
      continue;
    }
    const l = liveById.get(v.sourceItemId);
    if (!l) continue;
    const lines: string[] = [];
    if (v.name !== l.name) lines.push(`Name: ${l.name} → ${v.name}`);
    if (v.status !== l.status) lines.push(`Status: ${STATUS_LABEL[l.status]} → ${STATUS_LABEL[v.status]}`);
    if (Number(v.qty) !== Number(l.qty)) lines.push(`Quantity: ${fmt(l.qty)} → ${fmt(v.qty)}`);
    for (const key of new Set([...Object.keys(v.props), ...Object.keys(l.props)])) {
      if ((v.props[key] ?? null) !== (l.props[key] ?? null)) {
        lines.push(`${labels.fieldLabel?.(v.categoryId, key) ?? key}: ${fmt(l.props[key])} → ${fmt(v.props[key])}`);
      }
    }
    for (const key of new Set([...Object.keys(v.customProps), ...Object.keys(l.customProps)])) {
      const before = l.customProps[key]?.value ?? null;
      const after = v.customProps[key]?.value ?? null;
      if (!(key in v.customProps)) lines.push(`${key}: removed`);
      else if (before !== after || !(key in l.customProps)) lines.push(`${key}: ${fmt(before)} → ${fmt(after)}`);
    }
    const vParent = v.parentId ? vById.get(v.parentId) : undefined;
    const newParentReal = vParent?.sourceItemId ?? null;
    if (v.parentId && newParentReal !== l.parentId) {
      lines.push(`Moved from ${pathIn(l.parentId, liveById)} into ${pathIn(v.parentId, vById)}`);
    }
    if (lines.length) {
      out.push({ kind: "changed", versionItemId: v.id, sourceItemId: l.id, name: v.name, categoryId: v.categoryId, lines, markerItemId: l.id });
    }
  }

  const removedIds = [...baseIds].filter((id) => liveById.has(id) && !linked.has(id));
  const removed = new Set(removedIds);
  for (const id of removedIds) {
    const l = liveById.get(id)!;
    if (l.parentId && removed.has(l.parentId)) continue; // inside another removal
    const parts = countBelow(id, live.filter((x) => removed.has(x.id)));
    out.push({
      kind: "removed",
      versionItemId: null,
      sourceItemId: id,
      name: l.name,
      categoryId: l.categoryId,
      lines: [`Removed${l.parentId ? ` from ${pathIn(l.parentId, liveById)}` : ""}${parts ? ` (with ${parts} part${parts === 1 ? "" : "s"})` : ""}`],
      markerItemId: id,
    });
  }

  const order = { changed: 0, added: 1, removed: 2 } as const;
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return out.sort((a, b) => order[a.kind] - order[b.kind] || collator.compare(a.name, b.name));
}

// ── Ideal vs Current ────────────────────────────────────────────────────

export interface IdealStatRow {
  categoryId: string;
  idealCount: number;
  currentCount: number;
  gap: number;
  /** Ideal rows with no real counterpart in the lab — what would have to be bought. */
  missing: Array<{ id: string; name: string }>;
}

/**
 * Per category: how many the Ideal tree holds, how many the lab really holds, and the
 * shortfall. The lab's own row is not counted. An ideal row is "missing" when it has
 * no real item behind it (added in the ideal, or its real item has since gone).
 */
export function idealStats(ideal: VItem[], live: LiveItem[], labItemId: string): IdealStatRow[] {
  const liveIds = new Set(live.map((l) => l.id));
  const rows = new Map<string, IdealStatRow>();
  const row = (categoryId: string) => {
    let r = rows.get(categoryId);
    if (!r) rows.set(categoryId, (r = { categoryId, idealCount: 0, currentCount: 0, gap: 0, missing: [] }));
    return r;
  };
  for (const v of ideal) {
    if (v.parentId === null) continue;
    const r = row(v.categoryId);
    r.idealCount += 1;
    if (!v.sourceItemId || !liveIds.has(v.sourceItemId)) r.missing.push({ id: v.id, name: v.name });
  }
  for (const l of live) {
    if (l.id === labItemId) continue;
    row(l.categoryId).currentCount += 1;
  }
  for (const r of rows.values()) r.gap = Math.max(0, r.idealCount - r.currentCount);
  return [...rows.values()];
}
