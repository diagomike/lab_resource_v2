import { z } from "zod";

/**
 * Distribute (2026-10-02): the store keeper sends stock from the stores they keep to the
 * labs — pre-filled from the lab needs a purchase answered, or picked by hand. Each send
 * is a store handover: Property Administration approves, the lab's custodian accepts.
 * See lib/server/resources/distribution.ts.
 */

const ItemRef = z.object({ id: z.string(), name: z.string() });

export const DistributionLabDto = z.object({ id: z.string(), name: z.string(), unitName: z.string(), custodianName: z.string() });
export type DistributionLabDto = z.infer<typeof DistributionLabDto>;

/** One lab need a purchase answered, with stock in the keeper's stores to send for it. */
export const DistributionLineDto = z.object({
  needId: z.string(),
  name: z.string(),
  qty: z.number(),
  categoryId: z.string().nullable(),
  categoryName: z.string().nullable(),
  purchaseReference: z.string().nullable(),
  /** Free units of that kind in the keeper's stores, first the ones proposed. */
  items: z.array(ItemRef),
  /** Counted as a quantity: move it by hand (a quantity isn't split here). */
  bulk: z.boolean(),
});
export type DistributionLineDto = z.infer<typeof DistributionLineDto>;

export const DistributionDto = z.object({
  /** The stores the keeper keeps. */
  stores: z.array(z.object({ id: z.string(), name: z.string() })),
  /** What a purchase brought for labs that asked, grouped by lab. */
  suggestions: z.array(z.object({ lab: DistributionLabDto, lines: z.array(DistributionLineDto) })),
  /** Free stock in the keeper's stores, by kind, for sending by hand. */
  stock: z.array(z.object({ categoryId: z.string(), categoryName: z.string(), items: z.array(ItemRef) })),
  /** Labs, workshops and studios stock can go to. */
  labs: z.array(DistributionLabDto),
});
export type DistributionDto = z.infer<typeof DistributionDto>;

export const DistributeInput = z.object({
  sends: z
    .array(
      z.object({
        labId: z.string(),
        itemIds: z.array(z.string()).min(1, "Choose at least one thing to send.").max(500),
        /** The lab needs this send answers (so they aren't offered again). */
        needIds: z.array(z.string()).max(50).optional(),
        renameAs: z.string().trim().min(1).max(120).optional(),
        note: z.string().trim().max(2000).optional(),
      }),
    )
    .min(1, "Add at least one send.")
    .max(50),
});
export type DistributeInput = z.infer<typeof DistributeInput>;

export const DistributeResultDto = z.object({
  results: z.array(z.object({ labId: z.string(), ok: z.boolean(), summary: z.string().nullable(), error: z.string().nullable() })),
});
export type DistributeResultDto = z.infer<typeof DistributeResultDto>;
