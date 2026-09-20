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
    // F-011: null unless the caller is an admin or a manager — a student can see who holds a
    // post, not their mailbox.
    .object({ id: z.string(), name: z.string(), email: z.string().nullable() })
    .nullable(),
  /** Whether this node can be deleted without a blocker — currently just "does anyone
   *  call it home". Grows a term for each lab-management module as it ships (owned
   *  locations, assets, requests, ...), same as org.service.ts's deleteNode. */
  hasOwnedContent: z.boolean(),
  /** Track 2's per-department rollout switch — default false. Read by the admin
   *  toggle in Org Studio; direct editing is unaffected either way for anyone not
   *  using the draft workflow. */
  draftWorkflowEnabled: z.boolean(),
  /** Stable short key ("SE", "PROC"), null if none is set. F-006 of the 2026-09-15
   *  campaign: code, not name, is what purchasing's Procurement Office lookup and any
   *  future "the one office named X" resolution should key on — a rename can't break
   *  it once it's set. */
  code: z.string().nullable(),
});
export type OrgNodeDto = z.infer<typeof OrgNodeDto>;

/** Undefined leaves the code untouched (used by UpdateOrgNodeInput's PATCH
 *  semantics); an empty string explicitly clears it back to null. */
const orgNodeCode = z
  .union([
    z
      .string()
      .trim()
      .min(1)
      .max(20)
      .regex(/^[A-Za-z0-9_-]+$/, "Use letters, digits, - or _ only"),
    z.literal(""),
  ])
  .optional();

/** F-008: a trimmed, bounded display name. Uniqueness among active nodes is checked
 *  server-side (org.ts), inside the same lock as the write. */
const orgNodeName = z.string().trim().min(2, "Name must be at least 2 characters").max(120, "Name must be at most 120 characters");

export const CreateOrgNodeInput = z.object({
  name: orgNodeName,
  level: z.number().int().min(0),
  kind: OrgNodeKindSchema,
  parentIds: z.array(z.string()),
  code: orgNodeCode,
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
  name: orgNodeName.optional(),
  kind: OrgNodeKindSchema.optional(),
  code: orgNodeCode,
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
  /** Required (non-empty) when `level > 0` — a level change invalidates every edge the
   *  node holds in either direction, so its new parents must be supplied in the same
   *  call or the node is left with none (F-005 of the 2026-09-15 campaign). Omit or
   *  leave empty for a move to level 0. */
  parentIds: z.array(z.string()).optional(),
});
export type ChangeNodeLevelInput = z.infer<typeof ChangeNodeLevelInput>;

export const DeactivateNodeResultDto = z.object({
  ok: z.literal(true),
  /** Set when this node had a current occupant — deactivating a node VACATES the
   *  post (2026-09-20, F-001 of the 2026-09-15 campaign) but never disables the
   *  occupant's own account; that stays a Personnel action with its own custody
   *  blocker. */
  vacatedOccupantName: z.string().nullable(),
});
export type DeactivateNodeResultDto = z.infer<typeof DeactivateNodeResultDto>;
