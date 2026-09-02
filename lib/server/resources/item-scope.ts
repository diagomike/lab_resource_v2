import "server-only";
import type { Prisma } from "@prisma/client";
import type { RoleKind } from "@/lib/shared";
import { prisma } from "../prisma";
import { HttpError } from "../http-error";
import * as scope from "../org/scope";
import { buildItemScopeWhere } from "./item-scope.logic";

/**
 * Which ITEMS a user may see. Sits on top of scope.ts, which answers the same question
 * for org NODES and stays the only place hierarchy reach is decided — this module never
 * re-derives org reachability, it only consumes it.
 *
 * No item read or write may bypass this module. See item-scope.logic.ts for why an item
 * is in scope (owner-or-current, and custody as a narrower, separate reason).
 */
export async function visibleItemWhere(userId: string): Promise<Prisma.ItemWhereInput> {
  const hasGlobalReach = await scope.hasGlobalReach(userId);
  if (hasGlobalReach) {
    return buildItemScopeWhere({ hasGlobalReach: true, custodyItemIds: null, visibleNodeIds: [] });
  }

  const roles = await rolesOf(userId);
  const isCustodianOnly = roles.includes("CUSTODIAN") && !roles.includes("MANAGER");

  if (isCustodianOnly) {
    const custodyItemIds = await custodyItemIdsOf(userId);
    return buildItemScopeWhere({ hasGlobalReach: false, custodyItemIds, visibleNodeIds: [] });
  }

  const visibleNodeIds = await scope.visibleNodeIds(userId);
  return buildItemScopeWhere({ hasGlobalReach: false, custodyItemIds: null, visibleNodeIds });
}

export async function canSeeItem(userId: string, itemId: string): Promise<boolean> {
  const where = await visibleItemWhere(userId);
  const hit = await prisma.item.findFirst({ where: { AND: [where, { id: itemId }] }, select: { id: true } });
  return hit !== null;
}

/** Throws 404 (not 403) for an out-of-scope item — a 403 would confirm the row exists. */
export async function assertCanSeeItem(userId: string, itemId: string): Promise<void> {
  if (!(await canSeeItem(userId, itemId))) {
    throw new HttpError(404, "Resource not found");
  }
}

async function rolesOf(userId: string): Promise<RoleKind[]> {
  const rows = await prisma.userRole.findMany({ where: { userId }, select: { kind: true } });
  return rows.map((r) => r.kind as RoleKind);
}

/**
 * Item ids this user is custodian of, plus every item transitively contained within
 * them — a lab assistant sees their lab's contents, not just the lab row itself. A small
 * self-contained recursive query rather than a dependency on the fuller tree/rollup
 * machinery that arrives with row-shaping later.
 */
async function custodyItemIdsOf(userId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE held AS (
      SELECT id FROM "Item" WHERE "custodianId" = ${userId} AND "deletedAt" IS NULL
      UNION
      SELECT i.id FROM "Item" i
      INNER JOIN held h ON i."parentId" = h.id
      WHERE i."deletedAt" IS NULL
    )
    SELECT id FROM held
  `;
  return rows.map((r) => r.id);
}
