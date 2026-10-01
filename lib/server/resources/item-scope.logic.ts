import type { Prisma } from "@prisma/client";
import type { ScopeMode } from "@/lib/shared";

/**
 * The pure predicate half of ItemScopeService — deciding WHICH ITEMS a user may see,
 * given the reach scope.ts has already resolved. No Prisma client import, no
 * "server-only" — directly unit-testable against fixtures, same discipline as
 * ../org/closure-algorithm.ts and the deleted Phase-1 item-scope.logic.ts this is a
 * direct descendant of.
 *
 * THIS IS THE HIGHEST-RISK LOGIC IN THE RESOURCE MODULE, same reasoning as
 * ../org/scope.ts's own header: every item query must filter through
 * `visibleItemWhere` (scope.ts), and nobody re-derives a scope predicate at a call
 * site "just for this one query".
 *
 * An item belongs to a unit if EITHER end of the accountability split says so — owner
 * alone would hide a borrowed computer from the lab currently holding it; current
 * alone would hide it from the department that still owns it and will want it back
 * (lib/domain/item-scope.ts's `unitsOf`, mirrored here at the SQL predicate level).
 *
 * Three modes, matching lib/shared's ScopeMode:
 *  - UNIVERSITY      — no restriction.
 *  - ORG_SUBTREE     — owner-or-current in the given node id set.
 *  - MY_CUSTODY      — a precomputed item id set (custodianId = self, plus every
 *    descendant, resolved by scope.ts via a recursive query — this module never
 *    walks the tree itself).
 *
 * `extraGrantedIds` (approvalGrantIds, Phase 12) is additive on top of any mode: being
 * asked to approve a change is itself an access grant, independent of whether the
 * resource sits in the approver's own scope.
 */
export interface ItemScopeInput {
  mode: ScopeMode;
  /** ORG_SUBTREE only. */
  visibleNodeIds: string[];
  /** MY_CUSTODY only — the item's own id plus every transitive descendant, already
   *  resolved. `null` is only valid for other modes; MY_CUSTODY always supplies an
   *  array (possibly empty — "custodian of nothing" must still narrow to zero rows,
   *  never fall through to a wider mode). */
  custodyItemIds: string[] | null;
  /** Additive across every mode — ids visible for a reason independent of scope
   *  (an open approval naming this item). Not yet supplied by any caller until
   *  Phase 12; the parameter exists now so that phase is a pure addition. */
  extraGrantedIds?: string[];
}

/** Never matches any row — the "no reach at all" case (a role with no default scope). */
export const NO_ITEMS_WHERE: Prisma.ItemWhereInput = { id: { in: [] } };

export function buildItemScopeWhere(input: ItemScopeInput): Prisma.ItemWhereInput {
  const grant: Prisma.ItemWhereInput[] = input.extraGrantedIds?.length ? [{ id: { in: input.extraGrantedIds } }] : [];

  if (input.mode === "UNIVERSITY") return {};

  if (input.mode === "MY_CUSTODY") {
    const custody = input.custodyItemIds ?? [];
    if (!custody.length && !grant.length) return NO_ITEMS_WHERE;
    return { OR: [{ id: { in: custody } }, ...grant] };
  }

  const nodeIds = input.visibleNodeIds;
  const reach: Prisma.ItemWhereInput[] = nodeIds.length
    ? [{ ownerOrgNodeId: { in: nodeIds } }, { currentOrgNodeId: { in: nodeIds } }]
    : [];
  if (!reach.length && !grant.length) return NO_ITEMS_WHERE;

  return { OR: [...reach, ...grant] };
}
