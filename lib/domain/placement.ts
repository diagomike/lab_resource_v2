/**
 * Placement — "not any resource anywhere". A motherboard may go into a computer, or
 * straight into a lab; a lab may not go into another lab. This is deliberately about
 * which KIND of container a category may sit inside, never how many it may hold —
 * containers stay unlimited in capacity by design; there is no capacity concept here
 * at all, and none should be added under this module's name.
 *
 * Default posture is permissive, matching how the rest of this system works: a
 * freshly created category may live inside anything (`placement: "ANYWHERE"`) but may
 * not itself be a root (`canBeRoot: false`) — it must live inside SOMETHING, but that
 * something may be any category. An admin tightens a category deliberately
 * (`ONLY_LISTED` plus an explicit allow-list of the categories it may sit inside);
 * nothing is restrictive by accident.
 *
 * One direction only: a category declares what it may be placed INTO, never what may
 * be placed into IT. Two opposing whitelists would need conflict-resolution rules
 * nobody wants to reason about, and a container's own capacity is already unlimited,
 * so there is nothing for an "accepts" list to usefully restrict on the container's
 * side.
 */
import type { Category } from "./types";

/**
 * May an item of `childCategoryId` be placed directly inside `parentCategoryId` — or,
 * if `parentCategoryId` is `null`, may it be a top-level resource at all? Pure,
 * deterministic, no database access — the same reason `wouldCreateTemplateCycle` and
 * `item-scope.logic.ts`'s predicate are pure: called from `mutate.ts`'s write path
 * (the authority) and from a picker's own filtering (usability only, never the
 * enforcement).
 */
export function canPlace(categories: Record<string, Category>, childCategoryId: string, parentCategoryId: string | null): boolean {
  const child = categories[childCategoryId];
  if (!child) return false;
  if (parentCategoryId === null) return child.canBeRoot ?? false;
  if ((child.placement ?? "ANYWHERE") === "ANYWHERE") return true;
  return (child.allowedParentCategoryIds ?? []).includes(parentCategoryId);
}
