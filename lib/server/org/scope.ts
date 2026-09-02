import "server-only";
import type { RoleKind } from "@/lib/shared";
import { prisma } from "../prisma";

/**
 * Resolves which OrgNode ids a given user may see.
 *
 * THIS IS THE HIGHEST-RISK LOGIC IN THE SYSTEM. Every asset, stock, booking, request and
 * report query must filter through visibleNodeIds. A bug here silently leaks one
 * department's asset register — including purchase costs and exact locations — into
 * another's dashboard. Keep every scoping decision in this module; never re-derive it at
 * a call site "just for this one query".
 *
 * Four ways a user gets reach, in order:
 *   1. SYS_ADMIN / PROPERTY_ADMIN / PROCUREMENT — university-wide by role. Property Admin
 *      is the custodian of the whole register and Procurement must see every existing
 *      item to judge a purchase, so both are global by definition rather than by edges.
 *   2. Occupying an org node (a department head, a dean) — reach is that node plus
 *      everything below it, read straight out of the precomputed closure.
 *   3. A homeNodeId (a custodian or instructor who works in a department without heading
 *      it) — reach is that node's closure too. Without this, a custodian occupies nothing
 *      and would see zero assets, which is not a narrow scope, it is a broken one: they
 *      are the person actually holding the unregistered box.
 *   4. None of the above (a student) — no hierarchy reach. The per-endpoint RBAC layer
 *      (requireRole), not this module, is what actually keeps a student off the asset
 *      register even though they might carry a homeNodeId too.
 */
const GLOBAL_ROLES: RoleKind[] = ["SYS_ADMIN", "PROPERTY_ADMIN", "PROCUREMENT"];

export async function visibleNodeIds(userId: string): Promise<string[]> {
  if (await hasGlobalReach(userId)) {
    const all = await prisma.orgNode.findMany({ select: { id: true } });
    return all.map((n) => n.id);
  }

  const rootId = await reachRootNodeId(userId);
  if (!rootId) return [];

  const reachable = await prisma.orgClosure.findMany({
    where: { ancestorId: rootId },
    select: { descendantId: true },
  });
  return reachable.map((r) => r.descendantId);
}

/** Occupancy first, homeNodeId second. Never both — occupying a node already implies
 *  reach from there, and a department head's home department is the node they occupy. */
async function reachRootNodeId(userId: string): Promise<string | null> {
  const occupied = await prisma.orgNode.findUnique({ where: { userId }, select: { id: true } });
  if (occupied) return occupied.id;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { homeNodeId: true } });
  return user?.homeNodeId ?? null;
}

export async function canSeeNode(userId: string, nodeId: string): Promise<boolean> {
  const ids = await visibleNodeIds(userId);
  return ids.includes(nodeId);
}

/** The single unit this user acts FOR — the node they occupy, or failing that their
 *  homeNodeId. Distinct from visibleNodeIds: a dean occupies one node but can see many.
 *  Actions attributed to a specific unit (raising a request, registering an asset) use
 *  this, not the wider set. */
export async function ownNodeId(userId: string): Promise<string | null> {
  return reachRootNodeId(userId);
}

export async function hasGlobalReach(userId: string): Promise<boolean> {
  const hit = await prisma.userRole.findFirst({
    where: { userId, kind: { in: GLOBAL_ROLES } },
  });
  return hit !== null;
}

/**
 * Purchase cost, estimated cost and disposal valuations are restricted. A student
 * browsing the catalog to book a microscope has no business seeing what it cost, and a
 * shared-lab view must not leak one department's spend to another. STORE_KEEPER is
 * included — receiving goods against a purchase order means reading the cost the order
 * was raised for.
 */
export async function canSeeCost(userId: string): Promise<boolean> {
  const hit = await prisma.userRole.findFirst({
    where: { userId, kind: { in: ["PROPERTY_ADMIN", "PROCUREMENT", "MANAGER", "SYS_ADMIN", "STORE_KEEPER"] } },
  });
  return hit !== null;
}
