import "server-only";
import type { CreateOrgNodeInput, DeactivateNodeResultDto, OrgNodeDto, OrgNodeKind, UpdateOrgNodeInput } from "@/lib/shared";
import { prisma } from "../prisma";
import { HttpError } from "../http-error";
import { computeClosureRows, wouldCreateCycle } from "./closure-algorithm";

export async function list(activeOnly: boolean): Promise<OrgNodeDto[]> {
  const nodes = await prisma.orgNode.findMany({
    where: activeOnly ? { active: true } : {},
    include: { user: true, incomingEdges: true, residents: { select: { id: true } } },
    orderBy: [{ level: "asc" }, { name: "asc" }],
  });

  return nodes.map((n) => ({
    id: n.id,
    name: n.name,
    level: n.level,
    kind: n.kind,
    active: n.active,
    parentIds: n.incomingEdges.map((e) => e.parentId),
    occupant: n.user ? { id: n.user.id, name: n.user.name, email: n.user.email } : null,
    // TODO: fold in owned Location/Asset/StockLine/etc. counts once those modules ship.
    hasOwnedContent: n.residents.length > 0,
    draftWorkflowEnabled: n.draftWorkflowEnabled,
  }));
}

export async function create(input: CreateOrgNodeInput): Promise<OrgNodeDto> {
  await assertAdjacentParents(input.level, input.parentIds);
  await assertUniversityInvariant(null, input.level, input.kind);
  const node = await prisma.orgNode.create({
    data: { name: input.name, level: input.level, kind: input.kind },
  });
  for (const parentId of input.parentIds) {
    await addEdge(parentId, node.id, { skipRecompute: true });
  }
  await recomputeClosure();
  return (await list(false)).find((n) => n.id === node.id)!;
}

/** Rename and/or re-kind. Active/inactive, reparenting and level all have their own
 *  dedicated, bigger-consequence endpoints below rather than living behind this bare
 *  field PATCH — kind belongs here because, unlike level, it has no structural side
 *  effects to guard against (see UpdateOrgNodeInput's own note). */
export async function update(id: string, input: UpdateOrgNodeInput): Promise<OrgNodeDto> {
  const node = await prisma.orgNode.findUnique({ where: { id } });
  if (!node) throw new HttpError(404, "Org node not found");
  if (input.kind !== undefined) await assertUniversityInvariant(id, node.level, input.kind);
  await prisma.orgNode.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
    },
  });
  return (await list(false)).find((n) => n.id === id)!;
}

/**
 * Deactivating a node revokes whatever person currently occupies it (disabled, sessions
 * cleared) in the same transaction — the same reasoning people.ts's deactivate() already
 * applies from the person side: a DISABLED user can never sign in again to act on a node,
 * so leaving the occupancy in place would silently stall every approval step and scope
 * query routed through it. History (who held it, what it owns) is untouched — only
 * access and the active flag change.
 */
/**
 * Deactivating a node VACATES its post — it ends the occupancy and clears
 * `OrgNode.userId` — but never touches the occupant's own account (F-001 of the
 * 2026-09-15 campaign). Disabling a person is Personnel's own act
 * (`people.deactivate`), with its own custody blocker; holding a post that no
 * longer exists is not the same fact as being employed, and the previous behaviour
 * here disabled the account (and killed its sessions) unconditionally, with no
 * custody check at all — a head vacated this way could still be custodian of real
 * resources with no way left to sign in and hand them off. History (who held it,
 * what it owns) is untouched — only occupancy and the active flag change.
 */
export async function deactivateNode(id: string): Promise<DeactivateNodeResultDto> {
  const node = await prisma.orgNode.findUnique({
    where: { id },
    include: { user: { select: { id: true, name: true } } },
  });
  if (!node) throw new HttpError(404, "Org node not found");
  if (!node.active) throw new HttpError(400, "This node is already inactive");

  await prisma.$transaction([
    ...(node.userId
      ? [
          prisma.orgNodeAssignment.updateMany({
            where: { nodeId: id, userId: node.userId, endedAt: null },
            data: { endedAt: new Date(), reason: "Node deactivated" },
          }),
        ]
      : []),
    prisma.orgNode.update({ where: { id }, data: { active: false, userId: null } }),
  ]);
  return { ok: true, vacatedOccupantName: node.user?.name ?? null };
}

/** Does not restore the previous occupant — same as people.ts's reactivate(), there is
 *  no "undo"; assign a new one afterward if the node needs one. */
