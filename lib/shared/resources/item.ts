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
import { CountingModeSchema, CustomPropTypeSchema, EffectiveStatusSchema, effectiveStatuses, ItemChangeKindSchema, ItemChangeTargetSchema, ItemStatusSchema } from "./enums";

export const ItemPropValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type ItemPropValue = z.infer<typeof ItemPropValue>;

export const ItemProps = z.record(z.string(), ItemPropValue);
export type ItemProps = z.infer<typeof ItemProps>;

/** A key a person types for a custom property — letters/digits/spaces/-/_ only,
 *  starting with a letter, capped at a sane length. No `:` (the advanced filter
 *  builder's synthetic field ids use it as a namespace separator — `custom:<key>` must
 *  split unambiguously) and nothing that reads as an attempt to name a JSON/SQL
 *  special key. Shared between the client (inline validation feedback) and the server
 *  (custom-props.ts — the actual boundary). */
export const CUSTOM_PROP_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9 _-]{0,49}$/;

/** One item-specific property NOT defined by its category — see
 *  lib/server/resources/custom-props.ts's own header for why this is a separate
 *  concept from CategoryFieldDto, not a weakened version of it. `type` is stored
 *  explicitly, never re-guessed from the value at read time. */
export const CustomPropDto = z.object({
  type: CustomPropTypeSchema,
  value: ItemPropValue,
});
export type CustomPropDto = z.infer<typeof CustomPropDto>;

export const CustomProps = z.record(z.string(), CustomPropDto);
export type CustomProps = z.infer<typeof CustomProps>;

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
  /** The stored status only — never IMPAIRED. Editing writes this one. */
  status: ItemStatusSchema,
  /** Derived, bottom-up (lib/domain/status.ts), computed over the whole containment
   *  forest server-side and never itself writable — what a status chip renders. */
  effectiveStatus: EffectiveStatusSchema,
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
  /** true when this row is present only because ItemScopeService closed the scoped
   *  set over its ancestors — the caller does not own/hold/custody it directly, only
   *  sees it as the container of something they do. Read-only: never a write target. */
  readOnlyContext: z.boolean(),
});
export type ItemRowDto = z.infer<typeof ItemRowDto>;

/** One candidate destination from `GET /resources/items/containers` — the shape
 *  AddModal's "Into", the register toolbar's "Move to…", and Inspector's parent
 *  picker all render the SAME picker from. Deliberately not `ItemRowDto`: a picker
 *  needs only enough to label and order an option, not a full scoped row (status,
 *  custody, thumbnails, ...), and the set returned is already filtered server-side to
 *  destinations that are simultaneously in scope, placement-legal for the category
 *  being placed, and write-eligible — nothing about "why" needs to reach the client. */
export const ContainerOptionDto = z.object({
  id: z.string(),
  name: z.string(),
  categoryId: z.string(),
  categoryName: z.string(),
  categoryIconKey: z.string(),
  /** Slash-joined names from the containment root down to (not including) this row —
   *  same shape as ItemRowDto.path, for the same "where is this, exactly" purpose. */
  path: z.array(z.string()),
});
export type ContainerOptionDto = z.infer<typeof ContainerOptionDto>;

/** A candidate TRANSFER destination — `GET /resources/transfers/destinations`.
 *  Deliberately not `ContainerOptionDto`: that picker is scoped to destinations the
 *  caller could already write into (their own custody); this one is the opposite —
 *  a destination is only interesting here BECAUSE it sits outside the requester's own
 *  custody, so it carries the owning department's name (`orgNodeName`) to say whose
 *  approval a transfer there would need, and nothing about write-eligibility. */
export const TransferDestinationDto = z.object({
  id: z.string(),
  name: z.string(),
  categoryId: z.string(),
  categoryName: z.string(),
  categoryIconKey: z.string(),
  path: z.array(z.string()),
  orgNodeId: z.string(),
  orgNodeName: z.string(),
});
export type TransferDestinationDto = z.infer<typeof TransferDestinationDto>;

