/**
 * What happens to the values items already hold when their category's details change.
 * A value is converted to the detail's new type when it can be ("16 GB" → 16), and
 * otherwise kept on its item as an extra detail ("Earlier Room": "B528-RG16") or, only
 * when the editor chose to, erased. Nothing is ever stranded where no screen shows it.
 *
 * Pure: categories.ts runs `planCategoryMigration` inside the edit's transaction, and
 * the impact preview runs it to say, value by value, what will happen.
 */
import type { Category, CustomProp, CustomPropType, FieldDef, Item, PropValue } from "./types";

export type Converted = { ok: true; value: PropValue } | { ok: false };

const ok = (value: PropValue): Converted => ({ ok: true, value });
const no: Converted = { ok: false };

export const filled = (v: PropValue | undefined): v is string | number | boolean => v !== null && v !== undefined && v !== "";

/** "16", "16 GB", "1,200", "-3.5 °C": a number, optionally followed by a unit. */
const NUMBER_RE = /^([-+]?\d+(?:\.\d+)?)\s*([A-Za-zµ°%][A-Za-z0-9µ°%/.²³]*)?$/;

/** A real calendar date, as "YYYY-MM-DD" — the only form a Date detail stores. */
export function isoDate(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Reads "2027-03-01", "2027-03-01T…" and "1/3/2027" (day first, as written at ASTU). */
export function parseDate(value: string): string | null {
  const s = value.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  if (iso) return isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const dmy = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(s);
  if (dmy) return isoDate(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
  return null;
}

/** As text, the way a person would read the value (a number keeps its unit). */
function asText(value: string | number | boolean, from?: FieldDef): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number" && from?.unit) return `${value} ${from.unit}`;
  return String(value);
}

/** Can this stored value be read as the detail's (new) type — and as what? */
export function convertValue(value: PropValue | undefined, to: FieldDef, from?: FieldDef): Converted {
  if (!filled(value)) return ok(null);
  switch (to.type) {
    case "text":
      return ok(asText(value, from));
    case "number": {
      if (typeof value === "number") return Number.isFinite(value) ? ok(value) : no;
      if (typeof value === "boolean") return no;
      const m = NUMBER_RE.exec(value.trim().replace(/(\d),(?=\d{3}(?!\d))/g, "$1"));
      return m ? ok(Number(m[1])) : no;
    }
    case "boolean": {
      if (typeof value === "boolean") return ok(value);
      const s = String(value).trim().toLowerCase();
      if (["yes", "y", "true", "1"].includes(s)) return ok(true);
      if (["no", "n", "false", "0"].includes(s)) return ok(false);
      return no;
    }
    case "enum": {
      const s = asText(value, from).trim().toLowerCase();
      const hit = (to.options ?? []).find((o) => o.trim().toLowerCase() === s) ?? (to.options ?? []).find((o) => o.trim().toLowerCase() === String(value).trim().toLowerCase());
      return hit ? ok(hit) : no;
    }
    case "date": {
      if (typeof value !== "string") return no;
      const d = parseDate(value);
      return d ? ok(d) : no;
    }
    default:
      return no;
  }
}

/** The distinct values items hold for one detail — what a new Choice detail's options
 *  start from when a text detail becomes a choice. */
export function distinctValues(items: Item[], key: string, from?: FieldDef, limit = 40): string[] {
  const seen = new Map<string, string>();
  for (const i of items) {
    const v = i.props[key];
    if (!filled(v)) continue;
    const text = asText(v, from).trim();
    if (text && !seen.has(text.toLowerCase())) seen.set(text.toLowerCase(), text);
    if (seen.size >= limit) break;
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export interface MigrationChoices {
  /** Details whose leftover values (unreadable as the new type, a removed choice, or a
   *  removed detail) are erased instead of kept as an extra detail. */
  erase?: string[];
  /** A value to fill into every item that has none, by detail key — for a detail that
   *  becomes required. Already validated against the detail's type by the caller. */
  fills?: Record<string, PropValue>;
  /** Where the values of a removed choice go, by detail key then old option: one of the
   *  remaining options, or null to keep it as an extra detail. */
  optionMoves?: Record<string, Record<string, string | null>>;
}

export interface Leftover {
  key: string;
  label: string;
  itemId: string;
  itemName: string;
  value: string | number | boolean;
  reason: "type" | "removed" | "option";
  /** The extra detail it is kept under; absent when erased. */
  keptAs?: string;
}

export interface ItemMigration {
  itemId: string;
  props: Record<string, PropValue>;
  customProps: Record<string, CustomProp>;
}

export interface MigrationPlan {
  /** Only the items that change. */
  items: ItemMigration[];
  converted: number;
  filled: number;
  kept: Leftover[];
  erased: Leftover[];
}

/** Letters, digits, spaces, - and _ (lib/shared CUSTOM_PROP_KEY_PATTERN), ≤ 50 chars. */
function extraDetailName(label: string, taken: string[]): string {
  const clean = `Earlier ${label}`.replace(/[^A-Za-z0-9 _-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 46).trim();
  const norm = (k: string) => k.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  const used = new Set(taken.map(norm));
  if (!used.has(norm(clean))) return clean;
  for (let n = 2; ; n++) if (!used.has(norm(`${clean} ${n}`))) return `${clean} ${n}`;
}

const customTypeOf = (v: string | number | boolean): CustomPropType => (typeof v === "number" ? "NUMBER" : typeof v === "boolean" ? "BOOLEAN" : "TEXT");

/**
 * Every item of the category, walked once against the before/after definitions.
 * Details are matched by key — the key is a detail's identity, its label only a name.
 */
export function planCategoryMigration(before: Category, after: Category, items: Item[], choices: MigrationChoices = {}): MigrationPlan {
  const erase = new Set(choices.erase ?? []);
  const nextByKey = new Map(after.fields.map((f) => [f.key, f]));
  const plan: MigrationPlan = { items: [], converted: 0, filled: 0, kept: [], erased: [] };

  for (const item of items) {
    if (item.categoryId !== before.id) continue;
    const props = { ...item.props };
    const customProps = { ...(item.customProps ?? {}) };
    let changed = false;

    const leave = (f: FieldDef, value: string | number | boolean, reason: Leftover["reason"]) => {
      delete props[f.key];
      changed = true;
      const base = { key: f.key, label: f.label, itemId: item.id, itemName: item.name, value, reason };
      if (erase.has(f.key)) {
        plan.erased.push(base);
        return;
      }
      const name = extraDetailName(f.label, [...Object.keys(customProps), ...after.fields.map((x) => x.key)]);
      customProps[name] = { type: customTypeOf(value), value };
      plan.kept.push({ ...base, keptAs: name });
    };

    for (const prev of before.fields) {
      const value = props[prev.key];
      if (!filled(value)) continue;
      const next = nextByKey.get(prev.key);
      if (!next) {
        leave(prev, value, "removed");
        continue;
      }
      if (prev.type === next.type && next.type !== "enum") continue;
      if (prev.type === "enum" && next.type === "enum") {
        if ((next.options ?? []).includes(String(value))) continue;
        const moved = choices.optionMoves?.[prev.key]?.[String(value)];
        if (moved && (next.options ?? []).includes(moved)) {
          props[prev.key] = moved;
          plan.converted++;
          changed = true;
        } else {
          leave(prev, value, "option");
        }
        continue;
      }
      const r = convertValue(value, next, prev);
      if (r.ok) {
        if (r.value !== value) {
          props[prev.key] = r.value;
          changed = true;
        }
        plan.converted++;
      } else {
        leave(prev, value, "type");
      }
    }

    for (const [key, fill] of Object.entries(choices.fills ?? {})) {
      if (!nextByKey.has(key) || !filled(fill) || filled(props[key])) continue;
      props[key] = fill;
      plan.filled++;
      changed = true;
    }

    if (changed) plan.items.push({ itemId: item.id, props, customProps });
  }
  return plan;
}

/** A stable storage key for a detail, from its label: "Serial no." → "serial_no", made
 *  unique against the keys already taken ("room", "room_2"). Never shown to anyone. */
export function fieldKeyFor(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base =
    label
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "detail";
  const start = /^[a-z]/.test(base) ? base : `d_${base}`;
  if (!used.has(start)) return start;
  for (let n = 2; ; n++) if (!used.has(`${start}_${n}`)) return `${start}_${n}`;
}

/** A category's stable key, from its name: "Chemicals and Reagents" →
 *  "chemicals-and-reagents" (lowercase, digits, -; 2–41 chars; starts with a letter). */
export function categoryKeyFor(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  let base = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36)
    .replace(/-+$/g, "");
  if (!/^[a-z]/.test(base)) base = `c-${base}`.replace(/-+$/g, "");
  if (base.length < 2) base = "category";
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}
