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
 * Resolution order: global role → CUSTODIAN without a post (custody scope) → org reach
 * (owner-or-current). The one override is the university-wide read (read-scope.ts).
 */
export interface ResolvedScope {
  mode: ScopeMode;
  visibleNodeIds: string[];
  custodyItemIds: string[] | null;
}

/** A caller-supplied read scope replacing the person's own default — the
 *  university-wide read (`{ mode: "UNIVERSITY" }`). */
export interface ScopeOverride {
  mode?: ScopeMode;
}

/** What a person sees before an admin has said otherwise — lib/domain's
 *  defaultScopeFor, re-derived against the production role set. Custody is checked
 *  before management on purpose: someone who is both a custodian and a head answers
 *  for their own lab first. */
export async function defaultModeFor(userId: string): Promise<ScopeMode> {
  if (await orgScope.hasGlobalReach(userId)) return "UNIVERSITY";
  const roles = await rolesOf(userId);
  // Occupying a node, not the MANAGER role label, is what widens a custodian's
  // default past their own lab (F-017 of the 2026-09-15 campaign) — the two used
  // to be able to disagree (a role edit leaving someone occupying a node they no
  // longer formally carry MANAGER for, or vice versa).
  const heads = await orgScope.headNodeIdsOf(userId);
  if (roles.includes("CUSTODIAN") && !heads.length) return "MY_CUSTODY";
  return "ORG_SUBTREE";
}

/** Resolves the caller's default scope end to end — the visible node ids and/or
 *  custody item ids the chosen mode actually needs, so a caller never has to know
 *  which branch of the resolution order it landed in. `modeOverride`, when given,
 *  replaces the caller's own default (the university-wide browse, 10b of
 *  ~/.claude/plans/three-product-changes-dynamic-thompson.md — always gate the call
 *  site with `assertCanBrowseUniversity` first; this function trusts its caller). */
export async function resolveScope(userId: string, modeOverride?: ScopeMode): Promise<ResolvedScope> {
  const mode = modeOverride ?? (await defaultModeFor(userId));
  if (mode === "UNIVERSITY") return { mode, visibleNodeIds: [], custodyItemIds: null };
  if (mode === "MY_CUSTODY") return { mode, visibleNodeIds: [], custodyItemIds: await custodyItemIdsOf(userId) };
  return { mode, visibleNodeIds: await orgScope.visibleNodeIds(userId), custodyItemIds: null };
}

/** The Prisma `where` a scoped item query filters through — never bypassed, never
 *  re-derived at a call site. `overrides` lets a caller supply a mode other than the
 *  user's default and/or extraGrantedIds (approvalGrantIds); omitted, it resolves the
 *  user's own default scope. */
