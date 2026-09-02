import type { ReactNode } from "react";

/**
 * The vocabulary the whole table is built from.
 *
 * Modelled on tablecn (sadmann7/tablecn, `src/config/data-table.ts` +
 * `src/types/data-table.ts`), with one deliberate divergence: tablecn's operator names are
 * SQL fragments (`iLike`, `notILike`) because it filters in Postgres. Everything here is a
 * predicate over a JavaScript value, so those two are named `contains` / `notContains`.
 * Every other operator keeps tablecn's name verbatim so the two stay legible side by side.
 */

export type FilterVariant =
  | "text"
  | "number"
  | "range"
  | "date"
  | "dateRange"
  | "boolean"
  | "select"
  | "multiSelect";

export type FilterOperator =
  | "contains"
  | "notContains"
  | "eq"
  | "ne"
  | "lt"
  | "lte"
  | "gt"
  | "gte"
  | "isBetween"
  | "isRelativeToToday"
  | "inArray"
  | "notInArray"
  | "isEmpty"
  | "isNotEmpty";

/** Applied across the whole filter list at once, not per row — so the order of the rows in
 *  the advanced builder cannot change the result, which is why they are not reorderable. */
export type JoinOperator = "and" | "or";

/** Whatever a column's `value()` hands back, before any variant-specific coercion. */
export type FilterValue = string | number | boolean | Date | string[] | null | undefined;

/**
 * One filter, exactly as it is serialised into the URL. Keys are one or two characters
 * because several of these ride in a single query parameter.
 *
 * `v` is always string-shaped, never a number or Date — a URL has no other types, and
 * keeping the in-memory form identical to the serialised form means the codec is lossless
 * and there is only ever one place (filter-logic.ts) that coerces.
 */
export interface TableFilter {
  /** The column id this applies to. */
  id: string;
  op: FilterOperator;
  /** A single value, or both ends for `isBetween` / the checked set for `inArray`. */
  v: string | string[];
}

export interface Option {
  value: string;
  label: string;
  /** Live row count, filled in by facets.ts — never supplied by a caller. */
  count?: number;
}

export interface SortEntry {
  id: string;
  desc: boolean;
}

export interface DataTableColumn<T> {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;

  /**
   * Declares the filter control, its legal operators AND the sort comparator in one place.
   * Omit for a column that is neither filterable nor meaningfully sortable.
   */
  variant?: FilterVariant;
  /**
   * The raw value filtering and sorting see. Return the real type — a number for a count,
   * a Date or ISO string for a date, a string[] for a multi-valued cell — not the formatted
   * text, or `10 items` will sort before `9 items`.
   */
  value?: (row: T) => FilterValue;
  /** Fixed option list for select/multiSelect. Omit to derive the values from the data. */
  options?: Option[];
  /** Bounds for a `range` slider. Omit and the two ends are plain number inputs. */
  range?: [number, number];
  /** Suffix shown inside the value editor — "d", "mo", "ETB". */
  unit?: string;
  /** Show this column's control in the header filter row. Default true when `variant` is
   *  set; turn it off for a column that only makes sense in the advanced builder. */
  inlineFilter?: boolean;
  /** Offered in the Columns dropdown. Default true. */
  hideable?: boolean;

  sortable?: boolean;
  mono?: boolean;
  width?: string;

  // ---- Kept from the original DataTable so existing call sites compile unchanged. ----
  /** Superseded by `value`, which can return a real number/Date/array. Still read when
   *  `value` is absent. */
  accessor?: (row: T) => string | number | null;
  /** Superseded by `variant`: "text" → `text`, "select" → `multiSelect`. */
  filter?: "text" | "select";
  /** Superseded by `options`. */
  filterOptions?: { value: string; label: string }[];
  /** Superseded by `value` returning a string[]. */
  facetValues?: (row: T) => string[];
  /** Prettifies a raw facet value. Defaults to lowercasing and `_` → space, which is what
   *  this app's SCREAMING_CASE enums want. */
  facetLabel?: (raw: string) => string;
}

/** The complete view state of one table — the thing the URL holds. */
export interface TableState {
  q: string;
  filters: TableFilter[];
  join: JoinOperator;
  sort: SortEntry[];
  /** 1-based, matching what the pagination control shows. */
  page: number;
  /** 0 means "no pagination", used by the tree-shaped screens. */
  size: number;
  /** Column ids currently hidden. */
  hidden: string[];
}
