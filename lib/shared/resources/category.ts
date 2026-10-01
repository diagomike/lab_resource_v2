/**
 * A category is the SCHEMA for a kind of resource: its typed fields, its counting mode,
 * its impairment rule, and its default subtree. Named ResourceCategory (matching the
 * Prisma model), not Category, so it never collides with a catalog/procurement
 * "category" a later module might want.
 */
import { z } from "zod";
import { BookingModeSchema, CategoryFieldTypeSchema, CountingModeSchema, ImpairRuleSchema } from "./enums";
import { ItemPropValue } from "./item";

export const CategoryGroupDto = z.object({
  id: z.string(),
  name: z.string(),
  sortOrder: z.number().int(),
});
export type CategoryGroupDto = z.infer<typeof CategoryGroupDto>;

/** Group names are a managed vocabulary, not free text — normalized (trimmed) and
 *  checked case-insensitively unique server-side so "IT"/"I.T."/"it" cannot become
 *  three shelves for the same thing. */
export const CreateCategoryGroupInput = z.object({ name: z.string().trim().min(1).max(160) });
export type CreateCategoryGroupInput = z.infer<typeof CreateCategoryGroupInput>;

/** Renaming preserves the group's id, so every category filed under it stays filed
 *  under it — this is a name change only, never a re-key. */
export const RenameCategoryGroupInput = z.object({ name: z.string().trim().min(1).max(160) });
export type RenameCategoryGroupInput = z.infer<typeof RenameCategoryGroupInput>;

/** One "defined metric" on a category: Computer has model, serial, brand, type. */
export const CategoryFieldDto = z.object({
  id: z.string(),
  key: z.string(),
  label: z.string(),
  type: CategoryFieldTypeSchema,
  options: z.array(z.string()),
  unit: z.string().nullable(),
  /** Shown in the table's compact "Specs" cell. Everything shows in the inspector. */
  summary: z.boolean(),
  /** Render as a multi-line block in the inspector — descriptions, procedures. */
  longText: z.boolean(),
  required: z.boolean(),
  sortOrder: z.number().int(),
  /** A short example shown in the empty input ("e.g. 64-17-5"). */
  hint: z.string().nullable(),
});
export type CategoryFieldDto = z.infer<typeof CategoryFieldDto>;

/** A slot in a category's default subtree: Computer contains 1 Motherboard, 2 Speakers. */
export const CategoryTemplateChildDto = z.object({
  id: z.string(),
  childCategoryId: z.string(),
  childCategoryName: z.string(),
  qty: z.number().int().min(1),
  /** Does this child breaking break its parent? Monitor yes, Speaker no. */
  critical: z.boolean(),
});
export type CategoryTemplateChildDto = z.infer<typeof CategoryTemplateChildDto>;

export const ResourceCategoryDto = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  iconKey: z.string(),
  groupId: z.string(),
  groupName: z.string(),
  countingMode: CountingModeSchema,
  unit: z.string().nullable(),
  impairRule: ImpairRuleSchema,
  defaultImageKey: z.string().nullable(),
  version: z.number().int(),
  active: z.boolean(),
  /** A place (a lab, workshop, studio or store): top level only (lib/domain/placement.ts). */
  isPlace: z.boolean(),
  /** Scheduling (Track 6): may items of this category be booked, and as what. */
  bookingMode: BookingModeSchema,
  /** Public portal (Track 7): does its working count appear on the public catalog. */
  publicListed: z.boolean(),
  /** What it is for, in a sentence. */
  description: z.string().nullable(),
  /** The department that looks after it; null: university-wide (Property Administration). */
  stewardNodeId: z.string().nullable(),
  stewardName: z.string(),
  createdById: z.string().nullable(),
  createdByName: z.string().nullable(),
  /** Changes to it waiting for approval. */
  pendingChanges: z.number().int(),
  fields: z.array(CategoryFieldDto),
  templateChildren: z.array(CategoryTemplateChildDto),
});
export type ResourceCategoryDto = z.infer<typeof ResourceCategoryDto>;

/** F-030: display names are trimmed and bounded; the key is a stable slug that seeds/imports
 *  target, so it may not contain spaces or punctuation. `iconKey` is checked against the
 *  icon registry server-side (categories.ts) — this file stays free of lucide imports. */
