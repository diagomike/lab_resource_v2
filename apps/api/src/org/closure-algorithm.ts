/**
 * Pure BFS over the org edge set — no Prisma/NestJS dependency, so it is directly
 * unit-testable and reusable from the seed script.
 *
 * Carried over unchanged from the sister feedback system, where it is already proven
 * against ASTU's real multi-parent structure.
 */

export interface ClosureEdge {
  parentId: string;
  childId: string;
}

export interface ClosureRow {
  ancestorId: string;
  descendantId: string;
  depth: number;
}

/**
 * For every node, BFS outward over `edges` and record the shortest depth to each
 * reachable node (including itself at depth 0). A node may have multiple parents (this is
 * a DAG) — when several paths reach the same descendant, the minimum depth wins.
 */
export function computeClosureRows(nodeIds: string[], edges: ClosureEdge[]): ClosureRow[] {
  const childrenOf = new Map<string, string[]>();
  for (const edge of edges) {
    const list = childrenOf.get(edge.parentId) ?? [];
    list.push(edge.childId);
    childrenOf.set(edge.parentId, list);
  }

  const rows: ClosureRow[] = [];

  for (const root of nodeIds) {
    const depthOf = new Map<string, number>([[root, 0]]);
    const queue: string[] = [root];
    let head = 0;
    while (head < queue.length) {
      const current = queue[head++];
      const currentDepth = depthOf.get(current)!;
      for (const child of childrenOf.get(current) ?? []) {
        if (!depthOf.has(child)) {
          depthOf.set(child, currentDepth + 1);
          queue.push(child);
        }
      }
    }
    for (const [descendantId, depth] of depthOf) {
      rows.push({ ancestorId: root, descendantId, depth });
    }
  }

  return rows;
}

/**
 * True when adding parent→child would create a cycle, i.e. when `parent` is already
 * reachable from `child`. The org hierarchy is a DAG: multiple parents are fine, loops
 * are not, and a loop would make closure recomputation non-terminating in the general
 * case and permissions meaningless in every case.
 */
export function wouldCreateCycle(edges: ClosureEdge[], parentId: string, childId: string): boolean {
  if (parentId === childId) return true;
  const childrenOf = new Map<string, string[]>();
  for (const edge of edges) {
    const list = childrenOf.get(edge.parentId) ?? [];
    list.push(edge.childId);
    childrenOf.set(edge.parentId, list);
  }
  const seen = new Set<string>([childId]);
  const queue = [childId];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    if (current === parentId) return true;
    for (const next of childrenOf.get(current) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}