export const ItemDetailDto = ItemRowDto.extend({
  images: z.array(ItemImageDto),
  /** Item-specific properties this ONE item carries beyond its category's own
   *  fields — Inspector-only (not on the row list; the table's Specs cell stays
   *  category fields only), keyed the same way `props` is. */
  customProps: CustomProps,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ItemDetailDto = z.infer<typeof ItemDetailDto>;

// ── The one write door ──────────────────────────────────────────────────

const Base = z.object({
  note: z.string().optional(),
  /** Item id → the version the caller last saw it at (typically captured when an
   *  editor opened, or when a row was last read). Checked against the live row
   *  before anything commits; any mismatch refuses the WHOLE change with 409
   *  VERSION_CONFLICT rather than applying part of it — the same whole-refusal
   *  discipline categories.ts's own `expectedVersion` check already uses, extended
   *  to bulk edits via a map rather than a single number. Omitted entirely (or an id
   *  left out of the map) means "don't check this one" — a fresh createItem has
   *  nothing to compare against, and not every caller needs the guard. */
  expectedVersions: z.record(z.string(), z.number().int()).optional(),
});

export const CreateItemChange = Base.extend({
  kind: z.literal("createItem"),
  parentId: z.string().nullable(),
  categoryId: z.string(),
  count: z.number().int().min(1),
  ownerOrgNodeId: z.string().optional(),
  currentOrgNodeId: z.string().optional(),
  custodianId: z.string().optional(),
  /** A custom name in place of the category's own auto-numbered default ("Lab 01",
   *  "Lab 02", …) — most useful when `count` is 1 (a lab is worth naming), still
   *  applied as the numbering base when `count` is more than 1. Blank/omitted keeps
   *  the existing auto-naming unchanged. */
  name: z.string().trim().min(1).optional(),
  /** The category's own fields, filled in at creation time instead of via a
   *  follow-up edit — the same `Item.props` shape `setProperty` writes, validated
   *  the same way (`category-props.ts`'s `buildCategoryPropsSchema`). Applied only
   *  to the root item(s) being created, never to a template's auto-generated
   *  children (those keep their normal blank start, same as before this existed). */
  props: ItemProps.optional(),
  /** Item-specific fields supplied while creating the resource. They are validated
   *  by the same custom-property rules used by `addCustomProperty` (safe keys,
   *  typed values, and no collisions with category fields or one another) and are
   *  copied to every root item in a multi-create batch. Template children keep their
   *  own empty custom-property bag. */
  customProps: CustomProps.optional(),
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

/** Creates a NEW custom property on one item — refused if the key is already in use,
 *  either as another custom property on this item or as a field this item's category
 *  already defines (lib/server/resources/custom-props.ts's own collision check). */
export const AddCustomPropertyChange = Base.extend({
  kind: z.literal("addCustomProperty"),
  itemIds: z.array(z.string()).length(1),
  key: z.string().regex(CUSTOM_PROP_KEY_PATTERN, "Use letters, numbers, spaces, - or _, starting with a letter."),
  type: CustomPropTypeSchema,
  value: ItemPropValue,
});

/** Edits the VALUE of an existing custom property — type stays whatever it was
 *  created with; `value: null` is how a value is cleared without removing the key
 *  (see removeCustomProperty for that). */
export const SetCustomPropertyChange = Base.extend({
  kind: z.literal("setCustomProperty"),
  itemIds: z.array(z.string()).length(1),
  key: z.string().min(1),
  value: ItemPropValue,
});

export const RemoveCustomPropertyChange = Base.extend({
  kind: z.literal("removeCustomProperty"),
  itemIds: z.array(z.string()).length(1),
  key: z.string().min(1),
});

/** What creating an upload session hands back — the server-generated, opaque
 *  reference the client uploads bytes to and later names in `addImage`. Never a
 *  storage path or key the client could redirect elsewhere. */
export const UploadSessionDto = z.object({
  uploadSessionId: z.string(),
  uploadUrl: z.string(),
  expiresAt: z.string(),
});
export type UploadSessionDto = z.infer<typeof UploadSessionDto>;

/** Finalizes a two-step upload — `uploadSessionId` references a server-verified
 *  `ImageUpload` row (lib/server/resources/images.ts), never a client-chosen
 *  `storageKey`/`contentType`/`byteSize`/`width`/`height` directly. mutate.ts's
 *  `applyAddImage` is the only place those facts get copied into the real
 *  `ItemImage` row, and it copies them from the session, never from this input. */
export const AddImageChange = Base.extend({
  kind: z.literal("addImage"),
  itemIds: z.array(z.string()).length(1),
  uploadSessionId: z.string(),
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
  AddCustomPropertyChange,
  SetCustomPropertyChange,
  RemoveCustomPropertyChange,
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

/** One row of the GLOBAL change log (changes.ts's `browse`) — `ItemChangeDto` plus
 *  what the client needs to render a deleted target sensibly instead of a broken
 *  link: whether `itemId` still names a live item, and the category's current name
 *  (resolved live, for display — `itemName` stays the authoritative snapshot). */
export const ChangeLogEntryDto = ItemChangeDto.extend({
  itemExists: z.boolean(),
  categoryName: z.string().nullable(),
});
export type ChangeLogEntryDto = z.infer<typeof ChangeLogEntryDto>;

export const ChangeLogPageDto = z.object({
  entries: z.array(ChangeLogEntryDto),
  total: z.number().int(),
});
export type ChangeLogPageDto = z.infer<typeof ChangeLogPageDto>;

// ── Dashboard-shaped read (items.ts's summary()) ────────────────────────

export const ItemSummaryBreakdownDto = z.object({
  key: z.string(),
  label: z.string(),
  total: z.number().int(),
  byEffectiveStatus: z.record(EffectiveStatusSchema, z.number().int()),
});
export type ItemSummaryBreakdownDto = z.infer<typeof ItemSummaryBreakdownDto>;

export const ItemSummaryDto = z.object({
  total: z.number().int(),
  byEffectiveStatus: z.record(EffectiveStatusSchema, z.number().int()),
  needsAttention: z.number().int(),
  /** The same genuine-match set as `total`, sliced by the dimensions used by the
   *  live dashboard charts. Labels are resolved server-side so charts never need a
   *  second unscoped name lookup. */
  breakdowns: z.object({
    owner: z.array(ItemSummaryBreakdownDto),
    currentOrg: z.array(ItemSummaryBreakdownDto),
    location: z.array(ItemSummaryBreakdownDto),
    custodian: z.array(ItemSummaryBreakdownDto),
    category: z.array(ItemSummaryBreakdownDto),
  }),
});
export type ItemSummaryDto = z.infer<typeof ItemSummaryDto>;

// z.record's keys are never required to be present — this named list is what a
// caller iterates when it wants a zero-filled row for a status nothing currently has.
export const EFFECTIVE_STATUS_LIST = effectiveStatuses;
