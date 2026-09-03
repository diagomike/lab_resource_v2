/**
 * The row model — ported from temp_works/src/lib/tree.ts, verbatim.
 *
 * A parent's children are grouped by category. A group of one renders as itself; a
 * group of many collapses into a synthetic CLUSTER row — "Workstation Setup ×25". The
 * cluster is not stored anywhere: it is a view over its members, and editing a cell on
 * it is simply a bulk edit applied to every member. Bulk-fill and per-item override are
 * therefore the same mechanism seen at two altitudes, not two features.
 */
import type { Category, Item, PropValue } from "./types";

export interface ItemRow {
  kind: "item";
  id: string;
  item: Item;
  children: RowNode[];
  /** The items this row speaks for — itself. */
  memberIds: string[];
  depth: number;
}

export interface ClusterRow {
  kind: "cluster";
  id: string;
  categoryId: string;
  members: Item[];
  /** The items this row speaks for — all of them. Editing here edits all of these. */
  memberIds: string[];
  children: RowNode[];
  depth: number;
}

export type RowNode = ItemRow | ClusterRow;

export interface TreeIndex {
  byId: Map<string, Item>;
  childrenOf: Map<string, Item[]>;
  roots: Item[];
}

export function indexItems(items: Item[]): TreeIndex {
  const byId = new Map<string, Item>();
  const childrenOf = new Map<string, Item[]>();
  const roots: Item[] = [];
  for (const it of items) byId.set(it.id, it);
  for (const it of items) {
    if (it.parentId == null || !byId.has(it.parentId)) {
      roots.push(it);
      continue;
    }
    const arr = childrenOf.get(it.parentId);
    if (arr) arr.push(it);
    else childrenOf.set(it.parentId, [it]);
  }
  return { byId, childrenOf, roots };
}

/** Which items survive a filter, tree-aware: a match keeps its whole ancestor chain
 *  (so you can still see where it lives) and its whole subtree (so you can still
 *  drill into it). */
export function expandMatches(index: TreeIndex, matched: Set<string>): Set<string> {
  const keep = new Set<string>();
  for (const id of matched) {
    let cur = index.byId.get(id);
    while (cur && !keep.has(cur.id)) {
      keep.add(cur.id);
      cur = cur.parentId ? index.byId.get(cur.parentId) : undefined;
    }
  }
  const stack = [...matched];
  while (stack.length) {
    const id = stack.pop()!;
    for (const c of index.childrenOf.get(id) ?? []) {
      if (!keep.has(c.id)) {
        keep.add(c.id);
        stack.push(c.id);
      }
    }
  }
  return keep;
}

export function buildTree(index: TreeIndex, keep: Set<string> | null): RowNode[] {
  const visited = new Set<string>();

  const build = (kids: Item[], depth: number): RowNode[] => {
    const visible = keep ? kids.filter((k) => keep.has(k.id)) : kids;
    const groups = new Map<string, Item[]>();
    for (const k of visible) {
      const arr = groups.get(k.categoryId);
      if (arr) arr.push(k);
      else groups.set(k.categoryId, [k]);
    }

    const out: RowNode[] = [];
    for (const [categoryId, members] of groups) {
      // Roots are places — labs and stores are always listed by name. Collapsing
      // "SE Lab X" and "Civil Materials Lab" into "Lab ×2" hides the only thing that
      // distinguishes them.
      if (members.length === 1 || depth === 0) {
        for (const m of members) out.push(itemRow(m, depth));
        continue;
      }
      out.push({
        kind: "cluster",
        id: `cl:${members[0].parentId ?? "root"}:${categoryId}`,
        categoryId,
        members,
        memberIds: members.map((m) => m.id),
        children: members.map((m) => itemRow(m, depth + 1)),
        depth,
      });
    }
    return out;
  };

  const itemRow = (item: Item, depth: number): ItemRow => {
    if (visited.has(item.id)) {
      return { kind: "item", id: item.id, item, children: [], memberIds: [item.id], depth };
    }
    visited.add(item.id);
    return {
      kind: "item",
      id: item.id,
      item,
      children: build(index.childrenOf.get(item.id) ?? [], depth + 1),
      memberIds: [item.id],
      depth,
    };
  };

  return build(index.roots, 0);
}

/**
 * Roll-up view: each place lists its ENTIRE subtree grouped by category, not just its
 * direct children. "SE Lab X › Computer ×25" instead of 25 setup branches — the same
 * cluster mechanism as tree mode, just gathered across levels.
 */
