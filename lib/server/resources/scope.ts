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

/** A caller-supplied read scope, replacing the person's own default — either the
 *  university-wide browse (`{ mode: "UNIVERSITY" }`, 10b) or an EXPLICIT_NODES access
 *  view (Track 1 of ~/.claude/plans/lets-merge-the-work-memoized-journal.md), which is
 *  the only mode that needs the second field. */
export interface ScopeOverride {
  mode?: ScopeMode;
  explicitNodeIds?: string[];
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
export async function resolveScope(userId: string, modeOverride?: ScopeMode, explicitNodeIds?: string[]): Promise<ResolvedScope> {
  const mode = modeOverride ?? (await defaultModeFor(userId));
  if (mode === "UNIVERSITY") return { mode, visibleNodeIds: [], custodyItemIds: null };
  if (mode === "MY_CUSTODY") return { mode, visibleNodeIds: [], custodyItemIds: await custodyItemIdsOf(userId) };
  if (mode === "EXPLICIT_NODES") return { mode, visibleNodeIds: explicitNodeIds ?? [], custodyItemIds: null };
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
export async function canSeeItem(userId: string, itemId: string, modeOverride?: ScopeMode, explicitNodeIds?: string[]): Promise<boolean> {
  const where = await visibleItemWhere(userId, modeOverride ? { mode: modeOverride, explicitNodeIds } : undefined);
  const descendantIds = await descendantIdsIncludingSelf(itemId);
  if (!descendantIds.length) return false;
  const hit = await prisma.item.count({ where: { AND: [where, { id: { in: descendantIds }, deletedAt: null }] } });
  return hit > 0;
}

/** Throws 404 (not 403) for an out-of-scope item — a 403 would confirm the row
 *  exists. */
export async function assertCanSeeItem(userId: string, itemId: string, modeOverride?: ScopeMode, explicitNodeIds?: string[]): Promise<void> {
  if (!(await canSeeItem(userId, itemId, modeOverride, explicitNodeIds))) throw new HttpError(404, "Resource not found");
}

/**
 * F-034 of the 2026-09-15 campaign — `assertCanSeeItem` is ancestor-inclusive by
 * design (custodying one item nested three levels deep makes every container
 * above it "visible", so a breadcrumb/tree can be drawn), which is the wrong
 * question for a LAB AGGREGATE (ideal-vs-actual, purchasables, calendars):
 * `getIdealVsActual` used to gate on it and so exposed a whole department's
 * lab composition to anyone who merely custodied ONE borrowed item sitting
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
 *  hold: an ACTIVE account carrying CUSTODIAN, STORE_KEEPER, MANAGER or SYS_ADMIN (the seeded administrator itself custodies real resources) — the identical
 *  set `people.custodians()` already offers as candidates. A student or a disabled
 *  account failing this floor is F-024 from the same campaign; every write path that
 *  assigns custody (direct setCustodian, createItem, transfer/handover settlement)
 *  must call this before writing `custodianId`. */
export async function assertEligibleCustodian(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { roles: true } });
  const eligibleRole = user?.roles.some((r) => r.kind === "CUSTODIAN" || r.kind === "STORE_KEEPER" || r.kind === "MANAGER" || r.kind === "SYS_ADMIN");
  if (!user || user.status !== "ACTIVE" || !eligibleRole) {
    throw new HttpError(400, "Choose an active custodian, store keeper or department head.");
  }
}

/** F-031 of the 2026-09-15 campaign — this module's own opening note used to say
 *  "the per-endpoint RBAC layer, not this module, is what actually keeps a
 *  student off the asset register", but no read route ever called one:
 *  `defaultModeFor` gives any non-custodian with a home node the same
 *  ORG_SUBTREE reach as a staff member, so a student or external account with a
 *  home node saw their whole department's register — locations, custodian
 *  names, statuses. Called at the top of every register/change-log read (not
 *  only the API routes, so a future caller can't reach the data by skipping the
 *  route) — categories stays exempt (everyone needs to see what fields exist to
 *  make sense of anything else). */
