/**
 * Placement — two kinds of category:
 *  - a PLACE (a lab, workshop, studio or store) is top level only — it never sits
 *    inside anything;
 *  - a THING goes into any place, or inside a thing whose parts ("Made of") include it
 *    — RAM listed as a part of Motherboard may go into a motherboard; a new kind of
 *    thing with no such parent goes into labs and stores only. Never at the top level.
 * Containers stay unlimited in capacity; this is only about which kind may go where.
 */
import type { Category } from "./types";

/**
 * May an item of `childCategoryId` be placed directly inside `parentCategoryId` — or,
 * if `parentCategoryId` is `null`, be a top-level place? Pure, no database access:
 * called from mutate.ts's write path (the authority) and from pickers (usability).
 */
export function canPlace(categories: Record<string, Category>, childCategoryId: string, parentCategoryId: string | null): boolean {
  const child = categories[childCategoryId];
  if (!child) return false;
  if (parentCategoryId === null) return child.isPlace ?? false;
  if (child.isPlace) return false;
  const parent = categories[parentCategoryId];
  if (!parent) return false;
  return (parent.isPlace ?? false) || parent.defaultChildren.some((c) => c.categoryId === childCategoryId);
}
