/**
 * Lab states — Current, Draft and Ideal as whole named trees (2026-09-22 rework; see
 * lib/domain/version-ops.ts and lib/server/resources/lab-versions.ts).
 *
 * The custodian edits a DRAFT (a copy of the lab's live tree) or an IDEAL_PROPOSAL (a
 * copy of the approved Ideal, or of Current when there is none) and submits it; the
 * owning department's head approves or rejects one `LabCommitRequest`. An approved
 * Draft merges into the live register; an approved proposal becomes the Ideal —
 * what purchasing measures the lab against.
 */
import { z } from "zod";
import { DraftTargetKindSchema, EffectiveStatusSchema, ItemStatusSchema, LabVersionKindSchema, LabVersionStatusSchema, RequestStatusSchema, CustomPropTypeSchema } from "./enums";
import { CustomProps, ItemPropValue } from "./item";

const ids = z.array(z.string()).min(1);

/** One edit to a version. Ids name the version's own rows — or, from the register,
 *  real item ids, which the server maps to the rows copied from them. */
export const VersionOpInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("createItem"), parentId: z.string(), categoryId: z.string(), count: z.number().int().min(1).max(200), name: z.string().trim().max(160).optional(), props: z.record(z.string(), ItemPropValue).optional() }),
  z.object({ kind: z.literal("setName"), itemIds: ids, value: z.string().trim().min(1).max(160) }),
  z.object({ kind: z.literal("setStatus"), itemIds: ids, value: ItemStatusSchema }),
  z.object({ kind: z.literal("setQuantity"), itemIds: ids, value: z.number().min(0) }),
  z.object({ kind: z.literal("setProperty"), itemIds: ids, propKey: z.string(), value: ItemPropValue }),
  z.object({ kind: z.literal("addCustomProperty"), itemIds: ids, key: z.string().min(1).max(50), type: CustomPropTypeSchema, value: ItemPropValue }),
  z.object({ kind: z.literal("setCustomProperty"), itemIds: ids, key: z.string(), value: ItemPropValue }),
  z.object({ kind: z.literal("removeCustomProperty"), itemIds: ids, key: z.string() }),
  z.object({ kind: z.literal("deleteItem"), itemIds: ids }),
  z.object({ kind: z.literal("moveInTree"), itemIds: ids, value: z.string() }),
]);
export type VersionOpInput = z.infer<typeof VersionOpInput>;

/** One row of a tree shown on the Lab states page — a live item (Current) or a
 *  version row. `sourceItemId` is the real item behind it (equal to `id` for Current;
 *  null for something added in a version). */
export const LabTreeNodeDto = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  sourceItemId: z.string().nullable(),
  categoryId: z.string(),
  categoryName: z.string(),
  categoryIconKey: z.string(),
  name: z.string(),
  qty: z.number(),
  status: ItemStatusSchema,
  effectiveStatus: EffectiveStatusSchema,
  critical: z.boolean(),
  props: z.record(z.string(), ItemPropValue),
  customProps: CustomProps,
});
export type LabTreeNodeDto = z.infer<typeof LabTreeNodeDto>;

export const DiffEntryDto = z.object({
  kind: z.enum(["added", "removed", "changed"]),
  versionItemId: z.string().nullable(),
  sourceItemId: z.string().nullable(),
  name: z.string(),
  categoryId: z.string(),
  lines: z.array(z.string()),
  markerItemId: z.string().nullable(),
  where: z.string().optional(),
  note: z.string().optional(),
});
export type DiffEntryDto = z.infer<typeof DiffEntryDto>;

export const LabVersionDto = z.object({
  id: z.string(),
  kind: LabVersionKindSchema,
  status: LabVersionStatusSchema,
  rejectionNote: z.string().nullable(),
  createdByName: z.string(),
  updatedAt: z.string(),
  nodes: z.array(LabTreeNodeDto),
  /** Against Current (DRAFT) or against the approved Ideal (IDEAL_PROPOSAL). */
  diff: z.array(DiffEntryDto),
});
export type LabVersionDto = z.infer<typeof LabVersionDto>;

export const IdealStatRowDto = z.object({
  categoryId: z.string(),
  categoryName: z.string(),
  categoryIconKey: z.string(),
  idealCount: z.number().int(),
  currentCount: z.number().int(),
  gap: z.number().int(),
  /** Of the current ones, how many need attention (broken, maintenance, impaired…). */
  needsAttention: z.number().int(),
  missing: z.array(z.object({ id: z.string(), name: z.string() })),
});
export type IdealStatRowDto = z.infer<typeof IdealStatRowDto>;