export async function assertMayBrowseRegister(userId: string): Promise<void> {
  const roles = await rolesOf(userId);
  if (roles.some((r) => r !== "STUDENT" && r !== "EXTERNAL")) return;
  throw new HttpError(403, "The asset register is for staff and custodians.");
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
// **MANAGER is the one deliberate exception** (2026-09-04, by explicit product
// direction — "let department heads edit"): a department head may act directly on
// anything owned-or-currently-held within their own visible subtree, not just what
// they personally custody. A head answers for their whole department, not only the
// specific rows someone happened to assign them as custodian of — unlike custody,
// which is a narrow, per-item fact, headship is a standing authority over the unit.
// This mirrors `assertCanCreateRoot`'s own MANAGER branch below, which already
// granted this same reach for root creation; ordinary mutation was the one write
// path that hadn't caught up. Every OTHER role's part in a mutation is still to
// approve one once Phase 12's chain exists, not to make it directly — this carve-out
// is MANAGER-only, not a general widening.

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
 * header. The MANAGER branch below checks `ownerOrgNodeId` ONLY, never
 * `currentOrgNodeId`: a head answers for what their unit OWNS, not for whatever
 * happens to be sitting inside it on loan (F-021 of the 2026-09-15 campaign — a host
 * head could otherwise rename or re-own a borrowed item just because it was
 * physically parked in their department's lab).
 */
export async function assertCanMutate(userId: string, itemIds: string[]): Promise<void> {
  if (!itemIds.length) return;
  if (await isSysAdmin(userId)) return;
  const writableIds = new Set(await writableItemIdsOf(userId));
  const remaining = itemIds.filter((id) => !writableIds.has(id));
  if (!remaining.length) return;

  const roles = await rolesOf(userId);
  if (roles.includes("MANAGER")) {
    const visible = await orgScope.visibleNodeIds(userId);
    // deletedAt: null (F-025 of the 2026-09-15 campaign) — a soft-deleted item's
    // row still exists, so without this a MANAGER's reach would silently extend
    // to editing something that's supposed to be gone; excluding it here makes
    // it count as missing, the same "not found" a hard delete used to produce.
    const rows = await prisma.item.findMany({ where: { id: { in: remaining }, deletedAt: null }, select: { id: true, ownerOrgNodeId: true } });
    const stillOut = rows.length !== remaining.length || rows.some((r) => !visible.includes(r.ownerOrgNodeId));
    if (!stillOut) return;
  }

  throw new HttpError(404, "Resource not found");
}

/**
 * Who may place a NEW university-level root (a Lab, a Store — no existing item to
 * check custody against, which is exactly why this is its own policy rather than a
 * variant of `assertCanMutate`). Deliberately narrower than ordinary read scope, and
 * different in shape from create-beneath-a-parent:
 *  - SYS_ADMIN — anywhere.
 *  - MANAGER — a root owned by any unit inside their OWN visible subtree (a
 *    department head registering their department's first lab).
 *  - CUSTODIAN / STORE_KEEPER — a root owned by their OWN home unit specifically,
 *    with THEMSELVES as its custodian (a lab assistant registering their own lab) —
 *    never an arbitrary unit, and never naming someone else as custodian on their
 *    own say-so.
 * Refused with 403, not 404: a create has no existing row whose presence a 404 would
 * need to hide, and "Resource not found" on an Add button is just confusing.
 */
export async function assertCanCreateRoot(userId: string, input: { ownerOrgNodeId: string; custodianId: string }): Promise<void> {
  // F-024 of the 2026-09-15 campaign: custody landing on an account that can't act
  // (disabled) or shouldn't hold assets (a student) was never checked here, for
  // ANY actor including SYS_ADMIN — a root lab could be created with a disabled or
  // student custodian just as readily as an ordinary CUSTODIAN/setCustodian call
  // could hand it one directly (mutate.ts's own use of this same assertion).
  await assertEligibleCustodian(input.custodianId);

  if (await isSysAdmin(userId)) return;

  const roles = await rolesOf(userId);
  if (roles.includes("MANAGER")) {
    const visible = await orgScope.visibleNodeIds(userId);
    if (visible.includes(input.ownerOrgNodeId)) return;
  }
  if (roles.includes("CUSTODIAN") || roles.includes("STORE_KEEPER")) {
    const own = await orgScope.ownNodeId(userId);
    if (own && own === input.ownerOrgNodeId && input.custodianId === userId) return;
  }
  throw new HttpError(403, "You are not allowed to create a top-level resource here.");
}

// ── University-wide browse (10b of ~/.claude/plans/three-product-changes-dynamic-thompson.md) ──
//
// A read-only, university-wide view for the offices that have to answer "does any
// department already have one of these, and is it working?" before approving a
// purchase — a purchase-approving office or a department head weighing a request
// against what already exists elsewhere. `?scope=UNIVERSITY` is a client-suppliable
// query parameter and MUST NOT be trusted on its own; every endpoint that honours it
// calls this gate first. Widened deliberately past GLOBAL_ROLES
// (SYS_ADMIN/PROPERTY_ADMIN/PROCUREMENT, already unrestricted via
// `orgScope.hasGlobalReach`): MANAGER because the org chart *is* the approval route
// here — "approver" means a department head/dean, i.e. MANAGER — and STORE_KEEPER
// because that role's ordinary reach is already university-wide by design (a store
// keeper occupies no OrgNode; see schema.prisma's own RoleKind doc). This grants
// nothing beyond READ — the write door stays `assertCanMutate`'s custody-only policy,
// entirely unaffected by seeing further.

// CUSTODIAN added by Track 5 (~/.claude/plans/understand-where-we-are-crystalline-
// marshmallow.md): transfers are pulled, so a lab's custodian has to be able to find
// what another unit holds before asking for it. Still read-only.
const UNIVERSITY_BROWSE_ROLES: RoleKind[] = ["MANAGER", "STORE_KEEPER", "CUSTODIAN"];

/** Throws 403 for anyone not on the list above — a STAFF or plain CUSTODIAN account
 *  hitting `scope=UNIVERSITY` directly, bypassing the UI's own nav gate, must be
 *  refused server-side exactly like every other authorization check in this module. */
export async function assertCanBrowseUniversity(userId: string): Promise<void> {
  if (await orgScope.hasGlobalReach(userId)) return;
  const roles = await rolesOf(userId);
  if (roles.some((r) => UNIVERSITY_BROWSE_ROLES.includes(r))) return;
  throw new HttpError(403, "You are not allowed to browse university-wide.");
}