const categoryName = z.string().trim().min(1, "Name is required").max(160, "Name must be at most 160 characters");
const categoryKey = z.string().trim().regex(/^[a-z][a-z0-9-]{1,40}$/, "Key: 2-41 chars, lowercase letters, digits and -, starting with a letter");
const description = z.string().trim().max(400, "Keep the description under 400 characters");

/** `key` is a detail's identity: an existing detail sends the key it has; a new one sends
 *  none and is given one from its label (categories.ts). People never see keys. */
const CategoryFieldInput = z.object({
  key: z.string().min(1).optional(),
  label: z.string().trim().min(1, "Every detail needs a name").max(80),
  type: CategoryFieldTypeSchema,
  options: z.array(z.string()).default([]),
  unit: z.string().optional(),
  summary: z.boolean().default(false),
  longText: z.boolean().default(false),
  required: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
  hint: z.string().trim().max(60).nullable().optional(),
});

const CategoryTemplateChildInput = z.object({
  childCategoryId: z.string(),
  qty: z.number().int().min(1),
  critical: z.boolean().default(false),
});

export const CreateCategoryInput = z.object({
  /** Given by seeds and imports; otherwise made from the name. */
  key: categoryKey.optional(),
  name: categoryName,
  description: description.optional(),
  iconKey: z.string().min(1),
  groupId: z.string(),
  countingMode: CountingModeSchema,
  unit: z.string().optional(),
  impairRule: ImpairRuleSchema.default("ANY_CRITICAL"),
  isPlace: z.boolean().default(false),
  /** Optional rather than defaulted, so existing callers composing this type need not
   *  name them — categories.ts applies NOT_BOOKABLE / false. */
  bookingMode: BookingModeSchema.optional(),
  publicListed: z.boolean().optional(),
  fields: z.array(CategoryFieldInput).default([]),
  templateChildren: z.array(CategoryTemplateChildInput).default([]),
});
export type CreateCategoryInput = z.infer<typeof CreateCategoryInput>;

/**
 * A whole-object write, refused (not merged) against a stale `expectedVersion` — a
 * category edit reaches every item filed under it, so two concurrent editors must not
 * silently combine their changes. `purgeKeys` is explicit and opt-in: removing a field
 * from the schema strands its values by default (dormant, not deleted), and only a
 * named purge deletes them, with its own audit line.
 */
export const UpdateCategoryInput = z.object({
  expectedVersion: z.number().int(),
  /** The stable key seeds/imports target — editable (categories.ts checks it stays
   *  unique), but changing it does not touch any Item row: Item.categoryId is a cuid
   *  FK, never the key. */
  key: categoryKey.optional(),
  name: categoryName.optional(),
  iconKey: z.string().min(1).optional(),
  groupId: z.string().optional(),
  countingMode: CountingModeSchema.optional(),
  unit: z.string().nullable().optional(),
  impairRule: ImpairRuleSchema.optional(),
  isPlace: z.boolean().optional(),
  bookingMode: BookingModeSchema.optional(),
  publicListed: z.boolean().optional(),
  fields: z.array(CategoryFieldInput).optional(),
  templateChildren: z.array(CategoryTemplateChildInput).optional(),
  active: z.boolean().optional(),
  description: description.nullable().optional(),
  /** Details whose leftover values (unreadable as a new type, a removed choice, a removed
   *  detail) are erased instead of kept on each item as an extra detail. */
  purgeKeys: z.array(z.string()).default([]),
  /** A value to fill into the items that have none, by detail key (a detail becoming required). */
  fills: z.record(z.string(), ItemPropValue).default({}),
  /** Where a removed choice's values go, by detail key then old option: a remaining
   *  option, or null to keep them as an extra detail. */
  optionMoves: z.record(z.string(), z.record(z.string(), z.string().nullable())).default({}),
  note: z.string().optional(),
});
export type UpdateCategoryInput = z.infer<typeof UpdateCategoryInput>;

