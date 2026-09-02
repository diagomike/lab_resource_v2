import { z } from "zod";

/**
 * The query GET /resources/search accepts.
 *
 * Filtering, sort and pagination are NOT implemented yet — see the resource-register
 * plan's Phase 6, which teaches this the target data-table's TableFilter/FilterOperator
 * vocabulary (apps/web/src/components/data-table/types.ts) and a server-side predicate
 * builder. This file exists now so later phases extend one shared input shape instead
 * of each endpoint growing its own ad hoc query params.
 */
export const ItemQueryInput = z.object({
  categoryId: z.string().optional(),
});
export type ItemQueryInput = z.infer<typeof ItemQueryInput>;
