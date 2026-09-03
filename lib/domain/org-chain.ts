/**
 * A pure ancestor-index over an already-loaded snapshot of the org chart — the raw
 * material the approval chain builder (approvals.ts) walks upward from an owning or
 * receiving unit.
 *
 * This is NOT ported from temp_works/src/lib/org.ts wholesale — that file's
 * `visibleNodeIds`/`ownNodeId`/`GLOBAL_ROLES` genuinely duplicate
 * lib/server/org/scope.ts's ScopeService and stay rejected (see
 * ~/.claude/plans/wait-i-want-gentle-haven.md). But `indexOrg`/`ancestorsOf` are a
 * different, narrower thing: a closure computation over `parentIds`, which is exactly
 * what lib/server/org/closure-algorithm.ts's `computeClosureRows` already is (same BFS,
 * same {ancestorId, descendantId, depth} row shape) — already ported, already tested.
 * Rather than re-deriving that BFS a second time, this module is a thin adapter on top
 * of it, giving approvals.ts the same `OrgIndex`/`ancestorsOf` contract temp_works wrote
 * against, so that port stays essentially verbatim at the algorithm level.
 */
import { computeClosureRows } from "@/lib/server/org/closure-algorithm";
import type { OrgNode } from "./types";

export interface OrgChainIndex {
  byId: Map<string, OrgNode>;
  /** ancestorId → descendantId → depth. */
  descendants: Map<string, Map<string, number>>;
  /** descendantId → ancestorId → depth. The approval walk, in one lookup. */
  ancestors: Map<string, Map<string, number>>;
}

export function indexOrgChain(nodes: OrgNode[]): OrgChainIndex {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = nodes.flatMap((n) => n.parentIds.map((parentId) => ({ parentId, childId: n.id })));
  const rows = computeClosureRows(nodes.map((n) => n.id), edges);

  const descendants = new Map<string, Map<string, number>>();
  const ancestors = new Map<string, Map<string, number>>();
  for (const row of rows) {
    let d = descendants.get(row.ancestorId);
    if (!d) descendants.set(row.ancestorId, (d = new Map()));
    d.set(row.descendantId, row.depth);

    let a = ancestors.get(row.descendantId);
    if (!a) ancestors.set(row.descendantId, (a = new Map()));
    a.set(row.ancestorId, row.depth);
  }
  return { byId, descendants, ancestors };
}

/**
 * Every office above a node, nearest first — the raw material of an approval chain.
 *
 * Depth 0 (the node itself) is dropped: a unit is never asked to approve its own
 * request. Ties at equal depth are ordered by name so the result is deterministic, and
 * BOTH are genuine steps — a department reporting to two colleges needs both, not a
 * choice between them.
 */
export function ancestorsOfChain(nodeId: string, index: OrgChainIndex): Array<{ node: OrgNode; depth: number }> {
  const rows = index.ancestors.get(nodeId);
  if (!rows) return [];
  const out: Array<{ node: OrgNode; depth: number }> = [];
  for (const [ancestorId, depth] of rows) {
    if (depth === 0) continue;
    const node = index.byId.get(ancestorId);
    if (node?.active) out.push({ node, depth });
  }
  return out.sort((a, b) => a.depth - b.depth || a.node.name.localeCompare(b.node.name));
}
