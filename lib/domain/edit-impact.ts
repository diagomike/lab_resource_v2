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
import { convertValue } from "./field-migration";

export type ImpactSeverity = "info" | "warning" | "destructive";

export interface ImpactNote {
  id: string;
  severity: ImpactSeverity;
  title: string;
  detail: string;
  /** Details whose values leave the detail (kept on each item as an extra detail, or
   *  erased if the editor chooses) — what the "erase instead" choice covers. */
  orphanKeys?: string[];
  /** A few of the values concerned: “B528-RG16” on Software Lab 8. */
  examples?: string[];
  /** A choice being removed while items use it: the editor picks where its values go. */
  optionMove?: { key: string; label: string; option: string; count: number };
  /** A detail becoming required while items lack it: the editor may fill them. */
  fill?: { key: string; label: string; count: number };
}

const filled = (v: PropValue | undefined) => v !== null && v !== undefined && v !== "";

/** Would this stored value survive the field's new type (lib/domain/field-migration.ts)? */
export function coerces(value: PropValue, field: FieldDef, from?: FieldDef): boolean {
  return convertValue(value, field, from).ok;
}

const example = (i: Item, v: PropValue | undefined) => `“${String(v)}” on ${i.name}`;

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
        ? `${plural(rows, "row")} in total: the ${plural(plan.remove.length, "child", "children")} plus ${plural(nested, "nested item")} inside. This cannot be undone.`
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
      detail: per > 1 ? `Each is scaffolded with its default parts: ${plural(entry.count * per, "new row")} in total.` : `${plural(entry.count, "new row")}.`,
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

/** F-029: making a field required never edits existing rows — it only applies to items created
 *  from now on — so say plainly how many current items are already out of step with it. */
function requiredGapNote(f: { key: string; label: string }, lacking: number): ImpactNote {
  return {
    id: `cat-field-required-${f.key}`,
    severity: "warning",
    title: `“${f.label || f.key}” becomes required: ${plural(lacking, "existing item")} ${lacking === 1 ? "has" : "have"} none`,
    detail: "Fill them in now with one value, or leave them blank: they are asked for it on their next edit. Imports and automatic parts are never blocked.",
    fill: { key: f.key, label: f.label || f.key, count: lacking },
  };
}

const TYPE_WORD: Record<FieldDef["type"], string> = { text: "text", number: "a number", enum: "a choice", boolean: "yes/no", date: "a date" };

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
    const holders = mine.filter((i) => filled(i.props[f.key]));
    const n = holders.length;
    notes.push({
      id: `cat-field-removed-${f.key}`,
      severity: "warning",
      title: `Removing “${f.label}”`,
      detail:
        n > 0
          ? `${plural(n, "item")} ${n === 1 ? "has" : "have"} a value here. Each keeps it as an extra detail (“Earlier ${f.label}”), unless you choose to erase them.`
          : "No item has a value for it, so nothing is lost.",
      orphanKeys: n > 0 ? [f.key] : undefined,
      examples: holders.slice(0, 3).map((i) => example(i, i.props[f.key])),
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
    if (f.required && count > 0) notes.push(requiredGapNote(f, count));

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
        detail: `Those items keep their own custom value under that name, separate from this new field. The two will show side by side, not merged, which may read as duplicated or confusing.`,
      });
    }
  }

  // ── Type / option changes on kept fields ───────────────────────────────
  for (const next of after.fields) {
    const prev = before.fields.find((f) => f.key === next.key);
    if (!prev) continue;

    if (next.required && !prev.required) {
      const lacking = mine.filter((i) => !filled(i.props[next.key])).length;
      if (lacking > 0) notes.push(requiredGapNote(next, lacking));
    }

    if (prev.label.trim() !== next.label.trim()) {
      const n = withValue(next.key);
      if (n > 0) {
        notes.push({
          id: `cat-field-renamed-${next.key}`,
          severity: "warning",
          title: `“${prev.label}” is renamed “${next.label}”`,
          detail: `The ${plural(n, "value")} already recorded now read as “${next.label}”. If “${next.label}” is a different detail, go back and add it as a new one instead.`,
          examples: mine.filter((i) => filled(i.props[next.key])).slice(0, 3).map((i) => example(i, i.props[next.key])),
        });
      }
    }

    if (prev.type !== next.type) {
      const holders = mine.filter((i) => filled(i.props[next.key]));
      const bad = holders.filter((i) => !coerces(i.props[next.key], next, prev));
      const word = TYPE_WORD[next.type];
      notes.push({
        id: `cat-field-type-${next.key}`,
        severity: "warning",
        title: `“${next.label}” changes from ${TYPE_WORD[prev.type]} to ${word}`,
        detail: !holders.length
          ? "No item has a value for it yet."
          : bad.length
            ? `${plural(holders.length - bad.length, "value")} convert. ${plural(bad.length, "value")} can't be read as ${word}: each stays on its item as an extra detail (“Earlier ${next.label}”), unless you choose to erase them.`
            : `All ${plural(holders.length, "value")} convert.`,
        orphanKeys: bad.length ? [next.key] : undefined,
        examples: bad.slice(0, 3).map((i) => example(i, i.props[next.key])),
      });
    }

    if (prev.type === "enum" && next.type === "enum") {
      const gone = (prev.options ?? []).filter((o) => !(next.options ?? []).includes(o));
      for (const option of gone) {
        const n = mine.filter((i) => String(i.props[next.key]) === option).length;
        if (n === 0) continue;
        notes.push({
          id: `cat-option-${next.key}-${option}`,
          severity: "warning",
          title: `Removing the choice “${option}” from ${next.label}`,
          detail: `${plural(n, "item")} ${n === 1 ? "is" : "are"} set to it. Choose the option they move to, or keep it on each as an extra detail.`,
          optionMove: { key: next.key, label: next.label, option, count: n },
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
          ? `Quantities already recorded on ${plural(count, "item")} stop being meaningful. Each row becomes one unit.`
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
      detail: `Existing items keep the parts they already have. This only changes what gets scaffolded next time.`,
    });
  }
  for (const [catId, part] of afterParts) {
    if (beforeParts.has(catId)) continue;
    notes.push({
      id: `cat-part-added-${catId}`,
      severity: "info",
      title: `Now built with ${part.qty} × ${nameOf(catId, after, before)}`,
      detail: count ? `${plural(count, "existing item")} ${count === 1 ? "does" : "do"} not gain this retroactively. Add it per item from the Children tab.` : "Applies to items created from now on.",
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