export function buildRollup(index: TreeIndex, keep: Set<string> | null): RowNode[] {
  const out: RowNode[] = [];
  const roots = keep ? index.roots.filter((r) => keep.has(r.id)) : index.roots;

  for (const root of roots) {
    const descendants: Item[] = [];
    const stack = [...(index.childrenOf.get(root.id) ?? [])];
    const seen = new Set<string>();
    while (stack.length) {
      const it = stack.pop()!;
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      if (!keep || keep.has(it.id)) descendants.push(it);
      for (const c of index.childrenOf.get(it.id) ?? []) stack.push(c);
    }

    const groups = new Map<string, Item[]>();
    for (const d of descendants) {
      const arr = groups.get(d.categoryId);
      if (arr) arr.push(d);
      else groups.set(d.categoryId, [d]);
    }

    // Leaf rows: this is a pivot, so a computer here does not re-nest its own parts —
    // those have their own cluster in the same list.
    const leaf = (m: Item, depth: number): ItemRow => ({ kind: "item", id: m.id, item: m, children: [], memberIds: [m.id], depth });

    const children: RowNode[] = [];
    for (const [categoryId, members] of groups) {
      if (members.length === 1) {
        children.push(leaf(members[0], 1));
      } else {
        children.push({
          kind: "cluster",
          id: `ru:${root.id}:${categoryId}`,
          categoryId,
          members,
          memberIds: members.map((m) => m.id),
          children: members.map((m) => leaf(m, 2)),
          depth: 1,
        });
      }
    }
    children.sort((a, b) => {
      const an = a.kind === "cluster" ? a.members.length : 1;
      const bn = b.kind === "cluster" ? b.members.length : 1;
      return bn - an;
    });

    out.push({ kind: "item", id: root.id, item: root, children, memberIds: [root.id], depth: 0 });
  }
  return out;
}

/** One leaf row per matching inventory item, with no synthetic hierarchy. */
export function buildSearchList(index: TreeIndex, keep: Set<string> | null): RowNode[] {
  return [...index.byId.values()]
    .filter((item) => !keep || keep.has(item.id))
    .map((item) => ({ kind: "item" as const, id: item.id, item, children: [], memberIds: [item.id], depth: 0 }));
}

/**
 * For each item, the set of category ids appearing anywhere in its subtree. "Which
 * computers have a GPU?" cannot be answered by looking at direct children — a GPU
 * hangs off the Motherboard, one level further down.
 */
export function descendantCategories(index: TreeIndex): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const visiting = new Set<string>();

  const visit = (id: string): Set<string> => {
    const cached = out.get(id);
    if (cached) return cached;
    if (visiting.has(id)) return new Set();
    visiting.add(id);
    const set = new Set<string>();
    for (const child of index.childrenOf.get(id) ?? []) {
      set.add(child.categoryId);
      for (const c of visit(child.id)) set.add(c);
    }
    visiting.delete(id);
    out.set(id, set);
    return set;
  };

  for (const it of index.byId.values()) visit(it.id);
  return out;
}

/** Every item id under a row, cluster members included — what a bulk action touches. */
export function subtreeIds(index: TreeIndex, rootIds: string[]): string[] {
  const out: string[] = [];
  const stack = [...rootIds];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    for (const c of index.childrenOf.get(id) ?? []) stack.push(c.id);
  }
  return out;
}

/** Ancestors outermost-first, so the inspector can offer a walkable breadcrumb. */
export function ancestorsOf(index: TreeIndex, id: string): Item[] {
  const out: Item[] = [];
  let cur = index.byId.get(id);
  const seen = new Set<string>();
  while (cur?.parentId && !seen.has(cur.id)) {
    seen.add(cur.id);
    const parent = index.byId.get(cur.parentId);
    if (!parent) break;
    out.unshift(parent);
    cur = parent;
  }
  return out;
}

export function pathOf(index: TreeIndex, id: string): string[] {
  const out: string[] = [];
  let cur = index.byId.get(id);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.unshift(cur.name);
    cur = cur.parentId ? index.byId.get(cur.parentId) : undefined;
  }
  out.pop(); // drop the item's own name — the Name column already shows it
  return out;
}

// ── Aggregation — what a cluster cell says when its members disagree ──────

export interface Agg {
  /** Distinct values with counts, most common first. */
  counts: Array<[string, number]>;
  /** The one value every member shares, or null when they differ. */
  common: string | null;
  empty: number;
}

export function aggregate(values: Array<PropValue | undefined>): Agg {
  const counts = new Map<string, number>();
  let empty = 0;
  for (const v of values) {
    if (v === null || v === undefined || v === "") {
      empty += 1;
      continue;
    }
    const key = String(v);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const common = empty === 0 && sorted.length === 1 ? sorted[0][0] : null;
  return { counts: sorted, common, empty };
}

/** "Desktop" · "23 Desktop · 2 Laptop" · "23 distinct" · "23 unset" */
export function describeAgg(agg: Agg, max = 2): string {
  if (agg.common !== null) return agg.common;
  const filled = agg.counts.reduce((a, [, n]) => a + n, 0);
  // A serial number is unique per unit by definition; listing three of them and "+21
  // more" says nothing. Report the shape of the data instead.
  if (agg.counts.length > max && agg.counts.every(([, n]) => n === 1)) {
    const parts = [`${filled} distinct`];
    if (agg.empty > 0) parts.push(`${agg.empty} unset`);
    return parts.join(" · ");
  }
  const parts = agg.counts.slice(0, max).map(([v, n]) => `${n} ${v}`);
  if (agg.counts.length > max) parts.push(`+${agg.counts.length - max} more`);
  if (agg.empty > 0) parts.push(`${agg.empty} unset`);
  return parts.join(" · ") || "—";
}

export function summaryFields(cat: Category | undefined) {
  if (!cat) return [];
  const flagged = cat.fields.filter((f) => f.summary);
  return flagged.length ? flagged : cat.fields.slice(0, 3);
}