export async function reactivateNode(id: string): Promise<OrgNodeDto> {
  const node = await prisma.orgNode.findUnique({ where: { id } });
  if (!node) throw new HttpError(404, "Org node not found");
  if (node.active) throw new HttpError(400, "This node is already active");
  await prisma.orgNode.update({ where: { id }, data: { active: true } });
  return (await list(false)).find((n) => n.id === id)!;
}

/** Replaces which parent(s) a node reports under. Cycles are structurally impossible
 *  here — assertAdjacentParents forces every edge from level N to N+1, so a node can
 *  never become its own ancestor. */
export async function reassignParents(id: string, parentIds: string[]): Promise<OrgNodeDto> {
  const node = await prisma.orgNode.findUnique({ where: { id } });
  if (!node) throw new HttpError(404, "Org node not found");
  await assertAdjacentParents(node.level, parentIds);

  await prisma.$transaction([
    prisma.orgEdge.deleteMany({ where: { childId: id } }),
    prisma.orgEdge.createMany({ data: parentIds.map((parentId) => ({ parentId, childId: id })) }),
  ]);
  await recomputeClosure();
  return (await list(false)).find((n) => n.id === id)!;
}

/**
 * Moving a node to a different level invalidates every edge it holds in EITHER
 * direction — an edge only means something between two adjacent levels. Nothing is
 * auto-reconnected: the node (and any former children left with no other parent) sits
 * parentless/childless until reassignParents/addEdge redraws its edges. Owned content
 * (assets, requests, everything) is unaffected — it keys off the node's id, not its
 * level or edges.
 */
export async function changeLevel(id: string, newLevel: number): Promise<OrgNodeDto> {
  const node = await prisma.orgNode.findUnique({ where: { id } });
  if (!node) throw new HttpError(404, "Org node not found");
  if (node.level === newLevel) return (await list(false)).find((n) => n.id === id)!;
  await assertUniversityInvariant(id, newLevel, node.kind);

  await prisma.$transaction([
    prisma.orgEdge.deleteMany({ where: { OR: [{ parentId: id }, { childId: id }] } }),
    prisma.orgNode.update({ where: { id }, data: { level: newLevel } }),
  ]);
  await recomputeClosure();
  return (await list(false)).find((n) => n.id === id)!;
}

/**
 * The UNIVERSITY kind and level 0 are the same concept, always — the one root the
 * whole org chart hangs from. Any occupant of a UNIVERSITY-kind node is treated as
 * the institution's own top office (`lib/server/external/requests.ts`'s `isAvp`),
 * so letting a second one exist, or letting the kind and the level drift apart,
 * silently hands out the most sensitive role in the system — F-002 of the
 * 2026-09-15 campaign, which found exactly this: a second level-0 UNIVERSITY node
 * could be created and its occupant treated as a second AVP. `excludeId` is the
 * node being edited, so an update/changeLevel call on the one existing root does
 * not collide with itself.
 */
async function assertUniversityInvariant(excludeId: string | null, level: number, kind: OrgNodeKind): Promise<void> {
  if ((level === 0) !== (kind === "UNIVERSITY")) {
    throw new HttpError(
      400,
      'Level 0 is reserved for the single "University" root — a node at level 0 must be kind University, and a University-kind node must be at level 0.',
    );
  }
  if (level === 0) {
    const existing = await prisma.orgNode.findFirst({ where: { level: 0, ...(excludeId ? { id: { not: excludeId } } : {}) } });
    if (existing) {
      throw new HttpError(400, `"${existing.name}" is already the university root — there can be only one level-0 node.`);
    }
  }
}

/**
 * Real deletion — everywhere else a node's lifecycle ends in deactivateNode, not this.
 * Every blocker is collected and returned together (not thrown on the first hit) so the
 * admin sees everything that needs clearing in one pass, mirroring the sister feedback
 * system's deleteNode. Re-checked here rather than trusted from a possibly-stale client
 * OrgNodeDto.
 *
 * TODO: as each lab-management module ships (Location, Asset, StockLine, procurement,
 * transfers, ...), add its own "owns N of X" blocker here the same way `residents` does.
 */
