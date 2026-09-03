/**
 * One filter engine, three consumers: the toolbar's faceted popovers, the advanced
 * builder, and the dashboard's charts. A chart segment click and a popover tick
 * produce the identical rule, which is why a filter arrived at from a chart can be
 * removed in the advanced builder. Ported from temp_works/src/lib/filters.ts,
 * verbatim except one signature change (see `buildFilterFields`'s note below).
 *
 * The operator names were deliberately kept matching lib_resource_v2's now-deleted
 * `components/data-table` engine's own (its `types.ts`) rather than shorter ones
 * invented here — see lib/shared/resources/item-filter.ts's own note on the two
 * engines' planned merge. Phase 6 of ~/.claude/plans/wait-i-want-gentle-haven.md
 * wired the register's filter bar to this module directly (via items.ts's
 * `ItemQuery`) using only the operators both vocabularies already share; the fuller
 * merge (prop:/desc: synthetic fields, the wider operator set) is still open.
 *
 * Two things stay different from that engine, on purpose: a rule carries its own
 * `id` (several rules can target one field — storage ≥500 AND ≤1000 — and the facet
 * counter needs to relax exactly one), and a rule holds `values: string[]` rather
 * than a URL-shaped `string | string[]`, since nothing here is serialised into a
 * query string.
 */
import { newId } from "./instantiate";
import { statusOf, type StatusInfo } from "./status";
import type { TreeIndex } from "./tree";
import type { Category, EffectiveStatus, Item, OrgNode, Person } from "./types";

export type FilterOp = "inArray" | "notInArray" | "contains" | "gte" | "lte" | "isEmpty" | "isNotEmpty";

/** Operators that need no value — they ask about presence. */
export const VALUELESS_OPS: FilterOp[] = ["isEmpty", "isNotEmpty"];

export interface FilterRule {
  id: string;
  field: string;
  op: FilterOp;
  values: string[];
}

export interface FilterState {
  search: string;
  join: "and" | "or";
  rules: FilterRule[];
}

export const EMPTY_FILTERS: FilterState = { search: "", join: "and", rules: [] };

export interface FilterFieldDef {
  id: string;
  label: string;
  kind: "enum" | "text" | "number";
  group: string;
  options?: Array<{ value: string; label: string }>;
  unit?: string;
}

export interface FilterCtx {
  statuses: Map<string, StatusInfo>;
  descCats: Map<string, Set<string>>;
  categories: Record<string, Category>;
  /** Needed to reach an item's parts (descendant props) and its place (root). */
  index: TreeIndex;
}

/** Category ids reachable through a category's default subtree — its "parts". */
function partCategoryIds(categories: Record<string, Category>, catId: string, out = new Set<string>(), depth = 0): Set<string> {
  const c = categories[catId];
  if (!c || depth > 8) return out;
  for (const ch of c.defaultChildren) {
    if (out.has(ch.categoryId)) continue;
    out.add(ch.categoryId);
    partCategoryIds(categories, ch.categoryId, out, depth + 1);
  }
  return out;
}

export const OP_LABEL: Record<FilterOp, string> = {
  inArray: "is any of",
  notInArray: "is none of",
  contains: "contains text",
  gte: "at least",
  lte: "at most",
  isEmpty: "is blank",
  isNotEmpty: "is filled in",
};

/** The operators that make sense for a field, in the order a person would want them. */
export function opsFor(kind: FilterFieldDef["kind"]): FilterOp[] {
  if (kind === "number") return ["gte", "lte", "inArray", "isEmpty", "isNotEmpty"];
  if (kind === "enum") return ["inArray", "notInArray", "isEmpty", "isNotEmpty"];
  return ["contains", "inArray", "isEmpty", "isNotEmpty"];
}

/**
 * The fields you can filter on. Props appear only for a category actually in play.
 *
 * `orgNodes`/`people` are REQUIRED here, unlike temp_works' own signature (which
 * defaulted them to its seed module's ORG_NODES/PEOPLE) — production has no fixture
 * to silently fall back to; the server always passes the real org chart and register.
 */
