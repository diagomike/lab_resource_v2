/**
 * What an administrator hands to a kind of person — authored the way a category is:
 * named, saved, and assigned to an audience. Answers two questions and no others: WHICH
 * RESOURCES (a ScopeMode, optionally narrowed by a saved filter) and MAY THEY EDIT.
 * Deliberately does not choose columns — those are the same for everyone.
 */
import { z } from "zod";
import { RoleKindSchema } from "../enums";
import { ScopeModeSchema, ViewAudienceTypeSchema } from "./enums";
import { ItemFilterState } from "./item-filter";

export const ViewAudienceDto = z.discriminatedUnion("type", [
  z.object({ type: z.literal("EVERYONE") }),
  z.object({ type: z.literal("ROLE"), role: RoleKindSchema }),
  z.object({ type: z.literal("PERSON"), personId: z.string(), personName: z.string() }),
]);
export type ViewAudienceDto = z.infer<typeof ViewAudienceDto>;

/** The sidebar's access-view picker only ever needs enough to label an option and
 *  show its "read only" badge — not the full authored shape. Part of MeContextDto,
 *  which is on the hot path of every page load. */
export const AccessViewSummaryDto = z.object({
  id: z.string(),
  name: z.string(),
  scope: ScopeModeSchema,
  canEdit: z.boolean(),
});
export type AccessViewSummaryDto = z.infer<typeof AccessViewSummaryDto>;

export const AccessViewDto = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  scope: ScopeModeSchema,
  /** EXPLICIT_NODES only. */
  explicitNodeIds: z.array(z.string()),
  extraFilters: ItemFilterState.nullable(),
  audiences: z.array(ViewAudienceDto),
  /** false = look but do not touch. */
  canEdit: z.boolean(),
  active: z.boolean(),
});
export type AccessViewDto = z.infer<typeof AccessViewDto>;

const ViewAudienceInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("EVERYONE") }),
  z.object({ type: z.literal("ROLE"), role: RoleKindSchema }),
  z.object({ type: z.literal("PERSON"), personId: z.string() }),
]);

export const UpsertAccessViewInput = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  scope: ScopeModeSchema,
  explicitNodeIds: z.array(z.string()).default([]),
  extraFilters: ItemFilterState.optional(),
  audiences: z.array(ViewAudienceInput).min(1),
  canEdit: z.boolean().default(true),
  active: z.boolean().default(true),
});
export type UpsertAccessViewInput = z.infer<typeof UpsertAccessViewInput>;
