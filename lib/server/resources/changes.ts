import "server-only";
import type { ItemChangeDto } from "@/lib/shared";
import { prisma } from "../prisma";

/**
 * Change-log READS. Scope is never re-derived here: `GET /api/resources/items/:id`
 * has already run scope.ts's `assertCanSeeItem` on `itemId` before this is called, so
 * an entry for an out-of-scope item is never reached in the first place. A global,
 * filterable change-log browse view — where scope on a since-deleted item's entry has
 * no live row to check against — is Phase 10 of
 * ~/.claude/plans/wait-i-want-gentle-haven.md, not this one.
 */
export async function forItem(itemId: string): Promise<ItemChangeDto[]> {
  const rows = await prisma.itemChange.findMany({
    where: { itemId },
    include: { actor: { select: { name: true } } },
    orderBy: { at: "desc" },
  });
  return rows.map(toDto);
}

function toDto(r: {
  id: string;
  at: Date;
  actorId: string;
  actor: { name: string };
  kind: string;
  targetKind: string;
  itemId: string | null;
  itemName: string;
  categoryId: string | null;
  field: string | null;
  before: unknown;
  after: unknown;
  batchId: string | null;
  note: string | null;
}): ItemChangeDto {
  return {
    id: r.id,
    at: r.at.toISOString(),
    actorId: r.actorId,
    actorName: r.actor.name,
    kind: r.kind as ItemChangeDto["kind"],
    targetKind: r.targetKind as ItemChangeDto["targetKind"],
    itemId: r.itemId,
    itemName: r.itemName,
    categoryId: r.categoryId,
    field: r.field,
    before: r.before ?? null,
    after: r.after ?? null,
    batchId: r.batchId,
    note: r.note,
  };
}