export function buildFilterFields(
  categories: Record<string, Category>,
  activeCategoryIds: string[],
  places: Item[],
  orgNodes: OrgNode[],
  people: Pick<Person, "id" | "name">[],
): FilterFieldDef[] {
  // Only units that can actually hold a resource. A college owns nothing directly —
  // its departments do — so offering it as an "owned by" value would return nothing.
  const orgOptions = orgNodes.filter((n) => n.active && (n.kind === "DEPARTMENT" || n.kind === "OFFICE")).map((n) => ({ value: n.id, label: n.name }));
  const fields: FilterFieldDef[] = [
    {
      id: "status",
      label: "Status",
      kind: "enum",
      group: "Core",
      options: (["WORKING", "IMPAIRED", "BROKEN", "UNDER_MAINTENANCE", "LOST", "CONSUMED"] as EffectiveStatus[]).map((s) => ({
        value: s,
        label: s,
      })),
    },
    {
      id: "category",
      label: "Category",
      kind: "enum",
      group: "Core",
      options: Object.values(categories)
        .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name))
        .map((c) => ({ value: c.id, label: c.name })),
    },
    { id: "owner", label: "Owning unit", kind: "enum", group: "Core", options: orgOptions },
    { id: "currentOrg", label: "Current holding unit", kind: "enum", group: "Core", options: orgOptions },
    { id: "custodian", label: "Custodian", kind: "enum", group: "Core", options: people.map((p) => ({ value: p.id, label: p.name })) },
    { id: "location", label: "Lab / location", kind: "enum", group: "Core", options: places.map((p) => ({ value: p.id, label: p.name })) },
    {
      id: "contains",
      label: "Contains (any depth)",
      kind: "enum",
      group: "Structure",
      options: Object.values(categories)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => ({ value: c.id, label: c.name })),
    },
  ];

  for (const catId of activeCategoryIds) {
    const cat = categories[catId];
    if (!cat) continue;

    for (const f of cat.fields) {
      fields.push({
        id: `prop:${catId}:${f.key}`,
        label: `${cat.name} · ${f.label}`,
        kind: f.type === "number" ? "number" : f.type === "enum" ? "enum" : "text",
        group: cat.name,
        unit: f.unit,
        options: f.options?.map((o) => ({ value: o, label: o })),
      });
    }

    // Fields of the things this category is MADE OF. A computer's disk size lives on
    // its Storage child, so "computers with a 500 GB+ disk" is unanswerable without
    // reaching down the tree — this is what makes that query possible.
    for (const partId of partCategoryIds(categories, catId)) {
      const part = categories[partId];
      if (!part?.fields.length) continue;
      for (const f of part.fields) {
        fields.push({
          id: `desc:${partId}:${f.key}`,
          label: `${part.name} · ${f.label}`,
          kind: f.type === "number" ? "number" : f.type === "enum" ? "enum" : "text",
          group: `${cat.name} parts`,
          unit: f.unit,
          options: f.options?.map((o) => ({ value: o, label: o })),
        });
      }
    }
  }
  return fields;
}

/** The place an item sits in — its outermost ancestor. */
export function placeOf(index: TreeIndex, item: Item): Item {
  let cur = item;
  const seen = new Set<string>();
  while (cur.parentId && !seen.has(cur.id)) {
    seen.add(cur.id);
    const p = index.byId.get(cur.parentId);
    if (!p) break;
    cur = p;
  }
  return cur;
}

/** Values of one prop across every descendant of a given category. */
function descendantPropValues(index: TreeIndex, itemId: string, catId: string, key: string): string[] {
  const out: string[] = [];
  const stack = [...(index.childrenOf.get(itemId) ?? [])];
  const seen = new Set<string>();
  while (stack.length) {
    const it = stack.pop()!;
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    if (it.categoryId === catId) {
      const v = it.props[key];
      if (v !== null && v !== undefined && v !== "") out.push(String(v));
    }
    for (const c of index.childrenOf.get(it.id) ?? []) stack.push(c);
  }
  return out;
}

function valuesFor(item: Item, fieldId: string, ctx: FilterCtx): string[] {
  if (fieldId === "status") return [statusOf(ctx.statuses, item.id)];
  if (fieldId === "category") return [item.categoryId];
  if (fieldId === "owner") return item.ownerOrgNodeId ? [item.ownerOrgNodeId] : [];
  if (fieldId === "currentOrg") {
    // A never-lent item's current unit answers as its owner rather than as blank —
    // otherwise filtering by current unit would lose every item that has never
    // moved. currentOrgNodeId is NOT NULL in this schema, so it is always its own
    // fallback; the `?? item.ownerOrgNodeId` temp_works needed for its nullable pair
    // is dead code here, kept only as a defensive no-op.
    const value = item.currentOrgNodeId ?? item.ownerOrgNodeId;
    return value ? [value] : [];
  }
  if (fieldId === "custodian") return item.custodianId ? [item.custodianId] : [];
  if (fieldId === "location") return [placeOf(ctx.index, item).id];
  if (fieldId === "contains") return [...(ctx.descCats.get(item.id) ?? [])];
  if (fieldId.startsWith("prop:")) {
    const [, catId, key] = fieldId.split(":");
    if (item.categoryId !== catId) return [];
    const v = item.props[key];
    return v === null || v === undefined || v === "" ? [] : [String(v)];
  }
  if (fieldId.startsWith("desc:")) {
    const [, catId, key] = fieldId.split(":");
    return descendantPropValues(ctx.index, item.id, catId, key);
  }
  return [];
}

/** Public accessor — the dashboard groups by the same fields the filters use. */
export function fieldValues(item: Item, fieldId: string, ctx: FilterCtx): string[] {
  return valuesFor(item, fieldId, ctx);
}

