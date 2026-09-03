import "server-only";
import type { Prisma } from "@prisma/client";
import type { RoleKind, ScopeMode } from "@/lib/shared";
import { prisma } from "../prisma";
import { HttpError } from "../http-error";
import * as orgScope from "../org/scope";
import { buildItemScopeWhere, type ItemScopeInput } from "./item-scope.logic";

/**
 * ItemScopeService — which ITEMS a user may see. Sits on top of
 * lib/server/org/scope.ts, which answers the same question for org NODES and stays
 * the only place hierarchy reach is decided; this module never re-derives org
 * reachability, it only consumes it (`visibleNodeIds`/`hasGlobalReach`).
 *
 * No item read or write may bypass this module. See item-scope.logic.ts for the pure
 * predicate and why an item is in scope (owner-or-current, custody as a narrower,
 * separate reason).
 *
 * Resolution order, unchanged from the design: global role → CUSTODIAN without
 * MANAGER (custody scope) → org reach (owner-or-current) → no reach. A caller may
 * override the mode/explicitNodeIds directly (AccessView, Phase 11 of
 * ~/.claude/plans/wait-i-want-gentle-haven.md) instead of taking this default.
 */
export interface ResolvedScope {
  mode: ScopeMode;
  visibleNodeIds: string[];
  custodyItemIds: string[] | null;
}

/** What a person sees before an admin has said otherwise — lib/domain's
 *  defaultScopeFor, re-derived against the production role set. Custody is checked
 *  before management on purpose: someone who is both a custodian and a head answers
 *  for their own lab first. */
export async function defaultModeFor(userId: string): Promise<ScopeMode> {
  if (await orgScope.hasGlobalReach(userId)) return "UNIVERSITY";
  const roles = await rolesOf(userId);
  if (roles.includes("CUSTODIAN") && !roles.includes("MANAGER")) return "MY_CUSTODY";
  return "ORG_SUBTREE";
}

/** Resolves the caller's default scope end to end — the visible node ids and/or
 *  custody item ids the chosen mode actually needs, so a caller never has to know
 *  which branch of the resolution order it landed in. */
export async function resolveScope(userId: string): Promise<ResolvedScope> {
  const mode = await defaultModeFor(userId);
  if (mode === "UNIVERSITY") return { mode, visibleNodeIds: [], custodyItemIds: null };
  if (mode === "MY_CUSTODY") return { mode, visibleNodeIds: [], custodyItemIds: await custodyItemIdsOf(userId) };
  return { mode, visibleNodeIds: await orgScope.visibleNodeIds(userId), custodyItemIds: null };
}

/** The Prisma `where` a scoped item query filters through — never bypassed, never
 *  re-derived at a call site. `overrides` lets a caller supply a mode/explicitNodeIds
 *  other than the user's default (AccessView, Phase 11) and/or extraGrantedIds
 *  (approvalGrantIds, Phase 12); omitted, it resolves the user's own default scope. */
export async function visibleItemWhere(
  userId: string,
  overrides?: Partial<Pick<ItemScopeInput, "mode" | "explicitNodeIds" | "extraGrantedIds">>,
): Promise<Prisma.ItemWhereInput> {
  const mode = overrides?.mode ?? (await defaultModeFor(userId));

  if (mode === "UNIVERSITY") {
    return buildItemScopeWhere({ mode, visibleNodeIds: [], custodyItemIds: null, extraGrantedIds: overrides?.extraGrantedIds });
  }
  if (mode === "MY_CUSTODY") {
    return buildItemScopeWhere({
      mode,
      visibleNodeIds: [],
      custodyItemIds: await custodyItemIdsOf(userId),
      extraGrantedIds: overrides?.extraGrantedIds,
    });
  }
  if (mode === "EXPLICIT_NODES") {
    return buildItemScopeWhere({
      mode,
      visibleNodeIds: [],
      custodyItemIds: null,
      explicitNodeIds: overrides?.explicitNodeIds ?? [],
      extraGrantedIds: overrides?.extraGrantedIds,
    });
  }
  return buildItemScopeWhere({
    mode,
    visibleNodeIds: await orgScope.visibleNodeIds(userId),
    custodyItemIds: null,
    extraGrantedIds: overrides?.extraGrantedIds,
  });
}

