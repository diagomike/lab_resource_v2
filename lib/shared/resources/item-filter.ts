/**
 * The register's filter shape — now structurally IDENTICAL to
 * `lib/domain/filters.ts`'s own `FilterState`/`FilterRule` (search/join/rules, each
 * rule an `{id, field, op, values}`), so a rule built by the toolbar's faceted
 * popovers, the advanced builder, or a stored `AccessView.extraFilters` row all speak
 * the one shape the matching engine (`matchItems`) actually reads — no adapter step
 * between "what travels over the wire" and "what the engine runs." This used to be a
 * separate, wider `{id, op, v}` triple inherited from the now-deleted
 * `components/data-table/types.ts`'s `TableFilter`; that shape's extra operators
 * (`notContains`/`eq`/`ne`/`lt`/`gt`/`isBetween`/`isRelativeToToday`) were never
 * implemented by `lib/domain/filters.ts`'s `matchRule` (temp_works' own engine only
 * ever exhaustively switched over the 7 below) and so were dead vocabulary — trimmed
 * here rather than carried forward unimplemented. Phase 6 of
 * ~/.claude/plans/wait-i-want-gentle-haven.md had wired the register's filter bar to
 * `lib/domain/filters.ts` using only a handful of core fields as ad hoc query params
 * (items.ts's `ItemQuery`); the fuller merge — this shape, prop:/desc: fields and all,
 * genuinely carried over the wire as a `rules`+`join` query param — closes that gap.
 *
 * Nested property values need no new operator — a synthetic field whose `id` is
 * namespaced (`prop:computer:brand`, `desc:storage:sizeGB`) reads a property off the
 * item itself or, for `desc:`, off ANY descendant. `ItemFilterFieldDef` below is what
 * the server's filter-fields endpoint returns to build the filter bar's column list,
 * including these synthetic ones per active category.
 */
import { z } from "zod";

/** Exactly `lib/domain/filters.ts`'s `FilterOp` — the operators `matchRule` actually
 *  implements, no wider. */
export const filterOperators = ["inArray", "notInArray", "contains", "gte", "lte", "isEmpty", "isNotEmpty"] as const;
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

/** One filter rule. `field` is a plain field id or a namespaced synthetic one
 *  (`prop:<categoryId>:<key>`, `desc:<categoryId>:<key>`); `id` is the RULE's own
 *  instance id, not the field — several rules may target the same field (storage ≥500
 *  AND ≤1000 is two rules on `desc:storage:sizeGB`). `values` is always an array, even
 *  for a single-value operator, so it round-trips through a URL or a stored
 *  `AccessView.extraFilters` losslessly with no `string | string[]` branch to handle. */
export const ItemFilterRule = z.object({
  id: z.string(),
  field: z.string(),
  op: FilterOperatorSchema,
  values: z.array(z.string()),
});
export type ItemFilterRule = z.infer<typeof ItemFilterRule>;

export const ItemFilterState = z.object({
  /** Free-text search, applied across name + summary fields — separate from `rules`
   *  because it has no column of its own. */
  search: z.string(),
  /** How `rules` combine. Defaults to "and" so an omitted field (e.g. a request that
   *  only ever sends core-field rules) behaves exactly as it always has. */
  join: z.enum(["and", "or"]).default("and"),
  rules: z.array(ItemFilterRule),
});
export type ItemFilterState = z.infer<typeof ItemFilterState>;

export const EMPTY_ITEM_FILTERS: ItemFilterState = { search: "", join: "and", rules: [] };

/** One column the filter bar (and the table itself) can offer, including the
 *  synthetic `prop:`/`desc:` ones the server derives per category. */
export const ItemFilterFieldDef = z.object({
  id: z.string(),
  label: z.string(),
  variant: FilterVariantSchema,
  /** `select`/`multiSelect` only. */
  options: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
  /** `number` only — how the filter builder labels a bound (e.g. "GB", "ml"). */
  unit: z.string().optional(),
});
export type ItemFilterFieldDef = z.infer<typeof ItemFilterFieldDef>;

/** Live counts for one column's own filter relaxed — how the faceted filter dropdowns
 *  show "12" next to a category without that filter narrowing the count of itself. */
export const ItemFacetCounts = z.record(z.string(), z.record(z.string(), z.number().int()));
export type ItemFacetCounts = z.infer<typeof ItemFacetCounts>;
