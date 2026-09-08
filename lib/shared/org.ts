import { z } from "zod";
import { OrgNodeKindSchema } from "./enums";

/**
 * The org hierarchy is a layered DAG: every edge connects a node at level N to one at
 * level N+1 — enforced in org.service.ts. A node can still have more than one parent (a
 * department co-owned by two colleges), but never a parent more than one level up — that
 * constraint is what keeps "what does this node's ancestor chain look like" a single,
 * walkable line instead of an unpredictable graph. Property Administration and Procurement
 * get university-wide reach by ROLE (ScopeService.GLOBAL_ROLES), not by sitting as an extra
 * parent above every department, so neither office needs a cross-level edge to see
 * everything.
 */
export const OrgNodeDto = z.object({
  id: z.string(),
  name: z.string(),
  level: z.number().int(),
  kind: OrgNodeKindSchema,
  active: z.boolean(),
  parentIds: z.array(z.string()),
  occupant: z
    .object({ id: z.string(), name: z.string(), email: z.string() })
    .nullable(),
  /** Whether this node can be deleted without a blocker — currently just "does anyone
   *  call it home". Grows a term for each lab-management module as it ships (owned
   *  locations, assets, requests, ...), same as org.service.ts's deleteNode. */
  hasOwnedContent: z.boolean(),
  /** Track 2's per-department rollout switch — default false. Read by the admin
   *  toggle in Org Studio; direct editing is unaffected either way for anyone not
   *  using the draft workflow. */
  draftWorkflowEnabled: z.boolean(),
});
export type OrgNodeDto = z.infer<typeof OrgNodeDto>;

export const CreateOrgNodeInput = z.object({
  name: z.string().min(1),
  level: z.number().int().min(0),
  kind: OrgNodeKindSchema,
  parentIds: z.array(z.string()),
});
export type CreateOrgNodeInput = z.infer<typeof CreateOrgNodeInput>;

export const CreateOrgEdgeInput = z.object({
  parentId: z.string(),
  childId: z.string(),
});
export type CreateOrgEdgeInput = z.infer<typeof CreateOrgEdgeInput>;

/** Rename and/or re-kind. Active/inactive, reparenting and level all have their own
 *  dedicated endpoints below — each is a bigger-consequence operation than a bare field
 *  PATCH should silently allow. Kind sits here rather than getting its own endpoint like
 *  level does: unlike level, changing kind has no structural side effects — it never
 *  touches edges or the closure table, since kind is purely descriptive (University/
 *  College/Department/Office), not a constraint anything else is validated against. */
export const UpdateOrgNodeInput = z.object({
  name: z.string().min(1).optional(),
  kind: OrgNodeKindSchema.optional(),
});
export type UpdateOrgNodeInput = z.infer<typeof UpdateOrgNodeInput>;

/** Replaces which parent(s) a node reports under — level-adjacency is still enforced
 *  server-side, same as at creation. */
export const ReassignParentsInput = z.object({
  parentIds: z.array(z.string()),
});
export type ReassignParentsInput = z.infer<typeof ReassignParentsInput>;

export const ChangeNodeLevelInput = z.object({
  level: z.number().int().min(0),
});
export type ChangeNodeLevelInput = z.infer<typeof ChangeNodeLevelInput>;

export const DeactivateNodeResultDto = z.object({
  ok: z.literal(true),
  /** Set when this node had a current occupant — deactivating a node revokes them too,
   *  same reasoning as deactivating a person vacating whatever node they held. */
  revokedOccupantName: z.string().nullable(),
});
export type DeactivateNodeResultDto = z.infer<typeof DeactivateNodeResultDto>;
