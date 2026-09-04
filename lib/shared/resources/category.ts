/**
 * A category is the SCHEMA for a kind of resource: its typed fields, its counting mode,
 * its impairment rule, and its default subtree. Named ResourceCategory (matching the
 * Prisma model), not Category, so it never collides with a catalog/procurement
 * "category" a later module might want.
 */
import { z } from "zod";
import { CategoryFieldTypeSchema, CountingModeSchema, ImpairRuleSchema } from "./enums";

export const CategoryGroupDto = z.object({
  id: z.string(),
  name: z.string(),
  sortOrder: z.number().int(),
});
export type CategoryGroupDto = z.infer<typeof CategoryGroupDto>;

/** Group names are a managed vocabulary, not free text — normalized (trimmed) and
 *  checked case-insensitively unique server-side so "IT"/"I.T."/"it" cannot become
 *  three shelves for the same thing. */
export const CreateCategoryGroupInput = z.object({ name: z.string().min(1) });
export type CreateCategoryGroupInput = z.infer<typeof CreateCategoryGroupInput>;

/** Renaming preserves the group's id, so every category filed under it stays filed
 *  under it — this is a name change only, never a re-key. */
export const RenameCategoryGroupInput = z.object({ name: z.string().min(1) });
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
  fields: z.array(CategoryFieldDto),
  templateChildren: z.array(CategoryTemplateChildDto),
});
export type ResourceCategoryDto = z.infer<typeof ResourceCategoryDto>;

const CategoryFieldInput = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: CategoryFieldTypeSchema,
  options: z.array(z.string()).default([]),
  unit: z.string().optional(),
  summary: z.boolean().default(false),
  longText: z.boolean().default(false),
  required: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
});

const CategoryTemplateChildInput = z.object({
  childCategoryId: z.string(),
  qty: z.number().int().min(1),
  critical: z.boolean().default(false),
});

export const CreateCategoryInput = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  iconKey: z.string().min(1),
  groupId: z.string(),
  countingMode: CountingModeSchema,
  unit: z.string().optional(),
  impairRule: ImpairRuleSchema.default("ANY_CRITICAL"),
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
  key: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  iconKey: z.string().min(1).optional(),
  groupId: z.string().optional(),
  countingMode: CountingModeSchema.optional(),
  unit: z.string().nullable().optional(),
  impairRule: ImpairRuleSchema.optional(),
  fields: z.array(CategoryFieldInput).optional(),
  templateChildren: z.array(CategoryTemplateChildInput).optional(),
  active: z.boolean().optional(),
  purgeKeys: z.array(z.string()).default([]),
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
});
export type CategoryImpactNote = z.infer<typeof CategoryImpactNote>;

export const CategoryImpactDto = z.object({
  affectedItemCount: z.number().int(),
  notes: z.array(CategoryImpactNote),
});
export type CategoryImpactDto = z.infer<typeof CategoryImpactDto>;
