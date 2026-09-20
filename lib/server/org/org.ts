import "server-only";
import { Prisma } from "@prisma/client";
import type { CreateOrgNodeInput, DeactivateNodeResultDto, OrgNodeDto, OrgNodeKind, UpdateOrgNodeInput } from "@/lib/shared";
import { prisma } from "../prisma";
import { HttpError } from "../http-error";
import { computeClosureRows, wouldCreateCycle } from "./closure-algorithm";

type Tx = Prisma.TransactionClient;

/**
 * Every structural write (create, rename/re-kind, reparent, change-level, delete) and
 * the closure recompute that follows it now run inside one interactive transaction that
 * opens with an advisory lock, serialising all of them (F-003 of the 2026-09-15
 * campaign). Before this, `recomputeClosure` did `deleteMany({}) + createMany(all rows)`
 * as its own batch transaction under READ COMMITTED: two concurrent recomputes both
 * inserted the full closure set and one hit a unique-constraint 500, and `create`
 * committed the node row before its edges and closure, so a losing recompute left a
 * node with no closure rows at all — reachable by nobody. The node/edge count is in the
 * dozens, so serialising every structural write has no real contention cost.
 */
const ORG_STRUCTURE_LOCK_KEY = "org-structure";

async function withOrgLock<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  // A P2003 from recomputeClosure (a node referenced mid-recompute disappeared —
  // see that function's own note) aborts the whole Postgres transaction; Postgres
  // gives no way to retry just the failing statement once a transaction is
  // aborted, so the retry has to re-run the ENTIRE locked transaction from
  // scratch, re-acquiring the lock and re-reading committed state.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ORG_STRUCTURE_LOCK_KEY}))`;
        return fn(tx);
      });
    } catch (err) {
      const isMissingNode = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003";
      if (!isMissingNode || attempt === 2) throw err;
    }
  }
  throw new Error("unreachable");
}

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
    code: n.code,
  }));
}

/** `OrgNode.code` is `@unique` at the DB layer; Prisma's own conflict is a bare P2002,
 *  so both call sites below map it to a named 400 instead of an uncaught 500. */
function isCodeConflict(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && (err.meta?.target as string[] | undefined)?.includes("code") === true;
}

export async function create(input: CreateOrgNodeInput): Promise<OrgNodeDto> {
  let nodeId: string;
  try {
    nodeId = await withOrgLock(async (tx) => {
      await assertAdjacentParents(tx, input.level, input.parentIds);
      await assertUniversityInvariant(tx, null, input.level, input.kind);
      const node = await tx.orgNode.create({
        data: { name: input.name, level: input.level, kind: input.kind, code: input.code || null },
      });
      for (const parentId of input.parentIds) {
        await addEdge(tx, parentId, node.id, { skipRecompute: true });
      }
      await recomputeClosure(tx);
      return node.id;
    });
  } catch (err) {
    if (isCodeConflict(err)) throw new HttpError(400, `Code "${input.code}" is already used by another node.`);
    throw err;
  }
  return (await list(false)).find((n) => n.id === nodeId)!;
}

/** Rename and/or re-kind. Active/inactive, reparenting and level all have their own
 *  dedicated, bigger-consequence endpoints below rather than living behind this bare
 *  field PATCH — kind belongs here because, unlike level, it has no structural side
 *  effects to guard against (see UpdateOrgNodeInput's own note). */
