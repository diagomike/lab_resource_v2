/**
 * ONE self-referential resource. A lab, a workstation setup, a computer and a stick of
 * RAM are all Items; `parentId` IS physical containment. Read models (ItemRowDto /
 * ItemDetailDto) are resolved names, never a raw Prisma record — separate from
 * `ItemChangeInput`, the mutation input.
 *
 * `ItemChangeInput` is THE seam this whole design depends on (see
 * lib/server/resources/mutate.ts, a later phase): a Zod discriminated union on `kind`,
 * ids only, JSON-serialisable end to end. `ChangeRequest.payload` (Prisma) stores one
 * of these verbatim; `applyOnFinalApproval()` will call the exact same write function a
 * direct edit does with the exact same input — a routed-and-approved change must
 * produce a record identical to applying it directly. Stronger than temp_works' own
 * loose `{kind, value?: unknown, ...}` shape (which TypeScript, not Zod, was checking):
 * each variant below carries only the fields that kind actually uses, precisely typed.
 *
 * `editCategory` is deliberately NOT a variant here — a category edit is its own
 * endpoint (see category.ts's UpdateCategoryInput), not funnelled through the one
 * item-changes door. It still appears as an ItemChangeKind because the audit log
 * (ItemChangeDto) tags a category-edit entry with it.
 */
import { z } from "zod";
import { CountingModeSchema, ItemChangeKindSchema, ItemChangeTargetSchema, ItemStatusSchema } from "./enums";

export const ItemPropValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type ItemPropValue = z.infer<typeof ItemPropValue>;

export const ItemProps = z.record(z.string(), ItemPropValue);
export type ItemProps = z.infer<typeof ItemProps>;

export const ItemImageDto = z.object({
  id: z.string(),
  url: z.string(),
  caption: z.string().nullable(),
  sortOrder: z.number().int(),
});
export type ItemImageDto = z.infer<typeof ItemImageDto>;

/** One flat row — the search list and the rollup's leaf rows. Tree/rollup grouping
 *  happens client-side (lib/domain/tree.ts) over a set of these, not server-side. */
export const ItemRowDto = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  categoryId: z.string(),
  categoryName: z.string(),
  categoryIconKey: z.string(),
  name: z.string(),
  countingMode: CountingModeSchema,
  qty: z.number(),
  status: ItemStatusSchema,
  critical: z.boolean(),
  props: ItemProps,
  ownerOrgNodeId: z.string(),
  ownerOrgNodeName: z.string(),
  currentOrgNodeId: z.string(),
  currentOrgNodeName: z.string(),
  custodianId: z.string(),
  custodianName: z.string(),
  version: z.number().int(),
  /** Slash-joined names from the containment root down to (not including) this row —
   *  the search list's location column. */
  path: z.array(z.string()),
  thumbnailUrl: z.string().nullable(),
});
export type ItemRowDto = z.infer<typeof ItemRowDto>;

