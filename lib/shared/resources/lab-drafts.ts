/**
 * Track 2 — lab draft/visible/ideal states. See
 * ~/.claude/plans/lets-merge-the-work-memoized-journal.md §5 for the full design.
 *
 * A custodian free-edits their own lab in DRAFT; submitting a batch creates one
 * `LabCommitRequest`, decided by exactly the lab's owning department's head (no
 * multi-office chain — that machinery, `approvals.ts`, is reserved for Track 3's
 * transfers and Track 4's procurement review). Approval to VISIBLE applies every
 * staged operation through the existing write door (`applyChange`); approval to
 * IDEAL instead upserts `LabIdealTarget` rows — never an `Item` write at all.
 */
import { z } from "zod";
import { DraftTargetKindSchema, DraftChangeStatusSchema, RequestStatusSchema } from "./enums";
import { ItemChangeInput } from "./item";

/** VISIBLE stages one ordinary ItemChangeInput-shaped operation — the exact
 *  vocabulary mutate.ts's write door already validates. IDEAL stages a proposed
 *  target quantity for one category — never reaches `applyChange` at all, so it is
 *  deliberately NOT unioned into `ItemChangeInput` itself. */
export const StageDraftChangeInput = z.discriminatedUnion("targetKind", [
  z.object({ targetKind: z.literal("VISIBLE"), change: ItemChangeInput }),
  z.object({ targetKind: z.literal("IDEAL"), categoryId: z.string(), qty: z.number().int().min(0) }),
]);
export type StageDraftChangeInput = z.infer<typeof StageDraftChangeInput>;

export const ItemDraftChangeDto = z.object({
  id: z.string(),
  labItemId: z.string(),
  authorId: z.string(),
  authorName: z.string(),
  targetKind: DraftTargetKindSchema,
  /** Either an `ItemChangeInput` (VISIBLE) or `{categoryId, categoryName, qty}`
   *  (IDEAL) — rendered by the client's own diff view per `targetKind`, never
   *  re-parsed as one fixed shape. */
  payload: z.unknown(),
  status: DraftChangeStatusSchema,
  batchId: z.string().nullable(),
  createdAt: z.string(),
});
export type ItemDraftChangeDto = z.infer<typeof ItemDraftChangeDto>;

export const SubmitDraftInput = z.object({ targetKind: DraftTargetKindSchema });
export type SubmitDraftInput = z.infer<typeof SubmitDraftInput>;

export const LabCommitRequestDto = z.object({
  id: z.string(),
  labItemId: z.string(),
  labName: z.string(),
  targetKind: DraftTargetKindSchema,
  requesterId: z.string(),
  requesterName: z.string(),
  batchId: z.string(),
  status: RequestStatusSchema,
  note: z.string().nullable(),
  decidedById: z.string().nullable(),
  decidedByName: z.string().nullable(),
  decidedAt: z.string().nullable(),
  resolution: z.string().nullable(),
  createdAt: z.string(),
  /** The staged operations this request covers — the diff a department head reviews
   *  before deciding. */
  changes: z.array(ItemDraftChangeDto),
  /** Whether the signed-in caller may actually decide this one right now — re-derived
   *  live server-side (the department head, or nobody if the post is vacant), never
   *  a frozen flag. */
  canDecide: z.boolean(),
});
export type LabCommitRequestDto = z.infer<typeof LabCommitRequestDto>;

export const DecideCommitInput = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  note: z.string().optional(),
});
export type DecideCommitInput = z.infer<typeof DecideCommitInput>;

export const IdealVsActualRowDto = z.object({
  categoryId: z.string(),
  categoryName: z.string(),
  idealQty: z.number().int(),
  actualCount: z.number().int(),
  gap: z.number().int(),
  brokenItems: z.array(z.object({ id: z.string(), name: z.string(), status: z.string() })),
});
export type IdealVsActualRowDto = z.infer<typeof IdealVsActualRowDto>;
