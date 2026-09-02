import { Injectable } from "@nestjs/common";
import type { Item } from "@prisma/client";
import type { ItemDetailDto, ItemQueryInput, ItemRowDto, PropValue } from "@sc-lab/shared";
import { PrismaService } from "../prisma/prisma.service";
import { ItemScopeService } from "./item-scope.service";

const ROW_INCLUDE = {
  category: { select: { name: true } },
  ownerOrg: { select: { name: true } },
  currentOrg: { select: { name: true } },
  custodian: { select: { name: true } },
} as const;

type ItemRow = Item & {
  category: { name: string };
  ownerOrg: { name: string };
  currentOrg: { name: string };
  custodian: { name: string };
};

/**
 * Resource reads. Every query starts from ItemScopeService.visibleItemWhere — no
 * exceptions. A Prisma record is never returned directly; toRowDto resolves the names
 * (category, owner, current, custodian) a client would otherwise need a second
 * round-trip for.
 */
@Injectable()
export class ItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly itemScope: ItemScopeService,
  ) {}

  /**
   * Scoped, unpaginated for now — see the resource-register plan's Phase 6 for
   * server-side filtering/sort/pagination. Every row here is one this user may see;
   * scope is applied BEFORE this query runs, not filtered out of a fuller result.
   */
  async search(userId: string, query: ItemQueryInput): Promise<ItemRowDto[]> {
    const scope = await this.itemScope.visibleItemWhere(userId);
    const rows = await this.prisma.item.findMany({
      where: {
        AND: [scope, { deletedAt: null }, query.categoryId ? { categoryId: query.categoryId } : {}],
      },
      include: ROW_INCLUDE,
      orderBy: { name: "asc" },
    });
    return rows.map(toRowDto);
  }

  /** Out-of-scope returns 404, not 403 — a 403 would confirm the row exists. */
  async getOne(userId: string, id: string): Promise<ItemDetailDto> {
    await this.itemScope.assertCanSeeItem(userId, id);
    const row = await this.prisma.item.findUniqueOrThrow({ where: { id }, include: ROW_INCLUDE });
    return {
      ...toRowDto(row),
      props: row.props as Record<string, PropValue>,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

function toRowDto(r: ItemRow): ItemRowDto {
  return {
    id: r.id,
    parentId: r.parentId,
    name: r.name,
    categoryId: r.categoryId,
    categoryName: r.category.name,
    countingMode: r.countingMode,
    qty: Number(r.qty),
    status: r.status,
    critical: r.critical,
    ownerOrgNodeId: r.ownerOrgNodeId,
    ownerOrgName: r.ownerOrg.name,
    currentOrgNodeId: r.currentOrgNodeId,
    currentOrgName: r.currentOrg.name,
    custodianId: r.custodianId,
    custodianName: r.custodian.name,
    version: r.version,
    updatedAt: r.updatedAt.toISOString(),
  };
}
