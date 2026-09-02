import { z } from "zod";
import { CountingModeSchema, ItemStatusSchema } from "./enums";

export const PropValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type PropValue = z.infer<typeof PropValue>;

/**
 * One row of the register — what the table renders. Resolved names, not raw ids, so
 * the client never re-derives a category or org name from a separate lookup. A Prisma
 * record is never returned directly; this is the public contract.
 *
 * `status` is the STORED value only. Derived/effective status (IMPAIRED) is not yet
 * computed — see the resource-register plan's Phase 5 — and will extend this DTO with
 * `effectiveStatus` / `impairedBy` when derived-status.ts lands.
 */
export const ItemRowDto = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  name: z.string(),
  categoryId: z.string(),
  categoryName: z.string(),
  countingMode: CountingModeSchema,
  qty: z.number(),
  status: ItemStatusSchema,
  critical: z.boolean(),
  ownerOrgNodeId: z.string(),
  ownerOrgName: z.string(),
  currentOrgNodeId: z.string(),
  currentOrgName: z.string(),
  custodianId: z.string(),
  custodianName: z.string(),
  version: z.number().int(),
  updatedAt: z.string(),
});
export type ItemRowDto = z.infer<typeof ItemRowDto>;

/** The inspector's full view of one item, including its category-defined properties. */
export const ItemDetailDto = ItemRowDto.extend({
  props: z.record(z.string(), PropValue),
  createdAt: z.string(),
});
export type ItemDetailDto = z.infer<typeof ItemDetailDto>;

/** Just enough to power a picker (handover recipient, transfer destination) — not the
 *  full row. */
export const ItemSummaryDto = z.object({
  id: z.string(),
  name: z.string(),
  categoryName: z.string(),
});
export type ItemSummaryDto = z.infer<typeof ItemSummaryDto>;