/**
 * READ visibility — direct scope OR ancestor of something directly in scope. The
 * tree/search read model (items.ts) ancestor-closes its scoped set so a visible item
 * inside an invisible container is never unreachable ("read-only context"); a
 * point-check on a single id (`GET /items/:id`) must agree with that same closure or
 * a row the list view legitimately showed as context 404s the moment it is opened.
 * Write authorization (`assertCanMutate`, below) is a separate, narrower question —
 * custody-based, not scope-based; see its own header comment.
 */
export async function canSeeItem(userId: string, itemId: string): Promise<boolean> {
  const where = await visibleItemWhere(userId);
  const descendantIds = await descendantIdsIncludingSelf(itemId);
  if (!descendantIds.length) return false;
  const hit = await prisma.item.count({ where: { AND: [where, { id: { in: descendantIds }, deletedAt: null }] } });
  return hit > 0;
}

/** Throws 404 (not 403) for an out-of-scope item — a 403 would confirm the row
 *  exists. */
export async function assertCanSeeItem(userId: string, itemId: string): Promise<void> {
  if (!(await canSeeItem(userId, itemId))) throw new HttpError(404, "Resource not found");
}

async function descendantIdsIncludingSelf(itemId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE subtree AS (
      SELECT id FROM "Item" WHERE id = ${itemId} AND "deletedAt" IS NULL
      UNION ALL
      SELECT i.id FROM "Item" i INNER JOIN subtree s ON i."parentId" = s.id WHERE i."deletedAt" IS NULL
    )
    SELECT id FROM subtree
  `;
  return rows.map((r) => r.id);
}

async function rolesOf(userId: string): Promise<RoleKind[]> {
  const rows = await prisma.userRole.findMany({ where: { userId }, select: { kind: true } });
  return rows.map((r) => r.kind as RoleKind);
}

/**
 * Item ids this user is custodian of, plus every item transitively contained within
 * them — a lab assistant sees their lab's contents, not just the lab row itself. A
 * small self-contained recursive query, ported from the deleted Phase-1 item-scope.ts
 * unchanged — cheaper than loading the whole forest into memory just to answer "what
 * do I hold custody of". Exported for `assertCanMutate`'s own use below, in addition
 * to `resolveScope`'s MY_CUSTODY branch.
 */
export async function custodyItemIdsOf(userId: string): Promise<string[]> {
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

// ── WRITE eligibility (Phase 7 of ~/.claude/plans/wait-i-want-gentle-haven.md) ──────
//
// Deliberately narrower than everything above, and a SEPARATE question from read
// scope: `visibleItemWhere`/`canSeeItem` decide who may SEE an item (broad — org
// reach, university-wide roles, ancestor closure); the functions below decide who may
// WRITE one, which this project's explicit policy makes much narrower. Only SYS_ADMIN
// may act on anything unconditionally. Every other role — PROPERTY_ADMIN and
// STORE_KEEPER see the whole university, MANAGER sees its whole subtree — may act
// only on an item it directly custodies or that sits beneath something it custodies.
// Being able to see a lab, even university-wide, is not being its owner. Every other
// role's part in a mutation, for now, is to approve one once Phase 12's chain exists —
// not to make it directly. This is a deliberate policy decision (recorded in
// PROGRESS.md's Phase 7 entry), not a rediscovery of the read-scope rules above.

export async function isSysAdmin(userId: string): Promise<boolean> {
  const hit = await prisma.userRole.findFirst({ where: { userId, kind: "SYS_ADMIN" } });
  return hit !== null;
}

/** Throws the same 404 a direct read of an out-of-scope item would — never a 403:
 *  confirming an item exists to someone who may not act on it is its own leak. Empty
 *  `itemIds` is trivially fine (nothing to check) rather than an error, so a caller
 *  building this list conditionally (e.g. `moveInTree` with a null destination) never
 *  needs its own special case. */
export async function assertCanMutate(userId: string, itemIds: string[]): Promise<void> {
  if (!itemIds.length) return;
  if (await isSysAdmin(userId)) return;
  const custodyIds = new Set(await custodyItemIdsOf(userId));
  if (itemIds.some((id) => !custodyIds.has(id))) throw new HttpError(404, "Resource not found");
}
