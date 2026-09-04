/**
 * What a pending edit would actually do — ported from temp_works/src/lib/edit-impact.ts,
 * verbatim. Turns a draft into a plain list of consequences, counted, not adjectival:
 * "3 items hold a value for this field" is a fact a person can act on; "this may
 * affect existing data" is not.
 *
 * A category edit is the dangerous one: it reaches every item of that category at
 * once, and removing a field strands the values already stored under it.
 */
import type { Category, FieldDef, Item, PropValue } from "./types";
import { subtreeIds, type TreeIndex } from "./tree";

export type ImpactSeverity = "info" | "warning" | "destructive";

export interface ImpactNote {
  id: string;
  severity: ImpactSeverity;
  title: string;
  detail: string;
  /** Property keys whose stored values would become unreachable. */
  orphanKeys?: string[];
}

const filled = (v: PropValue | undefined) => v !== null && v !== undefined && v !== "";

/** Would this stored value survive the field's new type? */
function coerces(value: PropValue, field: FieldDef): boolean {
  if (!filled(value)) return true;
  switch (field.type) {
    case "number":
      return Number.isFinite(Number(value));
    case "boolean":
      return typeof value === "boolean" || value === "true" || value === "false";
    case "enum":
      return (field.options ?? []).includes(String(value));
    default:
      return true;
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ── Tab 1 — this item's own field values ──────────────────────────────────

export function detailsImpact(item: Item, category: Category | undefined, draft: Record<string, PropValue>): ImpactNote[] {
  if (!category) return [];
  const notes: ImpactNote[] = [];
  const cleared: string[] = [];

  for (const field of category.fields) {
    const before = item.props[field.key] ?? null;
    const after = draft[field.key] ?? null;
    if (before === after) continue;
    if (filled(before) && !filled(after)) cleared.push(field.label);
  }

  if (cleared.length) {
    notes.push({
      id: "details-cleared",
      severity: "warning",
      title: `Clearing ${plural(cleared.length, "value")}`,
      detail: `${cleared.join(", ")} currently ${cleared.length === 1 ? "has" : "have"} a value that will be erased.`,
    });
  }
  return notes;
}

// ── Tab 2 — direct children ─────────────────────────────────────────────

export interface ChildPlan {
  /** Existing child ids marked for removal. */
  remove: string[];
  /** Category ids to instantiate under this item, with counts. */
  add: Array<{ categoryId: string; count: number }>;
}

export function childrenImpact(index: TreeIndex, categories: Record<string, Category>, plan: ChildPlan): ImpactNote[] {
  const notes: ImpactNote[] = [];

  if (plan.remove.length) {
    const rows = subtreeIds(index, plan.remove).length;
    const nested = rows - plan.remove.length;
    const criticals = plan.remove.filter((id) => index.byId.get(id)?.critical);
    notes.push({
      id: "children-remove",
      severity: "destructive",
      title: `Deleting ${plural(plan.remove.length, "child", "children")}`,
      detail: nested
        ? `${plural(rows, "row")} in total — the ${plural(plan.remove.length, "child", "children")} plus ${plural(nested, "nested item")} inside. This cannot be undone.`
        : `${plural(rows, "row")} in total. This cannot be undone.`,
    });
    if (criticals.length) {
      notes.push({
        id: "children-critical",
        severity: "warning",
        title: `${plural(criticals.length, "critical part")} removed`,
        detail: "The parent's condition is derived from its critical parts, so its status may change once these are gone.",
      });
    }
  }

  for (const entry of plan.add) {
    const cat = categories[entry.categoryId];
    if (!cat || entry.count < 1) continue;
    const per = templateSize(categories, entry.categoryId);
    notes.push({
      id: `children-add-${entry.categoryId}`,
      severity: "info",
      title: `Adding ${entry.count} × ${cat.name}`,
      detail: per > 1 ? `Each is scaffolded with its default parts — ${plural(entry.count * per, "new row")} in total.` : `${plural(entry.count, "new row")}.`,
    });
  }

  return notes;
}

/** How many rows one instantiation of a category produces, parts included. */
export function templateSize(categories: Record<string, Category>, id: string, depth = 0): number {
  const c = categories[id];
  if (!c || depth > 10) return 1;
  return 1 + c.defaultChildren.reduce((a, ch) => a + ch.qty * templateSize(categories, ch.categoryId, depth + 1), 0);
}

// ── Tab 3 — the category definition itself ──────────────────────────────

export function categoryImpact(before: Category, after: Category, items: Item[]): ImpactNote[] {
  const notes: ImpactNote[] = [];
  const mine = items.filter((i) => i.categoryId === before.id);
  const count = mine.length;
  const withValue = (key: string) => mine.filter((i) => filled(i.props[key])).length;

  if (count > 0) {
    notes.push({
      id: "cat-reach",
      severity: "info",
      title: `Reaches ${plural(count, "existing item")}`,
      detail: `Every item filed under ${before.name} is redefined by this edit.`,
    });
  }

  // ── Fields removed ──────────────────────────────────────────────────────
  const afterKeys = new Set(after.fields.map((f) => f.key));
  const removed = before.fields.filter((f) => !afterKeys.has(f.key));
  for (const f of removed) {
    const n = withValue(f.key);
    notes.push({
      id: `cat-field-removed-${f.key}`,
      severity: n > 0 ? "destructive" : "warning",
      title: `Removing the "${f.label}" field`,
      detail:
        n > 0
          ? `${plural(n, "item")} currently ${n === 1 ? "holds" : "hold"} a value here. The values stay in storage but nothing will show or search them again unless the field comes back.`
          : "No item holds a value for it, so nothing is lost.",
      orphanKeys: n > 0 ? [f.key] : undefined,
    });
  }

  // ── Fields added ────────────────────────────────────────────────────────
  const beforeKeys = new Set(before.fields.map((f) => f.key));
  for (const f of after.fields.filter((f) => !beforeKeys.has(f.key))) {
    notes.push({
      id: `cat-field-added-${f.key}`,
      severity: "info",
      title: `Adding the "${f.label || f.key}" field`,
      detail: count ? `It starts empty on all ${plural(count, "existing item")}.` : "No existing items to fill in.",
    });

    // A NEW category field can collide with an existing item-specific custom property
    // of the same name (lib/server/resources/custom-props.ts's own concept) — they are
    // stored in different places, so this add does not overwrite anything, but the
    // same key now means two different things on the item and that is worth surfacing
    // rather than leaving silent. Compared normalized (case/punctuation-insensitive),
    // same rule custom-props.ts's own collision check uses at creation time.
    const norm = normalizeForCollision(f.key);
    const colliding = mine.filter((i) => Object.keys(i.customProps ?? {}).some((k) => normalizeForCollision(k) === norm));
    if (colliding.length) {
      notes.push({
        id: `cat-field-custom-collision-${f.key}`,
        severity: "warning",
        title: `"${f.label || f.key}" already exists as a custom property on ${plural(colliding.length, "item")}`,
        detail: `Those items keep their own custom value under that name, separate from this new field — the two will show side by side, not merged, which may read as duplicated or confusing.`,
      });
    }
  }

  // ── Type / option changes on kept fields ───────────────────────────────
  for (const next of after.fields) {
    const prev = before.fields.find((f) => f.key === next.key);
    if (!prev) continue;

    if (prev.type !== next.type) {
      const bad = mine.filter((i) => filled(i.props[next.key]) && !coerces(i.props[next.key], next)).length;
      notes.push({
        id: `cat-field-type-${next.key}`,
        severity: bad > 0 ? "destructive" : "warning",
        title: `"${next.label}" changes from ${prev.type} to ${next.type}`,
        detail: bad > 0 ? `${plural(bad, "stored value")} cannot be read as ${next.type} and will no longer display.` : "Every stored value survives the change.",
      });
    }

    if (prev.type === "enum" && next.type === "enum") {
      const gone = (prev.options ?? []).filter((o) => !(next.options ?? []).includes(o));
      for (const option of gone) {
        const n = mine.filter((i) => String(i.props[next.key]) === option).length;
        if (n === 0) continue;
        notes.push({
          id: `cat-option-${next.key}-${option}`,
          severity: "destructive",
          title: `Dropping the "${option}" choice from ${next.label}`,
          detail: `${plural(n, "item")} ${n === 1 ? "is" : "are"} set to it and will show an invalid value.`,
        });
      }
    }
  }

  // ── Counting mode ───────────────────────────────────────────────────────
  if (before.countingMode !== after.countingMode) {
    notes.push({
      id: "cat-counting",
      severity: count > 0 ? "destructive" : "warning",
      title: `Counted as ${after.countingMode === "BULK" ? "a quantity" : "individual units"} instead`,
      detail:
        after.countingMode === "SERIALIZED"
          ? `Quantities already recorded on ${plural(count, "item")} stop being meaningful — each row becomes one unit.`
          : `${plural(count, "item")} that ${count === 1 ? "was" : "were"} one unit each now carries a quantity, starting from whatever is stored.`,
    });
  }

  // ── Default subtree — future instantiation only ────────────────────────
  const beforeParts = new Map(before.defaultChildren.map((c) => [c.categoryId, c]));
  const afterParts = new Map(after.defaultChildren.map((c) => [c.categoryId, c]));
  for (const [catId, part] of beforeParts) {
    if (afterParts.has(catId)) continue;
    notes.push({
      id: `cat-part-removed-${catId}`,
      severity: "info",
      title: `No longer built with ${part.qty} × ${nameOf(catId, after, before)}`,
      detail: `Existing items keep the parts they already have — this only changes what gets scaffolded next time.`,
    });
  }
  for (const [catId, part] of afterParts) {
    if (beforeParts.has(catId)) continue;
    notes.push({
      id: `cat-part-added-${catId}`,
      severity: "info",
      title: `Now built with ${part.qty} × ${nameOf(catId, after, before)}`,
      detail: count ? `${plural(count, "existing item")} ${count === 1 ? "does" : "do"} not gain this retroactively — add it per item from the Children tab.` : "Applies to items created from now on.",
    });
  }

  // ── Critical flags on parts ─────────────────────────────────────────────
  for (const [catId, part] of afterParts) {
    const prev = beforeParts.get(catId);
    if (!prev || prev.critical === part.critical) continue;
    notes.push({
      id: `cat-part-critical-${catId}`,
      severity: "info",
      title: `${nameOf(catId, after, before)} is ${part.critical ? "now critical" : "no longer critical"}`,
      detail: "Only newly created items pick this up; existing parts keep the flag they were built with.",
    });
  }

  if (before.impairRule !== after.impairRule) {
    notes.push({
      id: "cat-impair",
      severity: "warning",
      title: `Failure rule changes to ${after.impairRule.replace("_", " ").toLowerCase()}`,
      detail: `Condition is derived, so the displayed status of ${plural(count, "item")} may change the moment this is applied.`,
    });
  }

  if (before.name !== after.name) {
    notes.push({
      id: "cat-name",
      severity: "info",
      title: `Renamed to "${after.name}"`,
      detail: `${plural(count, "item")} will show the new name.`,
    });
  }

  return notes;
}

/** Mirrors lib/server/resources/custom-props.ts's own `normalizeKey` — duplicated
 *  rather than imported so this stays pure domain code with no dependency on
 *  lib/server/**, exactly the same tradeoff made everywhere else a small pure helper
 *  would otherwise cross that boundary. */
function normalizeForCollision(key: string): string {
  return key.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function nameOf(catId: string, ...sources: Category[]): string {
  for (const s of sources) if (s.id === catId) return s.name;
  return catId;
}

export const SEVERITY_ORDER: Record<ImpactSeverity, number> = {
  destructive: 0,
  warning: 1,
  info: 2,
};

export function sortImpact(notes: ImpactNote[]): ImpactNote[] {
  return [...notes].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export function worstSeverity(notes: ImpactNote[]): ImpactSeverity | null {
  if (notes.some((n) => n.severity === "destructive")) return "destructive";
  if (notes.some((n) => n.severity === "warning")) return "warning";
  return notes.length ? "info" : null;
}