export async function update(id: string, input: UpdateOrgNodeInput): Promise<OrgNodeDto> {
  try {
    await withOrgLock(async (tx) => {
      const node = await tx.orgNode.findUnique({ where: { id } });
      if (!node) throw new HttpError(404, "Org node not found");
      if (input.kind !== undefined) await assertUniversityInvariant(tx, id, node.level, input.kind);
      await tx.orgNode.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.kind !== undefined ? { kind: input.kind } : {}),
          ...(input.code !== undefined ? { code: input.code || null } : {}),
        },
      });
    });
  } catch (err) {
    if (isCodeConflict(err)) throw new HttpError(400, `Code "${input.code}" is already used by another node.`);
    throw err;
  }
  return (await list(false)).find((n) => n.id === id)!;
}

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
  await withOrgLock(async (tx) => {
    const node = await tx.orgNode.findUnique({ where: { id } });
    if (!node) throw new HttpError(404, "Org node not found");
    await assertAdjacentParents(tx, node.level, parentIds);

    await tx.orgEdge.deleteMany({ where: { childId: id } });
    await tx.orgEdge.createMany({ data: parentIds.map((parentId) => ({ parentId, childId: id })) });
    await recomputeClosure(tx);
  });
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
export async function changeLevel(id: string, newLevel: number, parentIds: string[] = []): Promise<OrgNodeDto> {
  await withOrgLock(async (tx) => {
    const node = await tx.orgNode.findUnique({ where: { id }, include: { outgoingEdges: true } });
    if (!node) throw new HttpError(404, "Org node not found");
    if (node.level === newLevel) return;
    await assertUniversityInvariant(tx, id, newLevel, node.kind);
    // F-005 of the 2026-09-15 campaign: changing level used to strand the node (0
    // parents, 0 children) and every former child (0 parents) with nothing reported —
    // exactly the disconnected state assertAdjacentParents forbids at creation time. A
    // level change invalidates every edge the node holds in either direction (an edge
    // only means something between two adjacent levels), so its new parents are now
    // required atomically in the same call, validated at the *new* level.
    if (node.outgoingEdges.length > 0) {
      // A node that still has children can't safely change level either way: its
      // children's edges assume the *old* level, and re-deriving new parents for them
      // isn't this operation's job. Refuse outright; the admin detaches or reassigns
      // children first.
      throw new HttpError(
        400,
        `"${node.name}" still has ${node.outgoingEdges.length} child node(s) — reassign or detach them before changing its level.`,
      );
    }
    await assertAdjacentParents(tx, newLevel, parentIds);
    await tx.orgEdge.deleteMany({ where: { OR: [{ parentId: id }, { childId: id }] } });
    await tx.orgNode.update({ where: { id }, data: { level: newLevel } });
    for (const parentId of parentIds) {
      await addEdge(tx, parentId, id, { skipRecompute: true });
    }
    await recomputeClosure(tx);
  });
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
 * not collide with itself. Runs under the same advisory lock as every other
 * structural write (F-003), so two concurrent creates can't both pass this check
 * before either commits.
 */
async function assertUniversityInvariant(tx: Tx, excludeId: string | null, level: number, kind: OrgNodeKind): Promise<void> {
  if ((level === 0) !== (kind === "UNIVERSITY")) {
    throw new HttpError(
      400,
      'Level 0 is reserved for the single "University" root — a node at level 0 must be kind University, and a University-kind node must be at level 0.',
    );
  }
  if (level === 0) {
    const existing = await tx.orgNode.findFirst({ where: { level: 0, ...(excludeId ? { id: { not: excludeId } } : {}) } });
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
 */
export async function deleteNode(id: string): Promise<void> {
  await withOrgLock(async (tx) => {
    const node = await tx.orgNode.findUnique({ where: { id }, include: { outgoingEdges: true } });
    if (!node) throw new HttpError(404, "Org node not found");

    const blockers: string[] = [];
    if (node.userId) blockers.push("has an occupant — deactivate it first");
    if (node.outgoingEdges.length > 0) blockers.push(`has ${node.outgoingEdges.length} child node(s)`);

    const residents = await tx.user.count({ where: { homeNodeId: id } });
    if (residents > 0) blockers.push(`is the home department of ${residents} person(s)`);

    // Item.ownerOrgNodeId/currentOrgNodeId are onDelete: Restrict — without these two
    // checks the delete below would still be refused, just as a raw, uncaught Prisma
    // foreign-key error instead of a named blocker like every other one here. Counts
    // every item regardless of deletedAt (F-025's soft delete): the FK this guards
    // against still holds for a soft-deleted row exactly as it does for a live one
    // — the row still exists — so excluding it here would promise a delete the
    // database would then refuse anyway.
    const owned = await tx.item.count({ where: { ownerOrgNodeId: id } });
    if (owned > 0) blockers.push(`owns ${owned} resource(s)`);
    const held = await tx.item.count({ where: { currentOrgNodeId: id, ownerOrgNodeId: { not: id } } });
    if (held > 0) blockers.push(`is currently holding ${held} resource(s) on loan`);

    // F-004 of the 2026-09-15 campaign: NeedLine/PurchaseRequest/ExternalRequestAssignment
    // all reference orgNodeId with onDelete: Restrict too, and none was checked here — a
    // delete blocked by one of them surfaced as a raw, uncaught Postgres 23001 500 instead
    // of a named blocker like every other case above.
    const needs = await tx.needLine.count({ where: { orgNodeId: id } });
    if (needs > 0) blockers.push(`has ${needs} purchasing need(s)`);
    const purchases = await tx.purchaseRequest.count({ where: { orgNodeId: id } });
    if (purchases > 0) blockers.push(`has ${purchases} purchase request(s)`);
    const externalAssignments = await tx.externalRequestAssignment.count({ where: { orgNodeId: id } });
    if (externalAssignments > 0) blockers.push(`has ${externalAssignments} external-request assignment(s)`);

    if (blockers.length > 0) {
      throw new HttpError(400, `Cannot delete "${node.name}" — it ${blockers.join("; ")}`);
    }

    await tx.orgEdge.deleteMany({ where: { OR: [{ parentId: id }, { childId: id }] } });
    await tx.orgNode.delete({ where: { id } });
    await recomputeClosure(tx);
  });
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
export async function createEdge(parentId: string, childId: string): Promise<void> {
  await withOrgLock((tx) => addEdge(tx, parentId, childId));
}

async function addEdge(tx: Tx, parentId: string, childId: string, opts?: { skipRecompute?: boolean }): Promise<void> {
  const [parent, child] = await Promise.all([tx.orgNode.findUnique({ where: { id: parentId } }), tx.orgNode.findUnique({ where: { id: childId } })]);
  if (!parent || !child) throw new HttpError(404, "Parent or child node not found");
  if (child.level !== parent.level + 1) {
    throw new HttpError(
      400,
      `Edges only connect adjacent levels — "${parent.name}" is level ${parent.level}, "${child.name}" is level ${child.level}`,
    );
  }

  const edges = await tx.orgEdge.findMany();
  if (wouldCreateCycle(edges, parentId, childId)) {
    throw new HttpError(400, `"${parent.name}" is already below "${child.name}" — that edge would create a loop`);
  }

  await tx.orgEdge.upsert({
    where: { parentId_childId: { parentId, childId } },
    create: { parentId, childId },
    update: {},
  });
  if (!opts?.skipRecompute) await recomputeClosure(tx);
}

/** Level 0 (the university root) may never have a parent; every level above it needs at
 *  least one, and every parent given must sit exactly one level below. Mirrors the
 *  sister feedback system's HierarchyService.assertAdjacentParents verbatim. */
async function assertAdjacentParents(tx: Tx, level: number, parentIds: string[]): Promise<void> {
  if (level === 0) {
    if (parentIds.length > 0) throw new HttpError(400, "A level 0 node cannot have a parent");
    return;
  }
  if (parentIds.length === 0) {
    throw new HttpError(400, "A node above level 0 needs at least one parent");
  }
  const parents = await tx.orgNode.findMany({ where: { id: { in: parentIds } } });
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
 * incremental closure update can introduce. Runs against the caller's transaction (and
 * so under the org-structure advisory lock — F-003) rather than opening its own
 * transaction, closing the exact race the campaign found: two concurrent recomputes
 * each doing their own `deleteMany({}) + createMany(all rows)` under READ COMMITTED
 * could interleave and collide on the closure table's unique constraint, and the loser
 * left whichever node it was mid-inserting with zero closure rows — unreachable by
 * anyone until some later edit happened to recompute again.
 */
export async function recomputeClosure(tx: Tx): Promise<void> {
  // This transaction's own advisory lock (F-003) is what protects this against
  // every OTHER structural write this codebase makes — all of them go through
  // this same module. A node deleted by something outside that discipline
  // entirely (this project's test suite deliberately creates and tears down
  // orphan nodes with direct Prisma calls, bypassing org.ts on purpose for
  // fixture isolation — see org.spec.ts's own header) can still race the read
  // below against the write; withOrgLock's own P2003 retry is what actually
  // recovers from that, by re-running this whole transaction from scratch.
  const [nodes, edges] = await Promise.all([tx.orgNode.findMany({ select: { id: true } }), tx.orgEdge.findMany()]);
  const rows = computeClosureRows(
    nodes.map((n) => n.id),
    edges,
  );
  await tx.orgClosure.deleteMany({});
  await tx.orgClosure.createMany({ data: rows });
}
