import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { RoleKind } from "@sc-lab/shared";
import { PrismaService } from "../prisma/prisma.service";
import { ScopeService } from "../org/scope.service";
import { buildItemScopeWhere } from "./item-scope.logic";

/**
 * Which ITEMS a user may see. Sits on top of ScopeService, which answers the same
 * question for org NODES and stays the only place hierarchy reach is decided — this
 * service never re-derives org reachability, it only consumes it.
 *
 * No item read or write may bypass this service. See item-scope.logic.ts for why an
 * item is in scope (owner-or-current, and custody as a narrower, separate reason).
 */
@Injectable()
export class ItemScopeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
  ) {}

  async visibleItemWhere(userId: string): Promise<Prisma.ItemWhereInput> {
    const hasGlobalReach = await this.scope.hasGlobalReach(userId);
    if (hasGlobalReach) {
      return buildItemScopeWhere({ hasGlobalReach: true, custodyItemIds: null, visibleNodeIds: [] });
    }

    const roles = await this.rolesOf(userId);
    const isCustodianOnly = roles.includes("CUSTODIAN") && !roles.includes("MANAGER");

    if (isCustodianOnly) {
      const custodyItemIds = await this.custodyItemIds(userId);
      return buildItemScopeWhere({ hasGlobalReach: false, custodyItemIds, visibleNodeIds: [] });
    }

    const visibleNodeIds = await this.scope.visibleNodeIds(userId);
    return buildItemScopeWhere({ hasGlobalReach: false, custodyItemIds: null, visibleNodeIds });
  }

  async canSeeItem(userId: string, itemId: string): Promise<boolean> {
    const where = await this.visibleItemWhere(userId);
    const hit = await this.prisma.item.findFirst({ where: { AND: [where, { id: itemId }] }, select: { id: true } });
    return hit !== null;
  }

  /** Throws 404 (not 403) for an out-of-scope item — a 403 would confirm the row exists. */
  async assertCanSeeItem(userId: string, itemId: string): Promise<void> {
    if (!(await this.canSeeItem(userId, itemId))) {
      throw new NotFoundException("Resource not found");
    }
  }

  private async rolesOf(userId: string): Promise<RoleKind[]> {
    const rows = await this.prisma.userRole.findMany({ where: { userId }, select: { kind: true } });
    return rows.map((r) => r.kind as RoleKind);
  }

  /**
   * Item ids this user is custodian of, plus every item transitively contained within
   * them — a lab assistant sees their lab's contents, not just the lab row itself.
   * A small self-contained recursive query rather than a dependency on the fuller
   * tree/rollup machinery (item-tree.service.ts) that arrives with row-shaping later.
   */
  private async custodyItemIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
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
}