export const ItemDetailDto = ItemRowDto.extend({
  images: z.array(ItemImageDto),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ItemDetailDto = z.infer<typeof ItemDetailDto>;

// ── The one write door ──────────────────────────────────────────────────

const Base = z.object({ note: z.string().optional() });

export const CreateItemChange = Base.extend({
  kind: z.literal("createItem"),
  parentId: z.string().nullable(),
  categoryId: z.string(),
  count: z.number().int().min(1),
  ownerOrgNodeId: z.string().optional(),
  currentOrgNodeId: z.string().optional(),
  custodianId: z.string().optional(),
});

export const DeleteItemChange = Base.extend({
  kind: z.literal("deleteItem"),
  itemIds: z.array(z.string()).min(1),
});

export const SetNameChange = Base.extend({
  kind: z.literal("setName"),
  itemIds: z.array(z.string()).min(1),
  value: z.string().min(1),
});

export const SetStatusChange = Base.extend({
  kind: z.literal("setStatus"),
  itemIds: z.array(z.string()).min(1),
  value: ItemStatusSchema,
});

export const SetPropertyChange = Base.extend({
  kind: z.literal("setProperty"),
  itemIds: z.array(z.string()).min(1),
  propKey: z.string().min(1),
  value: ItemPropValue,
});

export const SetQuantityChange = Base.extend({
  kind: z.literal("setQuantity"),
  itemIds: z.array(z.string()).min(1),
  value: z.number().min(0),
});

export const SetCustodianChange = Base.extend({
  kind: z.literal("setCustodian"),
  itemIds: z.array(z.string()).min(1),
  value: z.string(),
});

export const SetOwnerOrgChange = Base.extend({
  kind: z.literal("setOwnerOrg"),
  itemIds: z.array(z.string()).min(1),
  value: z.string(),
});

export const SetCurrentOrgChange = Base.extend({
  kind: z.literal("setCurrentOrg"),
  itemIds: z.array(z.string()).min(1),
  value: z.string(),
});

export const MoveInTreeChange = Base.extend({
  kind: z.literal("moveInTree"),
  itemIds: z.array(z.string()).min(1),
  value: z.string().nullable(),
});

/**
 * Borrowing, not selling: `ownerOrgNodeId` is deliberately absent from `transfer` —
 * the whole point of the owner/current split is that a resource can sit in another
 * department's lab without changing hands. `targetCustodianId: null` keeps the
 * existing custodian.
 */
export const TransferItemChange = Base.extend({
  kind: z.literal("transferItem"),
  itemIds: z.array(z.string()).min(1),
  transfer: z.object({
    targetParentId: z.string(),
    targetOrgNodeId: z.string(),
    targetCustodianId: z.string().nullable(),
  }),
});

export const AddImageChange = Base.extend({
  kind: z.literal("addImage"),
  itemIds: z.array(z.string()).length(1),
  storageKey: z.string(),
  contentType: z.string(),
  byteSize: z.number().int().min(1),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  caption: z.string().optional(),
});

export const RemoveImageChange = Base.extend({
  kind: z.literal("removeImage"),
  itemIds: z.array(z.string()).length(1),
  imageId: z.string(),
});

export const ItemChangeInput = z.discriminatedUnion("kind", [
  CreateItemChange,
  DeleteItemChange,
  SetNameChange,
  SetStatusChange,
  SetPropertyChange,
  SetQuantityChange,
  SetCustodianChange,
  SetOwnerOrgChange,
  SetCurrentOrgChange,
  MoveInTreeChange,
  TransferItemChange,
  AddImageChange,
  RemoveImageChange,
]);
export type ItemChangeInput = z.infer<typeof ItemChangeInput>;

/** dryRun:true runs the exact same validate→apply path without committing — the
 *  preview variant of the one write endpoint, and what edit-impact previews use. */
export const PreviewItemChangeInput = z.object({
  change: ItemChangeInput,
});
export type PreviewItemChangeInput = z.infer<typeof PreviewItemChangeInput>;

export const ItemChangeResultDto = z.object({
  applied: z.number().int(),
  itemIds: z.array(z.string()),
});
export type ItemChangeResultDto = z.infer<typeof ItemChangeResultDto>;

/** 409 shape when a mutation's expectedVersions no longer match — refused whole,
 *  never merged. */
export const VersionConflictDto = z.object({
  code: z.literal("VERSION_CONFLICT"),
  conflicts: z.array(z.object({ itemId: z.string(), expectedVersion: z.number().int(), actualVersion: z.number().int() })),
});
export type VersionConflictDto = z.infer<typeof VersionConflictDto>;

// ── Change log (read model) ─────────────────────────────────────────────

export const ItemChangeDto = z.object({
  id: z.string(),
  at: z.string(),
  actorId: z.string(),
  actorName: z.string(),
  kind: ItemChangeKindSchema,
  targetKind: ItemChangeTargetSchema,
  itemId: z.string().nullable(),
  itemName: z.string(),
  categoryId: z.string().nullable(),
  field: z.string().nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  batchId: z.string().nullable(),
  note: z.string().nullable(),
});
export type ItemChangeDto = z.infer<typeof ItemChangeDto>;
