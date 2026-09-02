import { z } from "zod";
import { CategoryFieldTypeSchema, CountingModeSchema, ImpairRuleSchema } from "./enums";

export const CategoryGroupDto = z.object({
  id: z.string(),
  name: z.string(),
  sortOrder: z.number().int(),
});
export type CategoryGroupDto = z.infer<typeof CategoryGroupDto>;

/** One typed field a category defines — "a Computer has model, serial, brand, type." */
export const CategoryFieldDto = z.object({
  id: z.string(),
  key: z.string(),
  label: z.string(),
  type: CategoryFieldTypeSchema,
  options: z.array(z.string()), // ENUM only
  unit: z.string().nullable(), // NUMBER only
  /** Shown in the table's compact "Specs" cell. Everything shows in the inspector. */
  summary: z.boolean(),
  /** Render as a multi-line block in the inspector — descriptions, procedures. */
  longText: z.boolean(),
  required: z.boolean(),
  sortOrder: z.number().int(),
});
export type CategoryFieldDto = z.infer<typeof CategoryFieldDto>;

/**
 * The schema for a kind of resource — category-driven properties instead of a table
 * per resource type. Default child templates (CategoryTemplateChild) land with
 * category administration; this DTO grows a `defaultChildren` array then.
 */
export const CategoryDto = z.object({
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
  /** Optimistic concurrency — a category edit reaches every item filed under it. */
  version: z.number().int(),
  active: z.boolean(),
  fields: z.array(CategoryFieldDto),
});
export type CategoryDto = z.infer<typeof CategoryDto>;