export async function visibleItemWhere(
  userId: string,
  overrides?: Partial<Pick<ItemScopeInput, "mode" | "extraGrantedIds">>,
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
export async function canSeeItem(userId: string, itemId: string, modeOverride?: ScopeMode): Promise<boolean> {
  const where = await visibleItemWhere(userId, modeOverride ? { mode: modeOverride } : undefined);
  const descendantIds = await descendantIdsIncludingSelf(itemId);
  if (!descendantIds.length) return false;
  const hit = await prisma.item.count({ where: { AND: [where, { id: { in: descendantIds }, deletedAt: null }] } });
  return hit > 0;
}

/** Throws 404 (not 403) for an out-of-scope item — a 403 would confirm the row
 *  exists. */
export async function assertCanSeeItem(userId: string, itemId: string, modeOverride?: ScopeMode): Promise<void> {
  if (!(await canSeeItem(userId, itemId, modeOverride))) throw new HttpError(404, "Resource not found");
}

/**
 * F-034 of the 2026-09-15 campaign — `assertCanSeeItem` is ancestor-inclusive by
 * design (custodying one item nested three levels deep makes every container
 * above it "visible", so a breadcrumb/tree can be drawn), which is the wrong
 * question for a LAB AGGREGATE (a lab's changes, calendars): it would expose a
 * whole lab's composition to anyone who merely custodied ONE borrowed item sitting
 * inside it. This checks DIRECT visibility of the lab item itself (no
 * descendant walk), or write custody over it, or headship of the unit that
 * owns it — never "something under it happens to be visible to me". */
export async function assertMaySeeLabAggregate(userId: string, labItemId: string): Promise<void> {
  if (await isSysAdmin(userId)) return;

  const lab = await prisma.item.findUnique({ where: { id: labItemId, deletedAt: null }, select: { ownerOrgNodeId: true } });
  if (!lab) throw new HttpError(404, "Resource not found");

  const where = await visibleItemWhere(userId);
  const directlyVisible = await prisma.item.count({ where: { AND: [where, { id: labItemId, deletedAt: null }] } });
  if (directlyVisible > 0) return;

  const writable = new Set(await writableItemIdsOf(userId));
  if (writable.has(labItemId)) return;

  if (await orgScope.isHeadOf(userId, lab.ownerOrgNodeId)) return;

  throw new HttpError(404, "Resource not found");
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

export async function rolesOf(userId: string): Promise<RoleKind[]> {
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

/**
 * Item ids a user may WRITE through containment — the same walk as
 * `custodyItemIdsOf`, except descent stops the instant accountability changes.
 * `custodyItemIdsOf` answers "what does this custodian's lab contain" (a READ
 * question: a custodian must see everything physically in their own lab, including a
 * borrowed item sitting in it). This answers "what may this custodian WRITE" — a
 * borrowed item's foreign owner/custodian means it, and anything nested inside IT, is
 * excluded, along with anything nested inside a differently-owned child anywhere in
 * the walk. Fixes the 2026-09-15 campaign's two CRITICAL findings (F-020, F-021):
 * write custody must never be inherited from a container into something the
 * container does not itself account for.
 *
 * Used by `assertCanMutate` and `containers()` (the create/move destination picker,
 * which must offer only what a write would actually be allowed to target) — never by
 * anything answering a READ question, which keeps using `custodyItemIdsOf`.
 */
export async function writableItemIdsOf(userId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE held AS (
      SELECT id, "custodianId", "ownerOrgNodeId" FROM "Item" WHERE "custodianId" = ${userId} AND "deletedAt" IS NULL
      UNION
      SELECT i.id, i."custodianId", i."ownerOrgNodeId" FROM "Item" i
      INNER JOIN held h ON i."parentId" = h.id
      WHERE i."deletedAt" IS NULL AND i."custodianId" = h."custodianId" AND i."ownerOrgNodeId" = h."ownerOrgNodeId"
    )
    SELECT id FROM held
  `;
  return rows.map((r) => r.id);
}

/** Custody may only ever be handed to someone who can actually answer for what they'd
 *  hold: an ACTIVE account carrying CUSTODIAN, STORE_KEEPER or SYS_ADMIN (the seeded
 *  administrator itself custodies real resources). A head who also runs a lab carries
 *  CUSTODIAN too. The identical set `people.custodians()` offers as candidates. Every
 *  write path that assigns custody (direct setCustodian, createItem, transfer
 *  settlement) calls this before writing `custodianId`. */
export async function assertEligibleCustodian(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { roles: true } });
  const eligibleRole = user?.roles.some((r) => r.kind === "CUSTODIAN" || r.kind === "STORE_KEEPER" || r.kind === "SYS_ADMIN");
  if (!user || user.status !== "ACTIVE" || !eligibleRole) throw new HttpError(400, "Choose an active custodian or store keeper.");
}

/** F-031 of the 2026-09-15 campaign — called at the top of every register and
 *  change-log read (not only the API routes, so a future caller can't reach the data
 *  by skipping the route). An outside requester's account never reads the register. */
export async function assertMayBrowseRegister(userId: string): Promise<void> {
  const roles = await rolesOf(userId);
  if (roles.some((r) => r !== "EXTERNAL")) return;
  throw new HttpError(403, "The register is for university accounts.");
}

// ── WRITE eligibility (Phase 7 of ~/.claude/plans/wait-i-want-gentle-haven.md) ──────
//
// Deliberately narrower than everything above, and a SEPARATE question from read
// scope: `visibleItemWhere`/`canSeeItem` decide who may SEE an item (broad — org
// reach, university-wide roles, ancestor closure); the functions below decide who may
// WRITE one. Only SYS_ADMIN may act on anything unconditionally. PROPERTY_ADMIN and
// STORE_KEEPER see the whole university but may still only act on an item they
// directly custody or that sits beneath something they custody — being able to see a
// lab, even university-wide, is not being its owner.
//
// **Department heads do not write** (2026-09-22, by product direction, reversing the
// 2026-09-04 "let department heads edit" carve-out): custodians make every change to
// resources; a head manages personnel and approves — lab commits, transfers,
// purchases — through the approval flows, never by editing the register directly.

export async function isSysAdmin(userId: string): Promise<boolean> {
  const hit = await prisma.userRole.findFirst({ where: { userId, kind: "SYS_ADMIN" } });
  return hit !== null;
}

/**
 * Throws the same 404 a direct read of an out-of-scope item would — never a 403:
 * confirming an item exists to someone who may not act on it is its own leak. Empty
 * `itemIds` is trivially fine (nothing to check) rather than an error, so a caller
 * building this list conditionally (e.g. `moveInTree` with a null destination) never
 * needs its own special case.
 *
 * Custody is `writableItemIdsOf`, not `custodyItemIdsOf` — see that function's own
 * header. There is no org-reach branch: holding a post (a head, a dean) grants no
 * write access of its own — see the section note above.
 */
export async function assertCanMutate(userId: string, itemIds: string[]): Promise<void> {
  if (!itemIds.length) return;
  if (await isSysAdmin(userId)) return;
  const writableIds = new Set(await writableItemIdsOf(userId));
  const remaining = itemIds.filter((id) => !writableIds.has(id));
  if (!remaining.length) return;

  throw new HttpError(404, "Resource not found");
}

// ── University-wide read (2026-10-01) ─────────────────────────────────────────────
//
// Transparency across ASTU: every signed-in internal account reads the whole
// university. `?scope=UNIVERSITY` is client-supplied, so every endpoint honouring it
// still calls this gate — an outside requester's account is refused. READ only: the
// write door stays `assertCanMutate`'s custody policy.

export async function assertCanBrowseUniversity(userId: string): Promise<void> {
  const roles = await rolesOf(userId);
  if (roles.some((r) => r !== "EXTERNAL")) return;
  throw new HttpError(403, "You are not allowed to browse university-wide.");
}
