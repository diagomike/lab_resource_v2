import "server-only";
import type { Prisma } from "@prisma/client";
import type { ChangeLogEntryDto, ChangeLogPageDto, ItemChangeDto, ItemChangeKind, ItemChangeTarget } from "@/lib/shared";
import { itemChangeKinds } from "@/lib/shared";
import { CHANGE_LABEL } from "@/lib/domain/types";
import { prisma } from "../prisma";
import * as scope from "./scope";
import * as orgScope from "../org/scope";

/**
 * Change-log READS. `forItem` is unchanged from before Phase 10 — scope is never
 * re-derived here, `GET /api/resources/items/:id` has already run `assertCanSeeItem`
 * on `itemId`, so an out-of-scope item's history is never reached in the first place,
 * and since that check requires the item to still exist, every row `forItem` returns
 * is for a live item by construction.
 *
 * `browse` is the new one: the global, filterable, paginated log Phase 10 of
 * ~/.claude/plans/wait-i-want-gentle-haven.md asks for. A since-deleted item has no
 * live row left to run `assertCanSeeItem` against, which is exactly why every
 * ITEM-targeted `ItemChange` row now carries its own scope snapshot
 * (`ownerOrgNodeId`/`currentOrgNodeId`/`custodianId`, captured at the moment of that
 * exact change — see the Prisma model's own comment). `browse`'s scope predicate runs
 * against THAT snapshot, in SQL, before a single row is fetched — never "load
 * everything and filter in the browser."
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

// ── The global log ───────────────────────────────────────────────────────

export interface ChangeLogQuery {
  q?: string;
  kind?: ItemChangeKind;
  targetKind?: ItemChangeTarget;
  actorId?: string;
  categoryId?: string;
  itemId?: string;
  batchId?: string;
}

export type ChangeLogPage = ChangeLogPageDto;

/**
 * Resolution order matches `lib/server/resources/scope.ts`'s own for items — global
 * role → custody → org reach — re-applied against the SNAPSHOT columns rather than
 * the live `Item` table, since a deleted item has no live row left. A category-
 * targeted row (`targetKind: "CATEGORY"`) is always included: categories are shared
 * vocabulary, readable by anyone signed in, same rule the categories endpoints
 * already enforce. A row with no snapshot at all (written before this column
 * existed, or an item whose history predates it) is visible to global roles only —
 * the deliberately conservative default for genuinely unknown scope; see the Prisma
 * model's own comment.
 */
async function changeLogScopeWhere(userId: string): Promise<Prisma.ItemChangeWhereInput> {
  const mode = await scope.defaultModeFor(userId);
  if (mode === "UNIVERSITY") return {};
  if (mode === "MY_CUSTODY") {
    return { OR: [{ targetKind: "CATEGORY" }, { custodianId: userId }] };
  }
  const nodeIds = await orgScope.visibleNodeIds(userId);
  return {
    OR: [{ targetKind: "CATEGORY" }, { ownerOrgNodeId: { in: nodeIds } }, { currentOrgNodeId: { in: nodeIds } }],
  };
}

/** Free text against the columns that actually hold searchable prose (`itemName`,
 *  `field`, `note`, the actor's name via the real relation) plus a reverse match
 *  against every change kind's own display label — "delete" finds `deleteItem` rows
 *  even though the stored value is the camelCase kind, not the label a person reads. */
function searchWhere(q: string): Prisma.ItemChangeWhereInput {
  const text = q.trim();
  if (!text) return {};
  const matchingKinds = itemChangeKinds.filter((k) => CHANGE_LABEL[k].toLowerCase().includes(text.toLowerCase()));
  return {
    OR: [
      { itemName: { contains: text, mode: "insensitive" } },
      { field: { contains: text, mode: "insensitive" } },
      { note: { contains: text, mode: "insensitive" } },
      { actor: { name: { contains: text, mode: "insensitive" } } },
      ...(matchingKinds.length ? [{ kind: { in: matchingKinds } }] : []),
    ],
  };
}

function filterWhere(query: ChangeLogQuery): Prisma.ItemChangeWhereInput {
  const clauses: Prisma.ItemChangeWhereInput[] = [];
  if (query.kind) clauses.push({ kind: query.kind });
  if (query.targetKind) clauses.push({ targetKind: query.targetKind });
  if (query.actorId) clauses.push({ actorId: query.actorId });
  if (query.categoryId) clauses.push({ categoryId: query.categoryId });
  if (query.itemId) clauses.push({ itemId: query.itemId });
  if (query.batchId) clauses.push({ batchId: query.batchId });
  if (query.q) clauses.push(searchWhere(query.q));
  return clauses.length ? { AND: clauses } : {};
}

/** The global, scoped, filtered, paginated log. Scope is ANDed with the caller's
 *  filters/search — never applied after the fact, never left to the client. Ordered
 *  `at desc` with `id` as a tiebreaker: every row one bulk operation produces shares
 *  the exact same `at` (mutate.ts stamps one `Date` per call), so this ordering keeps
 *  a batch's rows contiguous within a page, which is what lets the client group them
 *  into one visual operation instead of unrelated rows that happen to share a badge. */
export async function browse(userId: string, query: ChangeLogQuery, page = 1, pageSize = 50): Promise<ChangeLogPage> {
  // F-031 of the 2026-09-15 campaign — the change log is register history, the
  // same surface items.ts's own computeScopedIds gates.
  await scope.assertMayBrowseRegister(userId);
  const scopeWhere = await changeLogScopeWhere(userId);
  const where: Prisma.ItemChangeWhereInput = { AND: [scopeWhere, filterWhere(query)] };

  const safePage = Math.max(1, page);
  const safeSize = Math.min(200, Math.max(1, pageSize));

  const [rows, total] = await Promise.all([
    prisma.itemChange.findMany({
      where,
      include: { actor: { select: { name: true } } },
      orderBy: [{ at: "desc" }, { id: "desc" }],
      skip: (safePage - 1) * safeSize,
      take: safeSize,
    }),
    prisma.itemChange.count({ where }),
  ]);

  const itemIds = [...new Set(rows.map((r) => r.itemId).filter((id): id is string => Boolean(id)))];
  const categoryIds = [...new Set(rows.map((r) => r.categoryId).filter((id): id is string => Boolean(id)))];
  const [liveItems, categories] = await Promise.all([
    itemIds.length ? prisma.item.findMany({ where: { id: { in: itemIds }, deletedAt: null }, select: { id: true } }) : Promise.resolve([]),
    categoryIds.length ? prisma.resourceCategory.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  const liveIds = new Set(liveItems.map((i) => i.id));
  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));

  return {
    entries: rows.map((r) => ({
      ...toDto(r),
      itemExists: r.itemId ? liveIds.has(r.itemId) : false,
      categoryName: r.categoryId ? (categoryNameById.get(r.categoryId) ?? null) : null,
    })),
    total,
  };
}
