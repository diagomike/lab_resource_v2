import { RELATIVE_PRESETS, type RelativePreset } from "./config";
import type {
  DataTableColumn,
  FilterOperator,
  FilterValue,
  FilterVariant,
  JoinOperator,
  TableFilter,
} from "./types";

/**
 * Every predicate the table can evaluate, as pure functions over plain values.
 *
 * The original DataTable smuggled its filters into @tanstack/react-table through closures
 * over component state and poked `setFilterValue` with a sentinel just to force a
 * recompute. That blocked TanStack's faceted row models and made two filters on one column
 * impossible. Here the rows are filtered BEFORE react-table sees them, so `and`/`or`,
 * duplicate-column filters and honest facet counts all fall out for free — and the whole
 * operator matrix is testable without rendering anything.
 */

// ---------------------------------------------------------------- value coercion

/** Renders whatever a `cell` returned as searchable text. Only plain strings/numbers
 *  survive; a node contributes nothing, which is why a column with a rich cell should
 *  supply `value` (or the legacy `accessor`). */
export function stringifyNode(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  return "";
}

export function toText(raw: FilterValue): string {
  if (raw == null) return "";
  if (Array.isArray(raw)) return raw.join(" ");
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? "" : raw.toISOString();
  return String(raw);
}

export function toNumber(raw: FilterValue): number {
  if (raw == null || raw === "") return Number.NaN;
  if (typeof raw === "number") return raw;
  if (typeof raw === "boolean") return Number.NaN;
  if (raw instanceof Date) return raw.getTime();
  if (Array.isArray(raw)) return Number.NaN;
  // Tolerates "1,250" and "ETB 1,250" — several columns hand back an already-grouped
  // string, and refusing to parse those would silently make the filter never match.
  const cleaned = String(raw).replace(/[^0-9.+-]/g, "");
  return cleaned === "" ? Number.NaN : Number(cleaned);
}

export function toArray(raw: FilterValue): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.filter((v) => v != null && v !== "").map(String);
  const text = toText(raw).trim();
  return text ? [text] : [];
}

export function toBoolean(raw: FilterValue): boolean | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw !== 0;
  const text = String(raw).toLowerCase();
  if (text === "true" || text === "yes" || text === "1") return true;
  if (text === "false" || text === "no" || text === "0") return false;
  return null;
}

