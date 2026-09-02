import type { FilterOperator, FilterVariant } from "./types";

/**
 * Which operators each variant offers, and what to call them in the UI. Ported from
 * tablecn's `src/config/data-table.ts` — the labels are deliberately its wording too
 * ("Has any of", "Is relative to today"), since they read well and are already familiar to
 * anyone who has used a Notion/Airtable filter.
 *
 * This lives here in apps/web and NOT in packages/shared on purpose: a freshly re-exported
 * const array from the shared barrel has failed to resolve under Vite/Rollup's cjs-interop
 * before (see CLAUDE.md on `units` in Phase 6), and these arrays are imported as values.
 */

export const OPERATOR_LABELS: Record<FilterOperator, string> = {
  contains: "Contains",
  notContains: "Does not contain",
  eq: "Is",
  ne: "Is not",
  lt: "Is less than",
  lte: "Is less than or equal to",
  gt: "Is greater than",
  gte: "Is greater than or equal to",
  isBetween: "Is between",
  isRelativeToToday: "Is relative to today",
  inArray: "Has any of",
  notInArray: "Has none of",
  isEmpty: "Is empty",
  isNotEmpty: "Is not empty",
};

/** Date columns want "is before"/"is after", not "is less than". */
const DATE_OPERATOR_LABELS: Partial<Record<FilterOperator, string>> = {
  lt: "Is before",
  gt: "Is after",
  lte: "Is on or before",
  gte: "Is on or after",
};

export function operatorLabel(op: FilterOperator, variant: FilterVariant): string {
  if (variant === "date" || variant === "dateRange") return DATE_OPERATOR_LABELS[op] ?? OPERATOR_LABELS[op];
  return OPERATOR_LABELS[op];
}

export const OPERATORS_BY_VARIANT: Record<FilterVariant, FilterOperator[]> = {
  text: ["contains", "notContains", "eq", "ne", "isEmpty", "isNotEmpty"],
  number: ["eq", "ne", "lt", "lte", "gt", "gte", "isBetween", "isEmpty", "isNotEmpty"],
  range: ["isBetween"],
  date: ["eq", "ne", "lt", "gt", "lte", "gte", "isBetween", "isRelativeToToday", "isEmpty", "isNotEmpty"],
  dateRange: ["isBetween"],
  boolean: ["eq", "ne"],
  select: ["eq", "ne", "isEmpty", "isNotEmpty"],
  multiSelect: ["inArray", "notInArray", "isEmpty", "isNotEmpty"],
};

/** The operator a freshly-added filter starts on. */
export function defaultOperator(variant: FilterVariant): FilterOperator {
  return OPERATORS_BY_VARIANT[variant][0];
}

export function isOperatorLegal(variant: FilterVariant, op: FilterOperator): boolean {
  return OPERATORS_BY_VARIANT[variant].includes(op);
}

/** Operators that need no value at all — the value editor renders disabled for these. */
export const VALUELESS_OPERATORS: FilterOperator[] = ["isEmpty", "isNotEmpty"];

/** Operators whose value is a pair or a set, i.e. serialised as an array. */
export const ARRAY_OPERATORS: FilterOperator[] = ["isBetween", "inArray", "notInArray"];

/**
 * `isRelativeToToday` takes one of these tokens rather than a date, so a shared link still
 * means "the last 30 days" tomorrow instead of freezing yesterday's window.
 */
export const RELATIVE_PRESETS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last7d", label: "Last 7 days" },
  { value: "last30d", label: "Last 30 days" },
  { value: "last90d", label: "Last 90 days" },
  { value: "thisMonth", label: "This month" },
  { value: "thisYear", label: "This year" },
  { value: "next7d", label: "Next 7 days" },
  { value: "next30d", label: "Next 30 days" },
] as const;

export type RelativePreset = (typeof RELATIVE_PRESETS)[number]["value"];

export const PAGE_SIZES = [10, 25, 50, 100];
