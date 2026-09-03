/**
 * Two small, genuinely reusable pure predicates from temp_works/src/lib/scope.ts —
 * NOT the whole module. `scopedItemIds`/`defaultScopeFor`/`approvalGrantIds` operate
 * over an already-loaded in-memory item array, which is exactly the shape production
 * must NOT take: lib/server/resources/scope.ts (a later phase) becomes a Prisma
 * `where`-clause builder instead, applying scope in SQL before pagination rather than
 * loading everything and filtering in JS — see
 * ~/.claude/plans/wait-i-want-gentle-haven.md's server design section. Porting the
 * whole module here would produce logic that is tested but never actually called by
 * the server that ships.
 *
 * `unitsOf`/`withAncestors` are different: genuinely pure, small, and reusable
 * wherever an already-loaded item subtree needs the same reasoning applied in memory
 * — an edit-impact preview, a client-side sanity check, a test.
 */
import type { TreeIndex } from "./tree";
import type { Item } from "./types";

/**
 * An item belongs to a unit if EITHER end of the accountability split says so.
 * Owner alone would hide a borrowed computer from the lab currently holding it;
 * current alone would hide it from the department that still owns it and will want
 * it back.
 */
export function unitsOf(item: Item): string[] {
  const out: string[] = [item.ownerOrgNodeId];
  // currentOrgNodeId is NOT NULL in this schema (see types.ts) — the
  // `item.currentOrgNodeId &&` guard temp_works needed for its nullable pair is a
  // dead-code no-op here, kept only so this reads as the same shape.
  if (item.currentOrgNodeId && item.currentOrgNodeId !== item.ownerOrgNodeId) {
    out.push(item.currentOrgNodeId);
  }
  return out;
}

/**
 * Pull in every ancestor of everything already matched. Scope has to be
 * ancestor-closed or the hierarchy view silently breaks: a visible computer inside
 * an invisible block is a row that can never be reached. Seeing the container you
 * keep something in is also the honest reading of "you may see your own resources"
 * — you see the block, but only your own things inside it.
 */
export function withAncestors(index: TreeIndex, ids: Set<string>): Set<string> {
  const out = new Set(ids);
  for (const id of ids) {
    let current = index.byId.get(id)?.parentId ?? null;
    while (current && !out.has(current)) {
      out.add(current);
      current = index.byId.get(current)?.parentId ?? null;
    }
  }
  return out;
}