export const LabCommitRequestDto = z.object({
  id: z.string(),
  labItemId: z.string(),
  labName: z.string(),
  targetKind: DraftTargetKindSchema,
  requesterId: z.string(),
  requesterName: z.string(),
  versionId: z.string().nullable(),
  status: RequestStatusSchema,
  /** What it changes, readable — kept on the request after the version is gone. */
  summary: z.array(z.object({ kind: z.enum(["added", "removed", "changed"]), name: z.string(), lines: z.array(z.string()), where: z.string().optional(), note: z.string().optional() })),
  note: z.string().nullable(),
  decidedById: z.string().nullable(),
  decidedByName: z.string().nullable(),
  decidedAt: z.string().nullable(),
  resolution: z.string().nullable(),
  createdAt: z.string(),
  /** The signed-in caller may decide it right now (the lab's live department head). */
  canDecide: z.boolean(),
});
export type LabCommitRequestDto = z.infer<typeof LabCommitRequestDto>;

export const DecideCommitInput = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  note: z.string().optional(),
});
export type DecideCommitInput = z.infer<typeof DecideCommitInput>;

/** Everything the Lab states page shows for one lab. */
export const LabStatesDto = z.object({
  lab: z.object({
    id: z.string(),
    name: z.string(),
    ownerOrgNodeId: z.string(),
    ownerOrgNodeName: z.string(),
    custodianId: z.string(),
    custodianName: z.string(),
    headName: z.string().nullable(),
    draftWorkflowEnabled: z.boolean(),
  }),
  /** The caller is this lab's custodian (or the admin) and may edit its versions. */
  canEdit: z.boolean(),
  /** The caller is the lab's department head and decides its commits. */
  isHead: z.boolean(),
  current: z.array(LabTreeNodeDto),
  draft: LabVersionDto.nullable(),
  ideal: LabVersionDto.nullable(),
  idealProposal: LabVersionDto.nullable(),
  /** Approved Ideal vs Current (empty when there is no approved Ideal). */
  idealStats: z.array(IdealStatRowDto),
  /** The proposal vs Current, when there is one — what the lab would need if approved. */
  proposalStats: z.array(IdealStatRowDto),
  commits: z.array(LabCommitRequestDto),
});
export type LabStatesDto = z.infer<typeof LabStatesDto>;

/** One lab in the Lab states list. */
export const LabSummaryDto = z.object({
  id: z.string(),
  name: z.string(),
  categoryIconKey: z.string(),
  ownerOrgNodeId: z.string(),
  ownerOrgNodeName: z.string(),
  custodianName: z.string(),
  draft: LabVersionStatusSchema.nullable(),
  draftChanges: z.number().int(),
  hasIdeal: z.boolean(),
  proposal: LabVersionStatusSchema.nullable(),
  pendingCommits: z.number().int(),
});
export type LabSummaryDto = z.infer<typeof LabSummaryDto>;

/** Register markers: real item id → the pending (drafted) change lines touching it. */
export const PendingMarkersDto = z.record(z.string(), z.object({ labItemId: z.string(), lines: z.array(z.string()) }));
export type PendingMarkersDto = z.infer<typeof PendingMarkersDto>;

export const IdealVsActualRowDto = z.object({
  categoryId: z.string(),
  categoryName: z.string(),
  idealQty: z.number().int(),
  actualCount: z.number().int(),
  gap: z.number().int(),
  brokenItems: z.array(z.object({ id: z.string(), name: z.string(), status: z.string() })),
  buyGap: z.number().int().optional(),
  replaceCount: z.number().int().optional(),
});
export type IdealVsActualRowDto = z.infer<typeof IdealVsActualRowDto>;

/** A department's labs rolled up against their approved ideal state — see
 *  `lib/domain/purchasables.ts`. What a head reads before compiling a purchase
 *  request; a suggestion, never converted into one automatically. */
export const PurchasableLabDto = z.object({
  labItemId: z.string(),
  labName: z.string(),
  idealQty: z.number().int(),
  actualCount: z.number().int(),
  gap: z.number().int(),
  brokenCount: z.number().int(),
  buyGap: z.number().int(),
  replaceCount: z.number().int(),
});
export type PurchasableLabDto = z.infer<typeof PurchasableLabDto>;

export const PurchasableRowDto = z.object({
  categoryId: z.string(),
  categoryName: z.string(),
  idealQty: z.number().int(),
  actualCount: z.number().int(),
  gap: z.number().int(),
  brokenCount: z.number().int(),
  /** What to order to close the gap — top-most missing items only (parts come inside). */
  buyGap: z.number().int(),
  /** Replacements for items that failed themselves (broken or lost). */
  replaceCount: z.number().int(),
  labs: z.array(PurchasableLabDto),
});
export type PurchasableRowDto = z.infer<typeof PurchasableRowDto>;

export const DepartmentPurchasablesDto = z.object({
  orgNodeId: z.string(),
  orgNodeName: z.string(),
  labCount: z.number().int(),
  rows: z.array(PurchasableRowDto),
});
export type DepartmentPurchasablesDto = z.infer<typeof DepartmentPurchasablesDto>;
