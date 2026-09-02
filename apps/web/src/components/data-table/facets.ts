import { applyFilters, columnValue, toArray, variantOf } from "./filter-logic";
import type { DataTableColumn, JoinOperator, Option, TableFilter } from "./types";

/**
 * The option list a select/multiSelect control shows, always with a live row count.
 *
 * The count is computed over rows surviving THE OTHER active filters, never over the whole
 * data set — so "needs repair · 3" means ticking it would add those three to what you are
 * already looking at, not that three exist somewhere. The original implementation counted
 * against every row, which is the number you least want when two filters are on.
 *
 * With `or` in force that reasoning inverts: any single filter can admit rows on its own,
 * so counts are taken over the full set instead, which is the honest answer there.
 */
export function facetOptions<T>(
  rows: T[],
  column: DataTableColumn<T>,
  allFilters: TableFilter[],
  join: JoinOperator,
  columns: DataTableColumn<T>[],
  now: Date = new Date(),
): Option[] {
  const base =
    join === "or"
      ? rows
      : applyFilters(rows, allFilters.filter((f) => f.id !== column.id), "and", columns, now);

  const counts = new Map<string, number>();
  for (const row of base) {
    for (const v of valuesOf(column, row)) {
      if (!v) continue;
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
  }

  const explicit = column.options ?? column.filterOptions;
  if (explicit) {
    return explicit.map((o) => ({ ...o, count: counts.get(o.value) ?? 0 }));
  }

  // Derived from the data: most common first, and a value with no rows cannot appear at
  // all — there is nothing to gain from offering a tick that could only empty the table.
  const label = column.facetLabel ?? defaultFacetLabel;
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value, count]) => ({ value, label: label(value), count }));
}

/** A row's own discrete values for faceting. A `select` column contributes exactly one. */
export function valuesOf<T>(column: DataTableColumn<T>, row: T): string[] {
  const raw = columnValue(column, row);
  if (variantOf(column) === "select") {
    const text = raw == null ? "" : String(raw).trim();
    return text ? [text] : [];
  }
  return toArray(raw);
}

/** Lowercased with underscores opened out — enough for this app's SCREAMING_CASE enums. */
export function defaultFacetLabel(raw: string): string {
  return raw.toLowerCase().replace(/_/g, " ");
}

/** How one filter's value reads on its chip: "good, fair" rather than a raw enum list. */
export function labelForValue<T>(column: DataTableColumn<T>, value: string): string {
  const explicit = column.options ?? column.filterOptions;
  const hit = explicit?.find((o) => o.value === value);
  if (hit) return hit.label;
  return (column.facetLabel ?? defaultFacetLabel)(value);
}