/** The active query, written out the way a person would say it. */
export function describeFilters(state: FilterState, fields: FilterFieldDef[]): string[] {
  const byId = Object.fromEntries(fields.map((f) => [f.id, f]));
  const out: string[] = [];
  if (state.search.trim()) out.push(`matching "${state.search.trim()}"`);
  for (const r of state.rules) {
    const f = byId[r.field];
    if (!f) continue;
    if (VALUELESS_OPS.includes(r.op)) {
      out.push(`${f.label} ${r.op === "isEmpty" ? "is blank" : "is filled in"}`);
      continue;
    }
    if (!r.values.length) continue;
    const labels = r.values.map((v) => f.options?.find((o) => o.value === v)?.label ?? v);
    const verb = r.op === "inArray" ? "is" : r.op === "notInArray" ? "is not" : r.op === "contains" ? "contains" : r.op === "gte" ? "≥" : "≤";
    out.push(`${f.label} ${verb} ${labels.join(" or ")}${f.unit ? ` ${f.unit}` : ""}`);
  }
  return out;
}

/** A rule with nothing to match on is treated as absent rather than as "match none". */
function ruleIsLive(rule: FilterRule): boolean {
  return VALUELESS_OPS.includes(rule.op) || rule.values.some((v) => v !== "");
}

function matchRule(item: Item, rule: FilterRule, ctx: FilterCtx): boolean {
  const actual = valuesFor(item, rule.field, ctx);

  switch (rule.op) {
    case "isEmpty":
      return actual.length === 0;
    case "isNotEmpty":
      return actual.length > 0;
    case "inArray":
      return actual.some((a) => rule.values.includes(a));
    case "notInArray":
      // An item with no value for the field is not excluded by "is none of".
      return !actual.some((a) => rule.values.includes(a));
    case "contains": {
      const needle = rule.values[0].toLowerCase();
      return actual.some((a) => a.toLowerCase().includes(needle));
    }
    case "gte":
      return actual.some((a) => Number(a) >= Number(rule.values[0]));
    case "lte":
      return actual.some((a) => Number(a) <= Number(rule.values[0]));
  }
}

function matchSearch(item: Item, search: string, ctx: FilterCtx): boolean {
  const text = search.trim().toLowerCase();
  if (!text) return true;
  const hay = [item.name, ctx.categories[item.categoryId]?.name ?? "", ...Object.values(item.props).map((v) => (v == null ? "" : String(v)))]
    .join(" ")
    .toLowerCase();
  return hay.includes(text);
}

export function matchItems(
  items: Item[],
  state: FilterState,
  ctx: FilterCtx,
  /** Ignore one rule, so a facet can count what WOULD match if it were relaxed. */
  ignoreRuleId?: string,
): Set<string> {
  const rules = state.rules.filter((r) => r.id !== ignoreRuleId && ruleIsLive(r));
  const out = new Set<string>();
  for (const it of items) {
    if (!matchSearch(it, state.search, ctx)) continue;
    if (rules.length) {
      const results = rules.map((r) => matchRule(it, r, ctx));
      const ok = state.join === "and" ? results.every(Boolean) : results.some(Boolean);
      if (!ok) continue;
    }
    out.add(it.id);
  }
  return out;
}

/** Counts for one field's options, with that field's own rule relaxed. */
export function facetCounts(items: Item[], state: FilterState, ctx: FilterCtx, field: FilterFieldDef, ruleId?: string): Map<string, number> {
  const base = matchItems(items, state, ctx, ruleId);
  const counts = new Map<string, number>();
  const byId = new Map(items.map((it) => [it.id, it]));
  for (const id of base) {
    const it = byId.get(id);
    if (!it) continue;
    for (const v of valuesFor(it, field.id, ctx)) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return counts;
}

export function isActive(state: FilterState): boolean {
  return state.search.trim() !== "" || state.rules.some(ruleIsLive);
}

export function ruleCount(state: FilterState): number {
  return state.rules.filter(ruleIsLive).length;
}

export function newRule(field: string, values: string[] = []): FilterRule {
  return { id: newId("f"), field, op: "inArray", values };
}

/**
 * Toggling one value of one field — what a dashboard chart segment and a facet
 * checkbox both do. Creates the rule if it does not exist and drops it when its last
 * value is removed, so the toolbar never accumulates empty chips.
 */
export function toggleValue(state: FilterState, field: string, value: string): FilterState {
  const existing = state.rules.find((r) => r.field === field && r.op === "inArray");
  if (!existing) {
    return { ...state, rules: [...state.rules, newRule(field, [value])] };
  }
  const has = existing.values.includes(value);
  const values = has ? existing.values.filter((v) => v !== value) : [...existing.values, value];
  if (!values.length) {
    return { ...state, rules: state.rules.filter((r) => r.id !== existing.id) };
  }
  return { ...state, rules: state.rules.map((r) => (r.id === existing.id ? { ...r, values } : r)) };
}

export function hasValue(state: FilterState, field: string, value: string) {
  return state.rules.some((r) => r.field === field && r.op === "inArray" && r.values.includes(value));
}

/** Categories currently constrained, which is what unlocks per-category prop fields. */
export function activeCategories(state: FilterState): string[] {
  const rule = state.rules.find((r) => r.field === "category" && r.op === "inArray");
  return rule?.values ?? [];
}