/** Start of the local calendar day containing `raw`, or NaN if it is not a date at all. */
export function dayStart(raw: FilterValue): number {
  if (raw == null || raw === "") return Number.NaN;
  const d = raw instanceof Date ? new Date(raw.getTime()) : new Date(String(raw));
  if (Number.isNaN(d.getTime())) return Number.NaN;
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Last millisecond of that same local day. Every upper bound in this file goes through
 *  here — anchoring a range's "to" at midnight-start is exactly the bug PeriodReportPage
 *  hit in Phase 4 (see CLAUDE.md), and this is the one place it can be got wrong. */
export function dayEnd(raw: FilterValue): number {
  const start = dayStart(raw);
  return Number.isNaN(start) ? Number.NaN : start + 86_400_000 - 1;
}

/** The raw timestamp, un-rounded — what a row's date value is compared AS. */
function instant(raw: FilterValue): number {
  if (raw == null || raw === "") return Number.NaN;
  const d = raw instanceof Date ? raw : new Date(String(raw));
  return d.getTime();
}

export function isBlank(raw: FilterValue): boolean {
  if (raw == null) return true;
  if (Array.isArray(raw)) return raw.length === 0;
  if (raw instanceof Date) return Number.isNaN(raw.getTime());
  return String(raw).trim() === "";
}

// ---------------------------------------------------------------- relative dates

/** [from, to] in epoch ms, both ends inclusive, for one `isRelativeToToday` preset. */
export function resolveRelative(preset: string, now: Date = new Date()): [number, number] | null {
  const known = RELATIVE_PRESETS.some((p) => p.value === preset);
  if (!known) return null;
  const day = 86_400_000;
  const todayStart = dayStart(now);
  const todayEnd = todayStart + day - 1;

  switch (preset as RelativePreset) {
    case "today":
      return [todayStart, todayEnd];
    case "yesterday":
      return [todayStart - day, todayStart - 1];
    // "Last 7 days" counts today as one of the seven, which is what every report in this
    // app already means by it.
    case "last7d":
      return [todayStart - 6 * day, todayEnd];
    case "last30d":
      return [todayStart - 29 * day, todayEnd];
    case "last90d":
      return [todayStart - 89 * day, todayEnd];
    case "next7d":
      return [todayStart, todayEnd + 6 * day];
    case "next30d":
      return [todayStart, todayEnd + 29 * day];
    case "thisMonth": {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return [dayStart(from), dayEnd(to)];
    }
    case "thisYear": {
      const from = new Date(now.getFullYear(), 0, 1);
      const to = new Date(now.getFullYear(), 11, 31);
      return [dayStart(from), dayEnd(to)];
    }
  }
}

// ---------------------------------------------------------------- the matrix

function first(v: string | string[]): string {
  return Array.isArray(v) ? (v[0] ?? "") : v;
}
function second(v: string | string[]): string {
  return Array.isArray(v) ? (v[1] ?? "") : "";
}

function inclusiveRange(raw: FilterValue, fromRaw: string, toRaw: string, dateLike: boolean): boolean {
  const x = dateLike ? instant(raw) : toNumber(raw);
  if (Number.isNaN(x)) return false;
  const from = dateLike ? dayStart(fromRaw) : toNumber(fromRaw);
  const to = dateLike ? dayEnd(toRaw) : toNumber(toRaw);
  // An open end is legitimate — "cost is between 5000 and (blank)" means "at least 5000".
  if (!Number.isNaN(from) && x < from) return false;
  if (!Number.isNaN(to) && x > to) return false;
  return !(Number.isNaN(from) && Number.isNaN(to));
}

/**
 * The single predicate everything else routes through: does one raw cell value satisfy one
 * operator, read through the lens of one variant?
 *
 * A filter whose value is not filled in yet returns `true` — a half-built row in the
 * advanced builder must not empty the table while you are still typing into it.
 */
export function matchesValue(
  raw: FilterValue,
  variant: FilterVariant,
  op: FilterOperator,
  v: string | string[],
  now: Date = new Date(),
): boolean {
  if (op === "isEmpty") return isBlank(raw);
  if (op === "isNotEmpty") return !isBlank(raw);

  const dateLike = variant === "date" || variant === "dateRange";

  if (op === "isBetween") {
    const from = first(v);
    const to = second(v);
    if (!from && !to) return true;
    return inclusiveRange(raw, from, to, dateLike);
  }

  if (op === "isRelativeToToday") {
    const window = resolveRelative(first(v), now);
    if (!window) return true;
    const x = instant(raw);
    return !Number.isNaN(x) && x >= window[0] && x <= window[1];
  }

  if (op === "inArray" || op === "notInArray") {
    const wanted = Array.isArray(v) ? v : v ? [v] : [];
    if (wanted.length === 0) return true;
    const held = toArray(raw);
    const hit = held.some((h) => wanted.includes(h));
    return op === "inArray" ? hit : !hit;
  }

  const needle = first(v);
  if (needle === "") return true;

  switch (op) {
    case "contains":
      return toText(raw).toLowerCase().includes(needle.toLowerCase());
    case "notContains":
      return !toText(raw).toLowerCase().includes(needle.toLowerCase());
    case "eq":
    case "ne": {
      // A blank cell is neither equal nor unequal to a real value; `isEmpty` is the
      // operator for asking about absence, so "is not X" must not sweep up every gap.
      if (isBlank(raw)) return false;
      let equal: boolean;
      if (variant === "boolean") {
        equal = toBoolean(raw) === toBoolean(needle);
      } else if (dateLike) {
        // Day-granular: "is 20 Aug 2026" means anything that happened that day, not at
        // exactly midnight.
        const x = dayStart(raw);
        const y = dayStart(needle);
        equal = !Number.isNaN(x) && !Number.isNaN(y) && x === y;
      } else if (variant === "number" || variant === "range") {
        const x = toNumber(raw);
        const y = toNumber(needle);
        equal = !Number.isNaN(x) && !Number.isNaN(y) && x === y;
      } else if (variant === "select" || variant === "multiSelect") {
        // Enum-ish values are compared exactly — they came out of the data or an explicit
        // option list, so case-folding would only hide a mismatch.
        equal = variant === "multiSelect" ? toArray(raw).includes(needle) : toText(raw) === needle;
      } else {
        equal = toText(raw).toLowerCase() === needle.toLowerCase();
      }
      return op === "eq" ? equal : !equal;
    }
    case "lt":
    case "lte":
    case "gt":
    case "gte": {
      if (dateLike) {
        const x = instant(raw);
        if (Number.isNaN(x)) return false;
        const start = dayStart(needle);
        const end = dayEnd(needle);
        if (Number.isNaN(start)) return true;
        if (op === "lt") return x < start;
        if (op === "lte") return x <= end;
        if (op === "gt") return x > end;
        return x >= start;
      }
      const x = toNumber(raw);
      const y = toNumber(needle);
      if (Number.isNaN(x) || Number.isNaN(y)) return false;
      if (op === "lt") return x < y;
      if (op === "lte") return x <= y;
      if (op === "gt") return x > y;
      return x >= y;
    }
    default:
      return true;
  }
}

// ---------------------------------------------------------------- column plumbing

/** The variant a column filters and sorts by, honouring the original `filter` prop. */
export function variantOf<T>(column: DataTableColumn<T>): FilterVariant | undefined {
  if (column.variant) return column.variant;
  if (column.filter === "select") return "multiSelect";
  if (column.filter === "text") return "text";
  return undefined;
}

/** The raw value a column exposes to filtering, sorting and search. Falls back through the
 *  original API (`facetValues`, `accessor`) and finally to the rendered cell's text. */
export function columnValue<T>(column: DataTableColumn<T>, row: T): FilterValue {
  if (column.value) return column.value(row);
  if (column.facetValues) return column.facetValues(row);
  if (column.accessor) return column.accessor(row);
  return stringifyNode(column.cell(row));
}

export function matchesFilter<T>(
  row: T,
  column: DataTableColumn<T>,
  filter: TableFilter,
  now: Date = new Date(),
): boolean {
  const variant = variantOf(column) ?? "text";
  return matchesValue(columnValue(column, row), variant, filter.op, filter.v, now);
}

/**
 * Applies the whole filter list at once. `or` means a row survives if ANY filter accepts
 * it; `and` means every one must. Filters naming a column that no longer exists are
 * ignored rather than treated as failures — a stale link should narrow less, never blank
 * the screen.
 */
export function applyFilters<T>(
  rows: T[],
  filters: TableFilter[],
  join: JoinOperator,
  columns: DataTableColumn<T>[],
  now: Date = new Date(),
): T[] {
  const byId = new Map(columns.map((c) => [c.id, c]));
  const live = filters.filter((f) => byId.has(f.id));
  if (live.length === 0) return rows;

  return rows.filter((row) => {
    if (join === "or") return live.some((f) => matchesFilter(row, byId.get(f.id)!, f, now));
    return live.every((f) => matchesFilter(row, byId.get(f.id)!, f, now));
  });
}

/** Free-text search across every column's raw value. */
export function matchesGlobal<T>(row: T, columns: DataTableColumn<T>[], q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return columns.some((c) => toText(columnValue(c, row)).toLowerCase().includes(needle));
}

export function applyGlobal<T>(rows: T[], columns: DataTableColumn<T>[], q: string): T[] {
  if (!q.trim()) return rows;
  return rows.filter((row) => matchesGlobal(row, columns, q));
}

// ---------------------------------------------------------------- sorting

/**
 * The comparator a column sorts by, chosen from its variant. Without this everything sorts
 * as text, which is right for names and quietly wrong for anything else — 10 before 9,
 * 01 Dec before 02 Jan.
 */
export function comparatorFor<T>(column: DataTableColumn<T>): (a: T, b: T) => number {
  const variant = variantOf(column);
  return (rowA, rowB) => {
    const a = columnValue(column, rowA);
    const b = columnValue(column, rowB);
    // Blanks sort last in ascending order regardless of variant, so a column of mostly
    // empty cells still leads with its real data.
    const aBlank = isBlank(a);
    const bBlank = isBlank(b);
    if (aBlank || bBlank) return aBlank && bBlank ? 0 : aBlank ? 1 : -1;

    if (variant === "number" || variant === "range") return toNumber(a) - toNumber(b);
    if (variant === "date" || variant === "dateRange") return instant(a) - instant(b);
    if (variant === "boolean") return Number(toBoolean(a)) - Number(toBoolean(b));
    return toText(a).localeCompare(toText(b), undefined, { numeric: true, sensitivity: "base" });
  };
}