export async function deleteNode(id: string): Promise<void> {
  const node = await prisma.orgNode.findUnique({ where: { id }, include: { outgoingEdges: true } });
  if (!node) throw new HttpError(404, "Org node not found");

  const blockers: string[] = [];
  if (node.userId) blockers.push("has an occupant — deactivate it first");
  if (node.outgoingEdges.length > 0) blockers.push(`has ${node.outgoingEdges.length} child node(s)`);

  const residents = await prisma.user.count({ where: { homeNodeId: id } });
  if (residents > 0) blockers.push(`is the home department of ${residents} person(s)`);

  // Item.ownerOrgNodeId/currentOrgNodeId are onDelete: Restrict — without these two
  // checks the delete below would still be refused, just as a raw, uncaught Prisma
  // foreign-key error instead of a named blocker like every other one here.
  const owned = await prisma.item.count({ where: { ownerOrgNodeId: id } });
  if (owned > 0) blockers.push(`owns ${owned} resource(s)`);
  const held = await prisma.item.count({ where: { currentOrgNodeId: id, ownerOrgNodeId: { not: id } } });
  if (held > 0) blockers.push(`is currently holding ${held} resource(s) on loan`);

  if (blockers.length > 0) {
    throw new HttpError(400, `Cannot delete "${node.name}" — it ${blockers.join("; ")}`);
  }

  await prisma.$transaction([
    prisma.orgEdge.deleteMany({ where: { OR: [{ parentId: id }, { childId: id }] } }),
    prisma.orgNode.delete({ where: { id } }),
  ]);
  await recomputeClosure();
}

/**
 * Adds a parent→child edge. Multiple parents are still allowed (a department co-owned
 * by two colleges), but only between ADJACENT levels — child.level must be exactly
 * parent.level + 1, same discipline the sister feedback system's HierarchyNode enforces.
 * That single rule is what keeps every node's ancestor chain a walkable straight line
 * instead of an unpredictable graph; Property Administration and Procurement no longer
 * need a cross-level edge to reach every department, since ScopeService already gives
 * them that by role. A cycle is refused too, though adjacency alone already makes one
 * structurally impossible — kept as a second, explicit guard.
 */
export async function addEdge(parentId: string, childId: string, opts?: { skipRecompute?: boolean }): Promise<void> {
  const [parent, child] = await Promise.all([
    prisma.orgNode.findUnique({ where: { id: parentId } }),
    prisma.orgNode.findUnique({ where: { id: childId } }),
  ]);
  if (!parent || !child) throw new HttpError(404, "Parent or child node not found");
  if (child.level !== parent.level + 1) {
    throw new HttpError(
      400,
      `Edges only connect adjacent levels — "${parent.name}" is level ${parent.level}, "${child.name}" is level ${child.level}`,
    );
  }

  const edges = await prisma.orgEdge.findMany();
  if (wouldCreateCycle(edges, parentId, childId)) {
    throw new HttpError(400, `"${parent.name}" is already below "${child.name}" — that edge would create a loop`);
  }

  await prisma.orgEdge.upsert({
    where: { parentId_childId: { parentId, childId } },
    create: { parentId, childId },
    update: {},
  });
  if (!opts?.skipRecompute) await recomputeClosure();
}

/** Level 0 (the university root) may never have a parent; every level above it needs at
 *  least one, and every parent given must sit exactly one level below. Mirrors the
 *  sister feedback system's HierarchyService.assertAdjacentParents verbatim. */
async function assertAdjacentParents(level: number, parentIds: string[]): Promise<void> {
  if (level === 0) {
    if (parentIds.length > 0) throw new HttpError(400, "A level 0 node cannot have a parent");
    return;
  }
  if (parentIds.length === 0) {
    throw new HttpError(400, "A node above level 0 needs at least one parent");
  }
  const parents = await prisma.orgNode.findMany({ where: { id: { in: parentIds } } });
  if (parents.length !== parentIds.length) {
    throw new HttpError(400, "One or more parent nodes do not exist");
  }
  const wrongLevel = parents.find((p) => p.level !== level - 1);
  if (wrongLevel) {
    throw new HttpError(
      400,
      `Edges only connect adjacent levels — "${wrongLevel.name}" is level ${wrongLevel.level}, not ${level - 1}`,
    );
  }
}

/**
 * Full recompute, not an incremental patch. The node count here is in the dozens, not
 * the millions, and a wholesale rebuild sidesteps every class of drift bug an
 * incremental closure update can introduce.
 */
export async function recomputeClosure(): Promise<void> {
  const [nodes, edges] = await Promise.all([
    prisma.orgNode.findMany({ select: { id: true } }),
    prisma.orgEdge.findMany(),
  ]);
  const rows = computeClosureRows(
    nodes.map((n) => n.id),
    edges,
  );
  await prisma.$transaction([prisma.orgClosure.deleteMany({}), prisma.orgClosure.createMany({ data: rows })]);
}
