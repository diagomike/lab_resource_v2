/**
 * The register's filter shape — deliberately the SAME `{id, op, v}` triple the now-
 * deleted `components/data-table/types.ts`'s `TableFilter` used, and the same
 * operator vocabulary (`inArray`, `notInArray`, `contains`, `gte`, `lte`, `isEmpty`,
 * `isNotEmpty`, ...). temp_works' own filter engine was deliberately written against
 * this vocabulary for exactly this reason. Phase 6 of
 * ~/.claude/plans/wait-i-want-gentle-haven.md wired the register's own filter bar
 * straight to lib/domain/filters.ts using the operators both vocabularies already
 * share (items.ts's `ItemQuery`, a handful of core fields) rather than through this
 * schema — this contract still exists for the fuller merge (this shape, prop:/desc:
 * fields and all, actually carried over the wire) that is still open.
 *
 * Nested property values need no new operator — a synthetic column whose `id` is a
 * namespaced field id (`prop:computer:brand`, `desc:storage:sizeGB`) reads a property
 * off the item itself or, for `desc:`, off ANY descendant. `FilterFieldDef` below is
 * what the server's filter-fields endpoint returns to build the filter bar's column
 * list, including these synthetic ones per category.
 */
import { z } from "zod";

export const filterOperators = [
  "contains",
  "notContains",
  "eq",
  "ne",
  "lt",
  "lte",
  "gt",
  "gte",
  "isBetween",
  "isRelativeToToday",
  "inArray",
  "notInArray",
  "isEmpty",
  "isNotEmpty",
] as const;
export const FilterOperatorSchema = z.enum(filterOperators);
export type FilterOperator = (typeof filterOperators)[number];

export const filterVariants = [
  "text",
  "number",
  "range",
  "date",
  "dateRange",
  "boolean",
  "select",
  "multiSelect",
] as const;
export const FilterVariantSchema = z.enum(filterVariants);
export type FilterVariant = (typeof filterVariants)[number];

/** One filter rule. `v` is always string-shaped — a single value, or both ends for
 *  `isBetween` / the checked set for `inArray` — so it round-trips through a URL or a
 *  stored AccessView.extraFilters losslessly. */
export const ItemFilterRule = z.object({
  id: z.string(),
  op: FilterOperatorSchema,
  v: z.union([z.string(), z.array(z.string())]),
});
export type ItemFilterRule = z.infer<typeof ItemFilterRule>;

export const ItemFilterState = z.object({
  rules: z.array(ItemFilterRule),
  /** Free-text search, applied across name + summary fields — separate from `rules`
   *  because it has no column of its own. */
  search: z.string(),
});
export type ItemFilterState = z.infer<typeof ItemFilterState>;

export const EMPTY_ITEM_FILTERS: ItemFilterState = { rules: [], search: "" };

/** One column the filter bar (and the table itself) can offer, including the
 *  synthetic `prop:`/`desc:` ones the server derives per category. */
export const ItemFilterFieldDef = z.object({
  id: z.string(),
  label: z.string(),
  variant: FilterVariantSchema,
  /** `select`/`multiSelect` only. */
  options: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
});
export type ItemFilterFieldDef = z.infer<typeof ItemFilterFieldDef>;

/** Live counts for one column's own filter relaxed — how the faceted filter dropdowns
 *  show "12" next to a category without that filter narrowing the count of itself. */
export const ItemFacetCounts = z.record(z.string(), z.record(z.string(), z.number().int()));
export type ItemFacetCounts = z.infer<typeof ItemFacetCounts>;
