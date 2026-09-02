import { z } from "zod";
import { OrgNodeKindSchema } from "./enums";

/**
 * The unit the signed-in user is acting for, shown in the sidebar and status bar so it is
 * never ambiguous whose register you are looking at.
 *
 * `isGlobal` is true for the Property Administration and Procurement offices, whose reach
 * is the whole university. Those users have no single "own" unit, and the chrome says so
 * rather than showing a misleading node name.
 */
export const ScopeDto = z.object({
  nodeId: z.string().nullable(),
  name: z.string(),
  level: z.number().int(),
  kind: OrgNodeKindSchema.nullable(),
  isLeaf: z.boolean(),
  isGlobal: z.boolean(),
  /** True when the user OCCUPIES this node (a department head, a dean), false when they
   *  merely work in it (a custodian, whose reach comes from homeNodeId).
   *
   *  Both cases now produce a scope — before, a custodian got `scope: null` even though
   *  ScopeService gave them real reach via homeNodeId, which silently broke every page
   *  that branched on it. Callers that specifically mean "the unit I HEAD" (LabsPage's
   *  location ownership, for one) must test this flag, not merely that scope exists. */
  isOccupant: z.boolean(),
  /** How many org nodes this user can reach — 1 for a department head, all of them for
   *  Property Admin. Makes the breadth of a leak immediately visible during testing. */
  reachableNodeCount: z.number().int(),
});
export type ScopeDto = z.infer<typeof ScopeDto>;