/** What a pending category edit would actually do, computed server-side before the
 *  edit is committed — the blast-radius preview (lib/domain/edit-impact.ts). `title`
 *  and `detail` stay separate (not flattened into one `message`) so the Category
 *  Studio can render them the way lib/domain/edit-impact.ts's own header describes:
 *  a bold claim plus a counted, actionable detail. `orphanKeys` names which stored
 *  property keys this specific note would strand — the union of every note's
 *  `orphanKeys` is what the purge checkbox offers to erase, explicit and opt-in. */
export const CategoryImpactNote = z.object({
  id: z.string(),
  severity: z.enum(["info", "warning", "destructive"]),
  title: z.string(),
  detail: z.string(),
  orphanKeys: z.array(z.string()).default([]),
  /** A few of the values concerned: “B528-RG16” on Software Lab 8. */
  examples: z.array(z.string()).default([]),
  /** A choice being removed while items use it — the editor asks where its values go. */
  optionMove: z.object({ key: z.string(), label: z.string(), option: z.string(), count: z.number().int(), options: z.array(z.string()) }).optional(),
  /** A detail becoming required while items lack it — the editor offers to fill them. */
  fill: z.object({ key: z.string(), label: z.string(), count: z.number().int(), type: CategoryFieldTypeSchema, options: z.array(z.string()) }).optional(),
});
export type CategoryImpactNote = z.infer<typeof CategoryImpactNote>;

/** Who decides this edit (lib/domain/category-governance.ts). */
export const CategoryEditDecisionDto = z.object({
  /** It applies when saved; otherwise it waits for `approvers`. */
  applies: z.boolean(),
  /** How it changes data items hold; empty when it only adds. */
  reasons: z.array(z.string()),
  /** Who must approve, in order ("Head, Computer Science and Engineering", "the admin"…). */
  approvers: z.array(z.string()),
  /** Other units whose items it reaches. */
  reaches: z.array(z.string()),
});
export type CategoryEditDecisionDto = z.infer<typeof CategoryEditDecisionDto>;

export const CategoryImpactDto = z.object({
  affectedItemCount: z.number().int(),
  notes: z.array(CategoryImpactNote),
  decision: CategoryEditDecisionDto,
});
export type CategoryImpactDto = z.infer<typeof CategoryImpactDto>;

export const categoryChangeStages = ["HEAD", "ADMIN", "PROPERTY_ADMIN"] as const;
export const categoryChangeStatuses = ["PENDING", "APPROVED", "REJECTED", "WITHDRAWN", "STALE"] as const;

export const CategoryChangeDto = z.object({
  id: z.string(),
  categoryId: z.string(),
  categoryName: z.string(),
  categoryIconKey: z.string(),
  proposedById: z.string(),
  proposedByName: z.string(),
  unitName: z.string().nullable(),
  summary: z.array(z.string()),
  reaches: z.array(z.string()),
  stages: z.array(z.enum(categoryChangeStages)),
  stage: z.enum(categoryChangeStages),
  status: z.enum(categoryChangeStatuses),
  note: z.string().nullable(),
  /** Who must decide now, in words. */
  waitingOn: z.string(),
  trail: z.array(z.object({ stage: z.enum(categoryChangeStages), byName: z.string(), at: z.string(), approved: z.boolean(), note: z.string().nullable() })),
  createdAt: z.string(),
  /** The viewer decides it now. */
  canDecide: z.boolean(),
  isMine: z.boolean(),
});
export type CategoryChangeDto = z.infer<typeof CategoryChangeDto>;

export const CategoryChangesDto = z.object({ waiting: z.array(CategoryChangeDto), mine: z.array(CategoryChangeDto) });
export type CategoryChangesDto = z.infer<typeof CategoryChangesDto>;

export const DecideCategoryChangeInput = z.object({ approve: z.boolean(), note: z.string().trim().max(500).optional() });
export type DecideCategoryChangeInput = z.infer<typeof DecideCategoryChangeInput>;

/** Saving an edit: it applied, or it waits for approval. */
export const SaveCategoryResultDto = z.object({
  status: z.enum(["APPLIED", "PENDING"]),
  category: ResourceCategoryDto,
  change: CategoryChangeDto.nullable(),
  /** What happened, in a sentence for the person who saved. */
  notice: z.string(),
});
export type SaveCategoryResultDto = z.infer<typeof SaveCategoryResultDto>;
