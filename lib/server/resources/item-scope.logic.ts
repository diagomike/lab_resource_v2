import type { Prisma } from "@prisma/client";

/**
 * The pure predicate half of ItemScopeService — deciding WHICH ITEMS a user may see,
 * given the reach ScopeService/custody resolution has already computed.
 *
 * THIS IS THE HIGHEST-RISK LOGIC IN THE RESOURCE MODULE, same reasoning as
 * ../org/scope.service.ts's own header: every item query must filter through
 * `visibleItemWhere` (item-scope.service.ts), and nobody re-derives a scope predicate
 * at a call site "just for this one query". Kept pure and separate from Prisma/Nest so
 * it is directly unit-testable against fixtures, same discipline as
 * ../org/closure-algorithm.ts.
 *
 * An item belongs to a unit if EITHER end of the accountability split says so — owner
 * alone would hide a borrowed computer from the lab currently holding it; current
 * alone would hide it from the department that still owns it and will want it back.
 *
 * Custody scope is separate and narrower than org reach: a custodian's homeNodeId is
 * the WHOLE department, so org reach alone would hand a lab assistant every lab in it.
 * `custodyItemIds` (item ids the caller is custodian of, plus everything transitively
 * contained within them — resolved by item-scope.service.ts via a recursive query) is
 * what makes "a lab assistant sees only his lab" possible at all.
 */
export interface ItemScopeInput {
  /** SYS_ADMIN / PROPERTY_ADMIN / PROCUREMENT — university-wide by role. */
  hasGlobalReach: boolean;
  /**
   * Set only for a CUSTODIAN who does not also hold MANAGER — custody is checked
   * before org-wide management reach on purpose: someone who is both a custodian and
   * a head is answering for their own lab first. `null` means "not custody-scoped";
   * an empty array means "custodian of nothing", which must still narrow to zero
   * rows, not fall through to org reach.
   */
  custodyItemIds: string[] | null;
  /** Org node ids this user can reach — from ScopeService.visibleNodeIds. */
  visibleNodeIds: string[];
}

/** Never matches any row — the "no reach at all" case (a student, an unscoped role). */
export const NO_ITEMS_WHERE: Prisma.ItemWhereInput = { id: { in: [] } };

export function buildItemScopeWhere(input: ItemScopeInput): Prisma.ItemWhereInput {
  if (input.hasGlobalReach) return {};

  if (input.custodyItemIds !== null) {
    return { id: { in: input.custodyItemIds } };
  }

  if (input.visibleNodeIds.length === 0) return NO_ITEMS_WHERE;

  return {
    OR: [
      { ownerOrgNodeId: { in: input.visibleNodeIds } },
      { currentOrgNodeId: { in: input.visibleNodeIds } },
    ],
  };
}
