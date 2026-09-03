/**
 * Would adding these child slots to `parentId` create a cycle in the category
 * template graph? A cycle here is worse than a org-edge cycle (closure-algorithm.ts's
 * `wouldCreateCycle`) — it does not just corrupt a report, it makes
 * lib/domain/instantiate.ts's `buildSubtree` recurse toward its `depth > 10` cutoff
 * on every future "Add N × Category" and truncate silently rather than fail loudly.
 * Pure, no Prisma import — the caller (categories.ts) loads the current template-edge
 * table and passes it in.
 */
export interface TemplateEdge {
  parentCategoryId: string;
  childCategoryId: string;
}

export function wouldCreateTemplateCycle(edges: TemplateEdge[], parentId: string, proposedChildIds: string[]): boolean {
  // Every OTHER category's existing edges, plus parentId's proposed set replacing
  // whatever it already had (this is always a whole-list replace — see categories.ts).
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (e.parentCategoryId === parentId) continue;
    const arr = adj.get(e.parentCategoryId);
    if (arr) arr.push(e.childCategoryId);
    else adj.set(e.parentCategoryId, [e.childCategoryId]);
  }

  for (const start of proposedChildIds) {
    if (start === parentId) return true; // direct self-reference
    const seen = new Set<string>();
    const stack = [start];
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === parentId) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const next of adj.get(cur) ?? []) stack.push(next);
    }
  }
  return false;
}
