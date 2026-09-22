import "server-only";
import { Prisma, type Item as PrismaItem, type PrismaClient } from "@prisma/client";
import type { CustomPropType, ItemChangeInput, ItemChangeResultDto, ItemPropValue } from "@/lib/shared";
import { prisma } from "../prisma";
import { HttpError } from "../http-error";
import { instantiateMany, newId } from "@/lib/domain/instantiate";
import type { Category } from "@/lib/domain/types";
import * as scope from "./scope";
import * as orgScope from "../org/scope";
import { resolveEffectiveView } from "./views";
import { validatePropWrite } from "./category-props";
import { assertNoCollision, assertValidCustomKey, validateCustomPropValue } from "./custom-props";
import { toDomainCategoryMap } from "./adapt";
import { canPlace } from "@/lib/domain/placement";
import { storage } from "./storage";

export type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

/**
 * The one write door. Ported from temp_works/src/lib/store.ts's `validate` → `apply`
 * → log → bump `version`, inside one transaction — see that file's header comment for
 * why there is exactly one path (an earlier version of it carried two, and roughly
 * two hundred lines of the older one had gone unreachable without anyone noticing).
 *
 * `editCategory` is deliberately NOT handled here — see lib/shared/resources/item.ts's
 * own note: a category edit is categories.ts's `update()`, its own endpoint, not
 * funnelled through this one. It still appears as an ItemChangeKind because the audit
 * log tags a category-edit entry with it (categories.ts writes those rows directly).
 *
 * `requestChange`/`applyOnFinalApproval` (the approval-routed callers, Phase 12 of
 * ~/.claude/plans/wait-i-want-gentle-haven.md) do not exist yet — every call here is a
 * direct edit for now. When they land, they call this exact function with the exact
 * same input, which is the property that makes "a routed-and-approved change produces
 * a record identical to applying it directly" provable.
 */

const DRY_RUN_ABORT = Symbol("dry-run-abort");

/** ItemChange.before/after are nullable Json columns — Prisma represents an actual
 *  JSON `null` write as `Prisma.DbNull`, not the bare TS value `null`. */
function jsonOrNull(v: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return v === null || v === undefined ? Prisma.DbNull : (v as Prisma.InputJsonValue);
}

/** Every ITEM-targeted ItemChange row's scope snapshot — see the Prisma model's own
 *  comment for why this exists (the global change log's deleted-item/cross-department
 *  authorization). Callers whose change alters ownership/custody pass the POST-change
 *  values explicitly rather than reading them off `item`, so the row this call writes
 *  reflects the state it actually produced. */
function scopeSnapshot(item: { ownerOrgNodeId: string; currentOrgNodeId: string; custodianId: string }) {
  return { ownerOrgNodeId: item.ownerOrgNodeId, currentOrgNodeId: item.currentOrgNodeId, custodianId: item.custodianId };
}

export async function applyChange(
  actorId: string,
  input: ItemChangeInput,
  opts?: {
    dryRun?: boolean;
    viewId?: string | null;
    bypassDraftWorkflowBlock?: boolean;
    viaApprovalEngine?: boolean;
    /**
     * F-035 of the 2026-09-15 campaign — a caller-supplied transaction, so several
     * operations (a lab commit's whole staged batch — see lab-drafts.ts's
     * decideCommit) apply as ONE atomic unit instead of N independent ones. Before
     * this, each staged change ran in its OWN transaction against the SAME
     * pre-flight starting state; the first real apply bumped a version the second
     * expected, so it deterministically failed with VERSION_CONFLICT, leaving the
     * batch half-applied. When `tx` is given, this call joins the CALLER's
     * transaction rather than opening its own — `dryRun` and its own storage
     * cleanup no longer apply here (the caller owns both: pass `cleanupKeys` to
     * collect this call's own storage removals, and run a dry run via a savepoint
     * of the caller's own choosing, if it needs one at all).
     */
    tx?: Tx;
    cleanupKeys?: string[];
  },
): Promise<ItemChangeResultDto> {
  await assertAuthorized(actorId, input, opts?.viewId, opts?.bypassDraftWorkflowBlock, opts?.viaApprovalEngine);
  // Computed once, against committed state, alongside assertAuthorized's own check —
  // threaded into performChange only for createItem, which is the one write kind
  // where a NON-admin's client-supplied accountability fields (owner/current/
  // custodian on a CHILD) must be silently overridden by the parent's rather than
  // trusted (F-023 of the 2026-09-15 campaign). Every other kind's authorization is
  // already fully decided by assertAuthorized/assertCanMutate above.
  const isAdmin = await scope.isSysAdmin(actorId);

  if (opts?.tx) {
    await assertVersionsMatch(opts.tx, input);
    return performChange(opts.tx, actorId, input, opts.cleanupKeys ?? [], isAdmin);
  }

  let captured: ItemChangeResultDto | undefined;
  // Storage keys a successful commit makes unreferenced (a removed photo, a deleted
  // subtree's own photos and any of its still-pending uploads) — collected DURING the
  // transaction but never acted on until AFTER it commits. Deleting the bytes first
  // and having the transaction roll back would strand a referenced ItemImage row with
  // no file behind it; deleting them before commit at all risks exactly that. A dry
  // run always rolls back, so its own list is discarded rather than acted on.
  const cleanupKeys: string[] = [];
  try {
    await prisma.$transaction(async (tx) => {
      // Version check and write must be atomic — see assertVersionsMatch's own header
      // on why this runs INSIDE the transaction, not before it opens.
      await assertVersionsMatch(tx, input);
      captured = await performChange(tx, actorId, input, cleanupKeys, isAdmin);
      if (opts?.dryRun) throw DRY_RUN_ABORT;
    });
  } catch (err) {
    if (err !== DRY_RUN_ABORT) throw err;
    return captured!;
  }
  // Best-effort, after a committed transaction only. A failure here leaves a
  // harmless orphaned file (cleaned up later by the same sweep expired uploads use),
  // never a dangling reference — the DB row is already gone by this point either way.
  for (const key of cleanupKeys) await storage.remove(key).catch(() => undefined);
  return captured!;
}

/** The preview variant — the same validate→apply path, nothing committed. What
 *  edit-impact previews and a pending request's "what would this do?" both use. */
export function previewChange(
  actorId: string,
  input: ItemChangeInput,
  viewId?: string | null,
  bypassDraftWorkflowBlock?: boolean,
): Promise<ItemChangeResultDto> {
  return applyChange(actorId, input, { dryRun: true, viewId, bypassDraftWorkflowBlock });
}

// ── Authorization — WHO may do this. Never re-derived at a call site; see
//    scope.ts's own header on `assertCanMutate`. Runs before the transaction opens,
//    against committed state, so a request that fails authorization never pays for
//    one. This project's explicit write-role policy (PROGRESS.md, Phase 7): SYS_ADMIN
//    may act on anything; every other role, however broad its READ reach, may act
//    only on an item it directly custodies or that sits beneath something it
//    custodies — deliberately narrower than the scope reads use, and independent of
//    which roles a caller holds (custody is the `Item.custodianId` column, a data
//    fact, not a role label). ──────────────────────────────────────────────────────

async function assertAuthorized(
  actorId: string,
  input: ItemChangeInput,
  viewId?: string | null,
  bypassDraftWorkflowBlock?: boolean,
  viaApprovalEngine?: boolean,
): Promise<void> {
  await assertViewAllowsEdit(actorId, viewId);

  // F-024 of the 2026-09-15 campaign: checked before the SYS_ADMIN exemption below,
  // not after — custody landing on a disabled account or a student is exactly as
  // stuck (they can never sign in to act on it, or shouldn't hold assets at all)
  // regardless of who handed it to them.
  if (input.kind === "setCustodian") await scope.assertEligibleCustodian(input.value);
  // Same floor for a NEW item's named custodian — assertCanCreateRoot below is
  // never reached for SYS_ADMIN (they return before it), which the E2E re-run (R-07)
  // caught: an admin could still create a root with a DISABLED custodian.
  if (input.kind === "createItem" && input.custodianId) await scope.assertEligibleCustodian(input.custodianId);

  if (await scope.isSysAdmin(actorId)) return;

  if (input.kind === "transferItem" && !viaApprovalEngine) {
    // Track 3 (~/.claude/plans/lets-merge-the-work-memoized-journal.md §6.2): every
    // transfer, even one where the actor already custodies both ends, must be
    // REQUESTED through lib/server/resources/approvals.ts — which itself applies
    // immediately when the resolved chain turns out to be entirely self-held, so
    // this refusal costs nothing for that case, it only closes the direct door.
    // Without this, a legacy direct call to this write door would let anyone
    // custodying both ends skip the chain engine entirely, making it optional —
    // the same shape of gap Track 2 found and fixed for its own draft-workflow
    // toggle, caught here during Track 3's own planning instead of after shipping.
    throw new HttpError(403, "Transfers must be requested through the approvals flow — see Approvals.");
  }

  if (input.kind === "transferItem" && !input.transfer.transferOwnership) {
    // A RETURN settling here (2026-09-20, F-039) is the one shape where the
    // REQUESTER need not hold the destination at all — the requester may be the
    // HOST releasing it, who has no standing whatsoever in the owner's own unit.
    // The chain that got here (HOST_RELEASE → REQUESTER_RECEIPT) already gathered
    // every consent a return needs; re-checked structurally against committed state
    // instead, exactly like the pull check below re-checks its own premise: the
    // destination must still belong to the SAME unit that owns every item moving.
    const destination = await prisma.item.findUnique({ where: { id: input.transfer.targetParentId }, select: { currentOrgNodeId: true } });
    const subjectItems = await prisma.item.findMany({ where: { id: { in: input.itemIds } }, select: { ownerOrgNodeId: true, currentOrgNodeId: true } });
    const isReturn = !!destination && subjectItems.length > 0 && subjectItems.every((i) => i.ownerOrgNodeId !== i.currentOrgNodeId && i.ownerOrgNodeId === destination.currentOrgNodeId);
    if (isReturn) return;

    // Track 5 — a pull transfer's settled chain IS the source side's consent (its
    // custodian and owning head both signed). What the requester must still hold at
    // apply time is the place it lands in; checked again here, against committed
    // state, in case custody of the destination changed while the request waited.
    await scope.assertCanMutate(actorId, [input.transfer.targetParentId]);
    return;
  }

  if (!bypassDraftWorkflowBlock) await assertDraftWorkflowNotBlocking(input);

  if (input.kind === "setOwnerOrg" || input.kind === "setCurrentOrg") {
    // F-022 of the 2026-09-15 campaign: moving an item between units — who owns it,
    // or merely who currently holds it — is exactly what the transfer/handover chain
    // exists to decide (`pol-owner-any`/`pol-current-any` already say so; nothing
    // read them before this fix). SYS_ADMIN already returned above; everyone else
    // uses `requestTransfer`, never this direct door.
    throw new HttpError(403, "Moving a resource between units goes through Transfer, not a direct edit — see Approvals.");
  }

  if (input.kind === "setCustodian") {
    // Direct custody handoff is allowed only to someone whose own reach already
    // covers the item's owning unit — an ordinary same-department reassignment
    // (or a head/global role receiving it). Handing custody to a stranger
    // department (a different custodian who has no standing there at all) is a
    // handover, which goes through the approvals chain instead (F-022, F-024).
    await scope.assertCanMutate(actorId, input.itemIds);
    // Eligibility itself is already checked above, before the SYS_ADMIN exemption.
    const items = await prisma.item.findMany({ where: { id: { in: input.itemIds } }, select: { ownerOrgNodeId: true } });
    const ownerNodeIds = [...new Set(items.map((i) => i.ownerOrgNodeId))];
    const targetReach = new Set(await orgScope.visibleNodeIds(input.value));
    if (ownerNodeIds.some((id) => !targetReach.has(id))) {
      throw new HttpError(403, "Handing custody to another unit goes through Transfer, not a direct edit — see Approvals.");
    }
    return;
  }

  if (input.kind === "createItem") {
    if (input.parentId) {
      // The existing "special handling for a custodian adding beneath an in-custody
      // parent" the plan calls out — generalised to every write kind below, not just
      // this one.
      await scope.assertCanMutate(actorId, [input.parentId]);
      return;
    }
    // A root has no existing item to check custody against — assertCanCreateRoot is
    // its own, deliberately narrower policy (scope.ts's own header), widened past
    // SYS_ADMIN-only so a department can actually register its first resource. Both
    // fields are required for a root by applyCreateItem anyway; validated here too so
    // the authorization check has something real to test.
    if (!input.ownerOrgNodeId || !input.custodianId) {
      throw new HttpError(400, "A top-level resource must have an owning unit and a custodian.");
    }
    await scope.assertCanCreateRoot(actorId, { ownerOrgNodeId: input.ownerOrgNodeId, custodianId: input.custodianId });
    return;
  }

  await scope.assertCanMutate(actorId, input.itemIds);

  // moveInTree's destination is still checked directly here — reordering within
  // one's own containment tree only ever targets something the actor already
  // custodies. transferItem is the opposite case (its whole point is a destination
  // outside the actor's custody), which is why it's refused above instead and
  // routed through approvals.ts, whose own request-time validation checks placement
  // legality and an active org node rather than custody.
  if (input.kind === "moveInTree" && input.value !== null) {
    await scope.assertCanMutate(actorId, [input.value]);
  }
}

/**
 * Track 2 — once a department opts into the draft workflow
 * (`OrgNode.draftWorkflowEnabled`), direct edits to items it owns are refused for
 * everyone but SYS_ADMIN: the whole point of opting in is that changes go through
 * `lab-drafts.ts`'s stage → submit → approve pipeline instead, and leaving this
 * endpoint open would make that pipeline entirely optional — a custodian (or a
 * stale client) could simply keep calling the direct write door and the toggle
 * would do nothing. Deliberately re-implemented here rather than imported from
 * `lab-drafts.ts`, which already calls `applyChange`/`previewChange` as the write
 * door for an APPROVED commit — importing the other direction would be a circular
 * module dependency. A brand-new top-level resource (`createItem` with no
 * `parentId`) is exempt, matching `stageChange`'s own scoping note: creating an
 * entirely new lab is not part of any existing lab's draft.
 *
 * `transferItem` is exempt outright, regardless of the flag above (Track 3's own
 * `assertAuthorized` check already refuses a direct `transferItem` call unless it
 * carries `viaApprovalEngine`, which is set ONLY by approvals.ts's own settle-and-
 * apply call once a transfer request has been fully decided) — a transfer has its
 * own dedicated approval path entirely separate from this department's draft
 * toggle, matching `lab-drafts.ts`'s own `NOT_STAGEABLE` set, which already
 * excludes `transferItem` for the identical reason (it reaches into another unit's
 * accountability, which draft mode never covers). Without this exemption, an
 * approved transfer's own finalizing `applyChange` call — which reaches this
 * function with `viaApprovalEngine: true` but not `bypassDraftWorkflowBlock: true`
 * — would be incorrectly blocked whenever the SOURCE item's department happens to
 * have draft mode on.
 */
async function assertDraftWorkflowNotBlocking(input: ItemChangeInput): Promise<void> {
  if (input.kind === "transferItem") return;
  const ids = input.kind === "createItem" ? (input.parentId ? [input.parentId] : []) : input.itemIds;
  if (!ids.length) return;
  const rows = await prisma.item.findMany({ where: { id: { in: ids } }, select: { ownerOrgNodeId: true } });
  const ownerIds = [...new Set(rows.map((r) => r.ownerOrgNodeId))];
  if (!ownerIds.length) return;
  const blocked = await prisma.orgNode.findFirst({ where: { id: { in: ownerIds }, draftWorkflowEnabled: true }, select: { name: true } });
  if (blocked) {
    throw new HttpError(403, `${blocked.name} uses draft mode for its resources — stage this change and submit it for the department head's approval instead of editing directly.`);
  }
}

/**
 * A view may WIDEN reads; it may never widen writes — see views.ts's own header for
 * the full invariant. This is the write door's half of it: `canEdit: false` on a
 * view the caller EXPLICITLY chose (`viewId` names one they may actually pick)
 * refuses every write while that view is active, for every role including
 * SYS_ADMIN. That is deliberate, not an oversight of "SYS_ADMIN may act on
 * anything unconditionally" above: choosing a read-only view (e.g. switching the
 * sidebar to "Browse university-wide") is the person's own reversible UI choice —
 * unlike custody/role scope, it grants nothing and blocks nothing that a switch of
 * the same picker back to an editable view doesn't immediately undo. Runs BEFORE
 * the SYS_ADMIN early-return above for exactly this reason.
 *
 * F-032 of the 2026-09-15 campaign: an IMPLICIT default view (nobody chose it —
 * `resolveEffectiveView`'s own fallback when `viewId` is omitted) used to be
 * checked the identical way, so one `canEdit: false` EVERYONE-scoped view made
 * every account with no more specific view of their own read-only university-wide,
 * including SYS_ADMIN — with no views seeded in production at all, this would have
 * been every custodian in the university, and the outage would have looked random
 * (only accounts that happened to have a PERSON/ROLE view of their own kept
 * editing). An implicit default now narrows READS only, never blocks a write —
 * `resolveReadOverride` (the read path) still applies it exactly as before, this
 * function just stops asking it for anything when nobody chose a view. */
async function assertViewAllowsEdit(actorId: string, viewId: string | null | undefined): Promise<void> {
  if (!viewId) return;
  const effective = await resolveEffectiveView(actorId, viewId);
  if (effective && !effective.canEdit) {
    throw new HttpError(403, `"${effective.name}" is a read-only view — switch views to make changes.`);
  }
}

/**
 * Optimistic concurrency for items — categories.ts's own `expectedVersion` check,
 * extended to bulk edits via a map (`input.expectedVersions`) rather than one number.
 * `createItem` has no existing rows to compare against, so it is exempt outright; any
 * other kind's caller MAY supply the map (an editor that never re-reads before
 * writing can still opt out entirely by omitting it) but a mismatch on any id refuses
 * the WHOLE change — never a partial write — with the shape `VersionConflictDto`
 * already reserves for this.
 *
 * Runs INSIDE the caller's transaction (`tx`, not the bare `prisma` client) and reads
 * with `FOR UPDATE`, not a plain `findMany`. A version check made before the
 * transaction opens (the original shape of this function) can be invalidated by a
 * second writer between the check and the write it's supposedly guarding — the exact
 * TOCTOU race optimistic concurrency exists to prevent. `SELECT ... FOR UPDATE` locks
 * every checked row for the rest of this transaction, so any concurrent transaction
 * touching the same rows blocks until this one commits or rolls back; the version read
 * here is therefore still current at the moment `performChange` writes it, and a
 * losing concurrent writer sees ITS OWN version check fail against the version this
 * transaction just committed, rather than both succeeding.
 */
async function assertVersionsMatch(tx: Tx, input: ItemChangeInput): Promise<void> {
  if (input.kind === "createItem") return;
  const expected = input.expectedVersions;
  if (!expected || !Object.keys(expected).length) return;

  const checkedIds = input.itemIds.filter((id) => id in expected);
  if (!checkedIds.length) return;

  const rows = await tx.$queryRaw<{ id: string; version: number }[]>`
    SELECT id, version FROM "Item" WHERE id = ANY(${checkedIds}) FOR UPDATE
  `;
  const actualById = new Map(rows.map((r) => [r.id, r.version]));
  const conflicts = checkedIds
    .map((id) => ({ itemId: id, expectedVersion: expected[id], actualVersion: actualById.get(id) ?? -1 }))
    .filter((c) => c.expectedVersion !== c.actualVersion);

  if (conflicts.length) {
    throw new HttpError(409, "Version conflict", {
      message: "One or more of these resources changed since you loaded them.",
      code: "VERSION_CONFLICT",
      conflicts,
    });
  }
}

// ── The write itself — WHAT happens. ────────────────────────────────────────────────

async function performChange(tx: Tx, actorId: string, input: ItemChangeInput, cleanupKeys: string[], isAdmin: boolean): Promise<ItemChangeResultDto> {
  const at = new Date();
  switch (input.kind) {
    case "createItem":
      return applyCreateItem(tx, actorId, at, input, isAdmin);
    case "deleteItem":
      return applyDeleteItem(tx, actorId, at, input, cleanupKeys);
    case "transferItem":
      return applyTransferItem(tx, actorId, at, input);
    case "moveInTree":
      return applyMoveInTree(tx, actorId, at, input, isAdmin);
    case "setProperty":
      return applySetProperty(tx, actorId, at, input);
    case "addCustomProperty":
      return applyAddCustomProperty(tx, actorId, at, input);
    case "setCustomProperty":
      return applySetCustomProperty(tx, actorId, at, input);
    case "removeCustomProperty":
      return applyRemoveCustomProperty(tx, actorId, at, input);
    case "addImage":
      return applyAddImage(tx, actorId, at, input);
    case "removeImage":
      return applyRemoveImage(tx, actorId, at, input, cleanupKeys);
    default:
      return applyFieldChange(tx, actorId, at, input);
  }
}

async function loadAllCategoriesDomain(tx: Tx): Promise<Record<string, Category>> {
  const rows = await tx.resourceCategory.findMany({
    include: { group: { select: { name: true } }, fields: true, templateAsParent: true, placementRulesAsChild: true },
  });
  return toDomainCategoryMap(rows);
}

/** The one enforcement point for lib/domain/placement.ts's `canPlace` — see that
 *  module's own header. `parentCategoryId: null` means a top-level resource. Checked
 *  only against the category actually being written (the new/moved/transferred root),
 *  never against a template's own descendants — a template-vs-placement contradiction
 *  is a warning surfaced by categories.ts's `previewImpact`, not an enforcement here. */
function assertPlacementAllowed(categories: Record<string, Category>, childCategoryId: string, parentCategoryId: string | null): void {
  if (canPlace(categories, childCategoryId, parentCategoryId)) return;
  throw new HttpError(
    400,
    parentCategoryId === null
      ? "This category may not be a top-level resource."
      : "This category may not be placed inside the selected container.",
  );
}

function itemCreateData(item: ReturnType<typeof instantiateMany>[number], categories: Record<string, Category>): Prisma.ItemCreateManyInput {
  return {
    id: item.id,
    parentId: item.parentId,
    categoryId: item.categoryId,
    name: item.name,
    countingMode: categories[item.categoryId]?.countingMode ?? "SERIALIZED",
    qty: item.qty,
    status: item.status,
    critical: item.critical,
    props: item.props as Prisma.InputJsonValue,
    ownerOrgNodeId: item.ownerOrgNodeId,
    currentOrgNodeId: item.currentOrgNodeId,
    custodianId: item.custodianId,
    version: item.version,
  };
}

async function applyCreateItem(
  tx: Tx,
  actorId: string,
  at: Date,
  input: Extract<ItemChangeInput, { kind: "createItem" }>,
  isAdmin: boolean,
): Promise<ItemChangeResultDto> {
  const category = await tx.resourceCategory.findUnique({ where: { id: input.categoryId }, include: { fields: true } });
  if (!category) throw new HttpError(400, "Choose an existing category.");
  if (!category.active) throw new HttpError(400, "This category is disabled.");
  if (!Number.isInteger(input.count) || input.count < 1) throw new HttpError(400, "Item count must be a positive whole number.");

  // Properties filled in at creation time — the same validation `setProperty` runs,
  // just against every given key at once rather than one at a time. An unknown key
  // fails closed (validatePropWrite's own `field: undefined` branch), never silently
  // dropped, so a client can't smuggle an arbitrary key into `Item.props`.
  const initialProps: Record<string, ItemPropValue> = {};
  if (input.props) {
    const fieldByKey = new Map(category.fields.map((f) => [f.key, f]));
    for (const [key, value] of Object.entries(input.props)) {
      initialProps[key] = validatePropWrite(fieldByKey.get(key), value);
    }
  }

  // F-029: a category's `required` fields must be filled on the root item(s) being created.
  // (Template children keep their blank start — they are auto-generated parts, not
  // something the caller could fill in — and existing rows are never forced.)
  const missingRequired = category.fields
    .filter((f) => f.required && (initialProps[f.key] === undefined || initialProps[f.key] === null || initialProps[f.key] === ""))
    .map((f) => f.label);
  if (missingRequired.length) {
    throw new HttpError(400, `Fill in the required field${missingRequired.length > 1 ? "s" : ""}: ${missingRequired.join(", ")}.`);
  }

  // Item-specific properties supplied by Add resources use exactly the same rules as
  // adding one later in Inspector. Build a fresh bag rather than trusting the record
  // keys verbatim: keys are trimmed, checked against category fields, checked against
  // one another using punctuation-insensitive comparison, and values remain typed.
  const initialCustomProps: CustomPropsBag = {};
  if (input.customProps) {
    for (const [rawKey, entry] of Object.entries(input.customProps)) {
      const key = assertValidCustomKey(rawKey);
      assertNoCollision(key, category.fields.map((field) => field.key), Object.keys(initialCustomProps));
      initialCustomProps[key] = { type: entry.type, value: validateCustomPropValue(entry.type, entry.value) };
    }
  }

  const parent = input.parentId ? await tx.item.findUnique({ where: { id: input.parentId } }) : null;
  if (input.parentId && (!parent || parent.deletedAt)) throw new HttpError(400, "The selected parent no longer exists.");

  // A CHILD (parentId set) always inherits its parent's accountability for a
  // non-admin caller — the client-supplied owner/current/custodian fields exist for
  // SYS_ADMIN corrections and for a brand-new ROOT (which has no parent to inherit
  // from and is validated by assertCanCreateRoot instead). Without this, a custodian
  // adding a resource under their own lab could fabricate inventory owned by, held
  // in, or answered for by an entirely different department (F-023 of the
  // 2026-09-15 campaign) — assertAuthorized's own custody check only covers the
  // PARENT, never these three fields.
  const trustClientFields = isAdmin || !parent;
  const ownerOrgNodeId = (trustClientFields ? input.ownerOrgNodeId : undefined) ?? parent?.ownerOrgNodeId;
  if (!ownerOrgNodeId) throw new HttpError(400, "A resource must have an owning unit.");
  const currentOrgNodeId = (trustClientFields ? input.currentOrgNodeId : undefined) ?? parent?.currentOrgNodeId ?? ownerOrgNodeId;
  // A resource must have a custodian; never deferred to after creation.
  const custodianId = (trustClientFields ? input.custodianId : undefined) ?? parent?.custodianId;
  if (!custodianId) throw new HttpError(400, "A resource must have a custodian.");

  const [ownerNode, currentNode, custodian] = await Promise.all([
    tx.orgNode.findUnique({ where: { id: ownerOrgNodeId } }),
    tx.orgNode.findUnique({ where: { id: currentOrgNodeId } }),
    tx.user.findUnique({ where: { id: custodianId } }),
  ]);
  if (!ownerNode?.active) throw new HttpError(400, "Choose an active owning unit.");
  if (!currentNode?.active) throw new HttpError(400, "Choose an active current unit.");
  if (!custodian) throw new HttpError(400, "Choose an existing custodian.");

  const categories = await loadAllCategoriesDomain(tx);
  assertPlacementAllowed(categories, input.categoryId, parent?.categoryId ?? null);
  const created = instantiateMany(
    categories,
    input.categoryId,
    input.parentId,
    input.count,
    { ownerOrgNodeId, currentOrgNodeId, custodianId, now: at.toISOString() },
    false,
    1,
    { baseName: input.name, props: Object.keys(initialProps).length ? initialProps : undefined },
  );
  if (!created.length) throw new HttpError(400, "Nothing to create.");

  const roots = created.filter((i) => i.parentId === input.parentId);
  const rootIds = new Set(roots.map((item) => item.id));
  await tx.item.createMany({
    data: created.map((item) => ({
      ...itemCreateData(item, categories),
      ...(rootIds.has(item.id) && Object.keys(initialCustomProps).length
        ? { customProps: initialCustomProps as Prisma.InputJsonValue }
        : {}),
    })),
  });

  const batchId = newId("b");
  await tx.itemChange.createMany({
    data: roots.map((item) => ({
      at,
      actorId,
      kind: "createItem" as const,
      targetKind: "ITEM" as const,
      itemId: item.id,
      itemName: item.name,
      categoryId: item.categoryId,
      batchId,
      note: input.note,
      ...scopeSnapshot(item),
    })),
  });

  return { applied: roots.length, itemIds: roots.map((r) => r.id) };
}

/** Every descendant of the given ids, self included, deepest-first — the order a
 *  cascading delete must run in against `Item.parent`'s `onDelete: Restrict`, and
 *  what a subtree move/transfer needs to re-point in one pass. */
async function subtreeDeepestFirst(tx: Tx, rootIds: string[]): Promise<PrismaItem[]> {
  if (!rootIds.length) return [];
  const rows = await tx.$queryRaw<{ id: string; depth: number }[]>`
    WITH RECURSIVE subtree AS (
      SELECT id, 0 AS depth FROM "Item" WHERE id = ANY(${rootIds}) AND "deletedAt" IS NULL
      UNION ALL
      SELECT i.id, s.depth + 1 FROM "Item" i INNER JOIN subtree s ON i."parentId" = s.id WHERE i."deletedAt" IS NULL
    )
    SELECT id, MAX(depth) AS depth FROM subtree GROUP BY id
  `;
  const ids = rows.sort((a, b) => b.depth - a.depth).map((r) => r.id);
  const items = await tx.item.findMany({ where: { id: { in: ids } } });
  const byId = new Map(items.map((i) => [i.id, i]));
  return ids.map((id) => byId.get(id)).filter((i): i is PrismaItem => Boolean(i));
}

/**
 * A selection made in the register's tree ticks a row's whole subtree along with it, so
 * a move or transfer can arrive naming both a container AND things already inside it.
 * Treating every id as a root would pull each nested part out on its own — a computer
 * moved as a computer, plus its RAM re-parented straight into the destination beside it.
 * Only the top-most selected items move; everything under them travels with them, as it
 * always has. Order is preserved.
 */
export async function topMostItemIds(tx: Tx, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (unique.length < 2) return unique;
  const nested = await tx.$queryRaw<{ start: string }[]>`
    WITH RECURSIVE ancestry AS (
      SELECT id AS start, "parentId" AS ancestor FROM "Item" WHERE id = ANY(${unique})
      UNION ALL
      SELECT a.start, i."parentId" FROM "Item" i INNER JOIN ancestry a ON i.id = a.ancestor WHERE a.ancestor IS NOT NULL
    )
    SELECT DISTINCT start FROM ancestry WHERE ancestor = ANY(${unique})
  `;
  const drop = new Set(nested.map((r) => r.start));
  return unique.filter((id) => !drop.has(id));
}

async function isWithinSubtree(tx: Tx, ancestorId: string, candidateId: string): Promise<boolean> {
  if (ancestorId === candidateId) return true;
  const subtree = await tx.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE subtree AS (
      SELECT id FROM "Item" WHERE id = ${ancestorId} AND "deletedAt" IS NULL
      UNION ALL
      SELECT i.id FROM "Item" i INNER JOIN subtree s ON i."parentId" = s.id WHERE i."deletedAt" IS NULL
    )
    SELECT id FROM subtree
  `;
  return subtree.some((r) => r.id === candidateId);
}

/**
 * A subtree can contain a descendant outside the actor's own custody — nothing stops
 * one department's item from ending up physically nested inside another's container
 * through ordinary loan/transfer activity (moveInTree only re-points the root being
 * moved; a foreign item already inside it comes along structurally, not by a write
 * to its own row). `deleteItem` and `transferItem` both act on a whole subtree at
 * once, so both must refuse rather than silently sweep up something the actor could
 * never have touched directly. Whole-refusal, not partial — same as a stale category
 * version. Custody-based like every other write check here (`assertCanMutate` itself
 * short-circuits for SYS_ADMIN), not the broader read scope — a descendant merely
 * inside the actor's visible org subtree is still not theirs to delete or transfer.
 */
async function assertSubtreeInScope(actorId: string, subtree: PrismaItem[]): Promise<void> {
  await scope.assertCanMutate(actorId, subtree.map((i) => i.id));
}

/** The precise, named version of `assertSubtreeInScope`'s blanket 404 — used only once
 *  the batched check has already failed, so the actor demonstrably has SOME standing
 *  over this subtree (the batched call above already lets a fully-authorized delete
 *  through cheaply; this is the failure-path cost only). One `assertCanMutate` call
 *  per row reuses the exact same authorization rule (the write-custody walk) rather
 *  than re-deriving it, so the two never drift apart. */
async function foreignAccountabilityBlockers(actorId: string, subtree: PrismaItem[]): Promise<PrismaItem[]> {
  if (await scope.isSysAdmin(actorId)) return [];
  const blockers: PrismaItem[] = [];
  for (const item of subtree) {
    try {
      await scope.assertCanMutate(actorId, [item.id]);
    } catch {
      blockers.push(item);
    }
  }
  return blockers;
}

/**
 * Live records that a hard delete would otherwise cascade away with no trace: a
 * future REQUESTED/HELD/CONFIRMED booking or an active class series touching the
 * subtree (F-049 of the 2026-09-15 campaign — today's FK cascade erases confirmed,
 * even PAID, bookings the instant their room is deleted, with no notice to whoever
 * holds them), or a PENDING transfer naming a subtree item (part of F-041 — a
 * transfer mid-flight for an item that is about to stop existing). Applies to
 * EVERYONE, including SYS_ADMIN: this is a data-safety floor, not an authorization
 * question — an admin's delete must not silently orphan someone else's paid
 * reservation any more than a custodian's may.
 */
async function liveDependentBlockers(tx: Tx, subtreeIds: string[]): Promise<string[]> {
  if (!subtreeIds.length) return [];
  const now = new Date();
  const [reservations, series, transfers, drafts] = await Promise.all([
    tx.reservation.findMany({
      where: {
        state: { in: ["REQUESTED", "HELD", "CONFIRMED"] },
        endsAt: { gt: now },
        OR: [{ labItemId: { in: subtreeIds } }, { resources: { some: { itemId: { in: subtreeIds } } } }],
      },
      select: { title: true },
      take: 5,
    }),
    tx.scheduleSeries.findMany({
      where: { active: true, OR: [{ labItemId: { in: subtreeIds } }, { resources: { some: { itemId: { in: subtreeIds } } } }] },
      select: { title: true },
      take: 5,
    }),
    tx.$queryRaw<{ summary: string }[]>`
      SELECT summary FROM "ChangeRequest" WHERE status = 'PENDING' AND payload -> 'itemIds' ?| ${subtreeIds}::text[] LIMIT 5
    `,
    tx.itemDraftChange.findMany({ where: { status: { in: ["OPEN", "SUBMITTED"] }, labItemId: { in: subtreeIds } }, select: { id: true }, take: 5 }),
  ]);
  const blockers: string[] = [];
  if (reservations.length) blockers.push(`${reservations.length} upcoming booking(s) (e.g. "${reservations[0].title}")`);
  if (series.length) blockers.push(`${series.length} active class timetable(s) (e.g. "${series[0].title}")`);
  if (transfers.length) blockers.push(`${transfers.length} pending transfer request(s) (e.g. "${transfers[0].summary}")`);
  if (drafts.length) blockers.push(`${drafts.length} staged draft change(s) awaiting submission or approval`);
  return blockers;
}

async function applyDeleteItem(
  tx: Tx,
  actorId: string,
  at: Date,
  input: Extract<ItemChangeInput, { kind: "deleteItem" }>,
  cleanupKeys: string[],
): Promise<ItemChangeResultDto> {
  const roots = await tx.item.findMany({ where: { id: { in: input.itemIds }, deletedAt: null } });
  if (!roots.length) return { applied: 0, itemIds: [] };

  const doomed = await subtreeDeepestFirst(tx, roots.map((r) => r.id));
  try {
    await assertSubtreeInScope(actorId, doomed);
  } catch (err) {
    // The cheap batched check failed — the actor has SOME standing here (assertAuthorized
    // already confirmed it for the roots before this transaction opened) but the subtree
    // contains something they don't account for. Name it (F-020): the actor can already
    // see it (it's physically inside something they run), so naming it is not a new leak.
    const blockers = await foreignAccountabilityBlockers(actorId, doomed);
    if (!blockers.length) throw err; // the actor has no standing at all — the original 404 stands
    throw new HttpError(409, "Cannot delete", {
      message: `Cannot delete — it contains ${blockers.length} resource(s) this account does not answer for: ${blockers.map((b) => `"${b.name}"`).join(", ")}.`,
      code: "CONTAINS_FOREIGN_ITEMS",
    });
  }

  const liveBlockers = await liveDependentBlockers(tx, doomed.map((d) => d.id));
  if (liveBlockers.length) {
    throw new HttpError(409, "Cannot delete", {
      message: `Cannot delete — it still has ${liveBlockers.join("; ")}. Cancel or resolve these first.`,
      code: "HAS_LIVE_DEPENDENTS",
    });
  }

  // F-025 of the 2026-09-15 campaign: this used to be a hard `tx.item.delete`,
  // which — via Prisma's own onDelete: Cascade on every child table (ItemImage,
  // ImageUpload, CustomProperty, ItemDraftChange, LabIdealTarget, and Reservation/
  // ScheduleSeries/ReservationResource, whose live rows liveDependentBlockers
  // above already refuses to proceed past) — destroyed the subtree's own data
  // with only the ItemChange audit row surviving, and no way back from a
  // fat-fingered delete. Soft delete instead: every reader already filters
  // `deletedAt: null` (this is exactly the column existing readers were built
  // against), so setting it here is what actually turns that intent on. Nothing
  // physical is removed either — a soft-deleted item's photos stay exactly where
  // they are, recoverable along with the row itself, so `cleanupKeys` (storage
  // removal) does not apply to this path the way it does to an explicit
  // removeImage.
  const doomedIds = doomed.map((d) => d.id);
  await tx.item.updateMany({ where: { id: { in: doomedIds } }, data: { deletedAt: at } });

  const batchId = roots.length > 1 ? newId("b") : undefined;
  await tx.itemChange.createMany({
    data: roots.map((r) => ({
      at,
      actorId,
      kind: "deleteItem" as const,
      targetKind: "ITEM" as const,
      itemId: r.id,
      itemName: r.name,
      categoryId: r.categoryId,
      batchId,
      note: input.note,
      ...scopeSnapshot(r),
    })),
  });
  return { applied: roots.length, itemIds: roots.map((r) => r.id) };
}

async function applyTransferItem(
  tx: Tx,
  actorId: string,
  at: Date,
  input: Extract<ItemChangeInput, { kind: "transferItem" }>,
): Promise<ItemChangeResultDto> {
  const { targetParentId, targetOrgNodeId, targetCustodianId, transferOwnership } = input.transfer;
  const [destination, targetNode] = await Promise.all([
    tx.item.findUnique({ where: { id: targetParentId } }),
    tx.orgNode.findUnique({ where: { id: targetOrgNodeId } }),
  ]);
  if (!destination || destination.deletedAt) throw new HttpError(400, "The destination no longer exists.");
  if (!targetNode?.active) throw new HttpError(400, "Choose a receiving unit.");
  if (targetCustodianId) {
    const custodian = await tx.user.findUnique({ where: { id: targetCustodianId } });
    if (!custodian) throw new HttpError(400, "Choose an existing custodian.");
  }

  const roots = await tx.item.findMany({ where: { id: { in: await topMostItemIds(tx, input.itemIds) }, deletedAt: null } });
  const applied: string[] = [];
  // A handover writes several log lines per resource (position, ownership, custody),
  // so it always groups them; a plain borrow keeps the old one-line-per-root shape.
  const batchId = roots.length > 1 || transferOwnership || targetCustodianId ? newId("b") : undefined;

  // Whole-refusal, not partial — same discipline assertSubtreeInScope's own header
  // describes for a policy check, as opposed to the per-root "skip, don't abort" below
  // which guards a structural impossibility (self-nesting), not a business rule.
  const categories = await loadAllCategoriesDomain(tx);
  for (const root of roots) assertPlacementAllowed(categories, root.categoryId, destination.categoryId);

  for (const root of roots) {
    if (root.id === targetParentId || (await isWithinSubtree(tx, root.id, targetParentId))) {
      continue; // a resource cannot be moved inside itself — skipped, not an abort
    }
    const subtree = await subtreeDeepestFirst(tx, [root.id]);
    // A pull is authorized by its approved chain, not the requester's custody of what
    // they asked for (see assertAuthorized); a store handover still moves only what
    // the store keeper actually holds.
    if (transferOwnership) await assertSubtreeInScope(actorId, subtree);
    for (const node of subtree) {
      await tx.item.update({
        where: { id: node.id },
        data: {
          parentId: node.id === root.id ? targetParentId : node.parentId,
          currentOrgNodeId: targetOrgNodeId,
          ownerOrgNodeId: transferOwnership ? targetOrgNodeId : node.ownerOrgNodeId,
          custodianId: targetCustodianId ?? node.custodianId,
          version: { increment: 1 },
        },
      });
    }
    const fromName = root.parentId ? ((await tx.item.findUnique({ where: { id: root.parentId } }))?.name ?? "top level") : "top level";
    await tx.itemChange.create({
      data: {
        at,
        actorId,
        kind: "transferItem",
        targetKind: "ITEM",
        itemId: root.id,
        itemName: root.name,
        categoryId: root.categoryId,
        field: "parentId",
        before: fromName,
        after: destination.name,
        batchId,
        note: input.note,
        // The state this transfer RESULTS in, not root's pre-transfer snapshot — see
        // scopeSnapshot's own header.
        ...scopeSnapshot({ ownerOrgNodeId: transferOwnership ? targetOrgNodeId : root.ownerOrgNodeId, currentOrgNodeId: targetOrgNodeId, custodianId: targetCustodianId ?? root.custodianId }),
      },
    });
    const resulting = {
      ownerOrgNodeId: transferOwnership ? targetOrgNodeId : root.ownerOrgNodeId,
      currentOrgNodeId: targetOrgNodeId,
      custodianId: targetCustodianId ?? root.custodianId,
    };
    const accountability: Array<{ kind: "setOwnerOrg" | "setCustodian"; field: string; before: string; after: string }> = [];
    if (transferOwnership && root.ownerOrgNodeId !== targetOrgNodeId) {
      accountability.push({ kind: "setOwnerOrg", field: "ownerOrgNodeId", before: root.ownerOrgNodeId, after: targetOrgNodeId });
    }
    if (targetCustodianId && root.custodianId !== targetCustodianId) {
      accountability.push({ kind: "setCustodian", field: "custodianId", before: root.custodianId, after: targetCustodianId });
    }
    for (const line of accountability) {
      await tx.itemChange.create({
        data: {
          at,
          actorId,
          kind: line.kind,
          targetKind: "ITEM",
          itemId: root.id,
          itemName: root.name,
          categoryId: root.categoryId,
          field: line.field,
          before: line.before,
          after: line.after,
          batchId,
          note: input.note,
          ...scopeSnapshot(resulting),
        },
      });
    }
    applied.push(root.id);
  }

  return { applied: applied.length, itemIds: applied };
}

async function applyMoveInTree(tx: Tx, actorId: string, at: Date, input: Extract<ItemChangeInput, { kind: "moveInTree" }>, isAdmin: boolean): Promise<ItemChangeResultDto> {
  let target: PrismaItem | null = null;
  if (input.value !== null) {
    target = await tx.item.findUnique({ where: { id: input.value } });
    if (!target || target.deletedAt) throw new HttpError(400, "Choose an existing destination.");
  }

  const roots = await tx.item.findMany({ where: { id: { in: await topMostItemIds(tx, input.itemIds) }, deletedAt: null } });
  // F-041 of the 2026-09-15 campaign: an item named in a PENDING transfer request
  // could still be freely moved elsewhere in the meantime — the chain kept walking
  // for a resource whose containment no longer matched what everyone approving it
  // was shown, discovered only at the very last (receipt) step as an unexplained
  // "Version conflict". decideStep now also re-validates on every decision (see
  // approvals.ts), but blocking the move itself, up front, is the more honest fix:
  // the actor doing the moving is told immediately, in their own words, instead of
  // leaving a stranger's approval to fail silently later.
  if (roots.length) {
    const pending = await tx.$queryRaw<{ summary: string }[]>`
      SELECT summary FROM "ChangeRequest" WHERE status = 'PENDING' AND payload -> 'itemIds' ?| ${roots.map((r) => r.id)}::text[] LIMIT 1
    `;
    if (pending.length) {
      throw new HttpError(409, `Cannot move — it is named in a pending transfer request ("${pending[0].summary}"). Cancel or resolve that first.`);
    }
  }
  const applied: string[] = [];
  const batchId = roots.length > 1 ? newId("b") : undefined;

  const categories = await loadAllCategoriesDomain(tx);
  for (const root of roots) assertPlacementAllowed(categories, root.categoryId, target?.categoryId ?? null);

  // `moveInTree` never touches `currentOrgNodeId` — it is reordering WITHIN a unit's
  // own containment tree, never a relocation between units (that is `transferItem`'s
  // job, routed through approvals). For a non-admin, refuse crossing a unit boundary
  // outright rather than silently leaving `currentOrgNodeId` stale: a borrowed item
  // (current ≠ owner) moved by its own lender back into the lender's own tree would
  // otherwise "return" physically while the register still recorded it as sitting in
  // the borrower's unit (F-039 of the 2026-09-15 campaign) — real returns go through
  // `requestTransfer`'s dedicated flow (Phase 1C), which does update the column.
  const targetUnit = target ? target.currentOrgNodeId : null;
  for (const root of roots) {
    if (target) {
      if (target.id === root.id || (await isWithinSubtree(tx, root.id, target.id))) continue; // skipped, not an abort
    }
    if (root.parentId === (target?.id ?? null)) continue; // no-op
    if (!isAdmin) {
      const destinationUnit = targetUnit ?? root.ownerOrgNodeId; // moving to top-level returns it to its own owner
      if (destinationUnit !== root.currentOrgNodeId) {
        throw new HttpError(400, `"${root.name}" is not currently in that unit — use Transfer to move a resource between units.`);
      }
    }

    await tx.item.update({ where: { id: root.id }, data: { parentId: target?.id ?? null, version: { increment: 1 } } });
    await tx.itemChange.create({
      data: {
        at,
        actorId,
        kind: "moveInTree",
        targetKind: "ITEM",
        itemId: root.id,
        itemName: root.name,
        categoryId: root.categoryId,
        field: "parentId",
        before: jsonOrNull(root.parentId),
        after: jsonOrNull(target?.id ?? null),
        batchId,
        note: input.note,
        ...scopeSnapshot(root),
      },
    });
    applied.push(root.id);
  }

  return { applied: applied.length, itemIds: applied };
}

async function applySetProperty(tx: Tx, actorId: string, at: Date, input: Extract<ItemChangeInput, { kind: "setProperty" }>): Promise<ItemChangeResultDto> {
  const items = await tx.item.findMany({ where: { id: { in: input.itemIds }, deletedAt: null } });
  const categoryIds = [...new Set(items.map((i) => i.categoryId))];
  const fields = await tx.categoryField.findMany({ where: { categoryId: { in: categoryIds } } });
  const fieldsByCategory = new Map<string, Map<string, (typeof fields)[number]>>();
  for (const f of fields) {
    if (!fieldsByCategory.has(f.categoryId)) fieldsByCategory.set(f.categoryId, new Map());
    fieldsByCategory.get(f.categoryId)!.set(f.key, f);
  }

  const applied: string[] = [];
  const batchId = items.length > 1 ? newId("b") : undefined;
  for (const item of items) {
    // Every selected item must actually define the property — a bulk edit spanning
    // two categories that happen to share a key must not silently write a value one
    // of them cannot hold. A thrown HttpError here aborts the whole transaction, so
    // no partial bulk write survives a bad item.
    const field = fieldsByCategory.get(item.categoryId)?.get(input.propKey);
    const validated = validatePropWrite(field, input.value);
    const before = (item.props as Record<string, unknown>)?.[input.propKey] ?? null;
    if (before === validated) continue; // no-op
    const nextProps = { ...(item.props as Record<string, unknown>), [input.propKey]: validated };
    await tx.item.update({ where: { id: item.id }, data: { props: nextProps as Prisma.InputJsonValue, version: { increment: 1 } } });
    await tx.itemChange.create({
      data: {
        at,
        actorId,
        kind: "setProperty",
        targetKind: "ITEM",
        itemId: item.id,
        itemName: item.name,
        categoryId: item.categoryId,
        field: input.propKey,
        before: jsonOrNull(before),
        after: jsonOrNull(validated),
        batchId,
        note: input.note,
        ...scopeSnapshot(item),
      },
    });
    applied.push(item.id);
  }
  return { applied: applied.length, itemIds: applied };
}

type CustomPropsBag = Record<string, { type: CustomPropType; value: Prisma.JsonValue }>;

/**
 * Creates a NEW item-specific property — the supplement to a category's own typed
 * schema, never a substitute for it (custom-props.ts's own header). Collision-checked
 * against both the item's category fields (the "brand" pretending to be THE brand
 * case) and this item's own other custom properties (the actual duplicate case), both
 * normalized so spacing/casing cannot hide a collision. Single item only — a custom
 * property is a fact about ONE resource by definition, never a bulk write.
 */
async function applyAddCustomProperty(
  tx: Tx,
  actorId: string,
  at: Date,
  input: Extract<ItemChangeInput, { kind: "addCustomProperty" }>,
): Promise<ItemChangeResultDto> {
  const item = await tx.item.findUnique({ where: { id: input.itemIds[0] } });
  if (!item || item.deletedAt) throw new HttpError(400, "That resource no longer exists.");

  const key = assertValidCustomKey(input.key);
  const category = await tx.resourceCategory.findUnique({ where: { id: item.categoryId }, include: { fields: { select: { key: true } } } });
  const existing = (item.customProps as CustomPropsBag) ?? {};
  assertNoCollision(key, category?.fields.map((f) => f.key) ?? [], Object.keys(existing));

  const value = validateCustomPropValue(input.type, input.value);
  const next: CustomPropsBag = { ...existing, [key]: { type: input.type, value } };

  await tx.item.update({ where: { id: item.id }, data: { customProps: next as Prisma.InputJsonValue, version: { increment: 1 } } });
  await tx.itemChange.create({
    data: {
      at,
      actorId,
      kind: "addCustomProperty",
      targetKind: "ITEM",
      itemId: item.id,
      itemName: item.name,
      categoryId: item.categoryId,
      field: key,
      before: Prisma.DbNull,
      after: jsonOrNull(value),
      note: input.note,
      ...scopeSnapshot(item),
    },
  });
  return { applied: 1, itemIds: [item.id] };
}

/** Edits the VALUE of an existing custom property — its type, chosen once at
 *  creation, never changes here; removing and re-adding is how a type actually
 *  changes, the same "remove strands the old value, re-adding restores it" discipline
 *  a category field already follows. `value: null` clears without removing the key. */
async function applySetCustomProperty(
  tx: Tx,
  actorId: string,
  at: Date,
  input: Extract<ItemChangeInput, { kind: "setCustomProperty" }>,
): Promise<ItemChangeResultDto> {
  const item = await tx.item.findUnique({ where: { id: input.itemIds[0] } });
  if (!item || item.deletedAt) throw new HttpError(400, "That resource no longer exists.");

  const existing = (item.customProps as CustomPropsBag) ?? {};
  const entry = existing[input.key];
  if (!entry) throw new HttpError(400, "That property does not exist on this item.");

  const value = validateCustomPropValue(entry.type, input.value);
  if (value === entry.value) return { applied: 0, itemIds: [] }; // no-op

  const next: CustomPropsBag = { ...existing, [input.key]: { type: entry.type, value } };
  await tx.item.update({ where: { id: item.id }, data: { customProps: next as Prisma.InputJsonValue, version: { increment: 1 } } });
  await tx.itemChange.create({
    data: {
      at,
      actorId,
      kind: "setCustomProperty",
      targetKind: "ITEM",
      itemId: item.id,
      itemName: item.name,
      categoryId: item.categoryId,
      field: input.key,
      before: jsonOrNull(entry.value),
      after: jsonOrNull(value),
      note: input.note,
      ...scopeSnapshot(item),
    },
  });
  return { applied: 1, itemIds: [item.id] };
}

async function applyRemoveCustomProperty(
  tx: Tx,
  actorId: string,
  at: Date,
  input: Extract<ItemChangeInput, { kind: "removeCustomProperty" }>,
): Promise<ItemChangeResultDto> {
  const item = await tx.item.findUnique({ where: { id: input.itemIds[0] } });
  if (!item || item.deletedAt) throw new HttpError(400, "That resource no longer exists.");

  const existing = (item.customProps as CustomPropsBag) ?? {};
  const entry = existing[input.key];
  if (!entry) throw new HttpError(400, "That property does not exist on this item.");

  const { [input.key]: _removed, ...rest } = existing;
  await tx.item.update({ where: { id: item.id }, data: { customProps: rest as Prisma.InputJsonValue, version: { increment: 1 } } });
  await tx.itemChange.create({
    data: {
      at,
      actorId,
      kind: "removeCustomProperty",
      targetKind: "ITEM",
      itemId: item.id,
      itemName: item.name,
      categoryId: item.categoryId,
      field: input.key,
      before: jsonOrNull(entry.value),
      after: Prisma.DbNull,
      note: input.note,
      ...scopeSnapshot(item),
    },
  });
  return { applied: 1, itemIds: [item.id] };
}

/**
 * Finalizes a two-step upload. `input.uploadSessionId` is looked up against
 * `ImageUpload`, never trusted as-is — this is the ONE place a session may turn into
 * a real `ItemImage`, and every fact copied onto that row (`storageKey`/
 * `contentType`/`byteSize`/`width`/`height`) comes from the session, which itself was
 * only ever written by `images.ts`'s `receiveUpload` from bytes it sniffed itself.
 * Marking the session FINALIZED inside the SAME transaction that creates the
 * `ItemImage` row is what makes "finalize this session twice" and "finalize a session
 * some other item already claimed" both impossible, not just unlikely.
 */
async function applyAddImage(tx: Tx, actorId: string, at: Date, input: Extract<ItemChangeInput, { kind: "addImage" }>): Promise<ItemChangeResultDto> {
  const item = await tx.item.findUnique({ where: { id: input.itemIds[0] } });
  if (!item || item.deletedAt) throw new HttpError(400, "That resource no longer exists.");

  const upload = await tx.imageUpload.findUnique({ where: { id: input.uploadSessionId } });
  if (!upload || upload.itemId !== item.id) throw new HttpError(400, "That upload session does not exist for this resource.");
  if (upload.requestedById !== actorId) throw new HttpError(400, "That upload session belongs to someone else.");
  if (upload.status === "FINALIZED") throw new HttpError(409, "That photo has already been added.", { message: "That photo has already been added.", code: "UPLOAD_ALREADY_FINALIZED" });
  if (upload.status !== "UPLOADED") throw new HttpError(400, "Upload the photo before adding it.");
  if (upload.expiresAt < at) throw new HttpError(409, "This upload session has expired — choose the file again.", { message: "This upload session has expired — choose the file again.", code: "UPLOAD_SESSION_EXPIRED" });

  const image = await tx.itemImage.create({
    data: {
      itemId: item.id,
      storageKey: upload.storageKey,
      contentType: upload.contentType!,
      byteSize: upload.byteSize!,
      width: upload.width,
      height: upload.height,
      caption: input.caption,
      uploadedById: actorId,
    },
  });
  await tx.imageUpload.update({ where: { id: upload.id }, data: { status: "FINALIZED", finalizedAt: at } });
  await tx.item.update({ where: { id: item.id }, data: { version: { increment: 1 } } });
  await tx.itemChange.create({
    data: {
      at,
      actorId,
      kind: "addImage",
      targetKind: "ITEM",
      itemId: item.id,
      itemName: item.name,
      categoryId: item.categoryId,
      after: image.caption ?? "photo",
      note: input.note,
      ...scopeSnapshot(item),
    },
  });
  return { applied: 1, itemIds: [item.id] };
}

async function applyRemoveImage(
  tx: Tx,
  actorId: string,
  at: Date,
  input: Extract<ItemChangeInput, { kind: "removeImage" }>,
  cleanupKeys: string[],
): Promise<ItemChangeResultDto> {
  const item = await tx.item.findUnique({ where: { id: input.itemIds[0] } });
  if (!item || item.deletedAt) throw new HttpError(400, "That resource no longer exists.");
  const image = await tx.itemImage.findUnique({ where: { id: input.imageId } });
  if (!image || image.itemId !== item.id) throw new HttpError(400, "That photo is not on this resource.");

  await tx.itemImage.delete({ where: { id: image.id } });
  cleanupKeys.push(image.storageKey);
  await tx.item.update({ where: { id: item.id }, data: { version: { increment: 1 } } });
  await tx.itemChange.create({
    data: {
      at,
      actorId,
      kind: "removeImage",
      targetKind: "ITEM",
      itemId: item.id,
      itemName: item.name,
      categoryId: item.categoryId,
      before: image.caption ?? "photo",
      note: input.note,
      ...scopeSnapshot(item),
    },
  });
  return { applied: 1, itemIds: [item.id] };
}

/** setName / setStatus / setQuantity / setCustodian / setOwnerOrg / setCurrentOrg —
 *  the same "one field, one value, applied to every id" shape temp_works' `apply()`
 *  handles through `fieldForKind`. */
async function applyFieldChange(
  tx: Tx,
  actorId: string,
  at: Date,
  input: Extract<ItemChangeInput, { kind: "setName" | "setStatus" | "setQuantity" | "setCustodian" | "setOwnerOrg" | "setCurrentOrg" }>,
): Promise<ItemChangeResultDto> {
  const field = FIELD_FOR_KIND[input.kind];
  const items = await tx.item.findMany({ where: { id: { in: input.itemIds }, deletedAt: null } });

  if (input.kind === "setCustodian") {
    const custodian = await tx.user.findUnique({ where: { id: input.value } });
    if (!custodian) throw new HttpError(400, "Choose an existing custodian.");
  }
  if (input.kind === "setOwnerOrg" || input.kind === "setCurrentOrg") {
    const node = await tx.orgNode.findUnique({ where: { id: input.value } });
    if (!node?.active) throw new HttpError(400, "Choose an organization unit.");
  }

  const applied: string[] = [];
  const batchId = items.length > 1 ? newId("b") : undefined;
  for (const item of items) {
    if (input.kind === "setQuantity" && item.countingMode === "SERIALIZED" && input.value !== 1) {
      throw new HttpError(400, "Serialized items always have a quantity of 1.");
    }
    // qty is a Prisma.Decimal, never === the plain number the wire input carries —
    // normalise both sides to a number before comparing, or a setQuantity to the
    // already-current value would never be recognised as a no-op.
    const before: unknown = input.kind === "setQuantity" ? item.qty.toNumber() : (item as unknown as Record<string, unknown>)[field];
    if (before === input.value) continue; // no-op
    const value = input.kind === "setQuantity" ? new Prisma.Decimal(input.value) : input.value;

    await tx.item.update({ where: { id: item.id }, data: { [field]: value, version: { increment: 1 } } });
    await tx.itemChange.create({
      data: {
        at,
        actorId,
        kind: input.kind,
        targetKind: "ITEM",
        itemId: item.id,
        itemName: item.name,
        categoryId: item.categoryId,
        field,
        before: jsonOrNull(before),
        after: jsonOrNull(input.value),
        batchId,
        note: input.note,
        // The state THIS change results in — a setCustodian/setOwnerOrg/setCurrentOrg
        // row snapshots the NEW value for the field it just changed, everything else
        // unchanged; every other kind here leaves all three as they already were.
        ...scopeSnapshot({
          ownerOrgNodeId: input.kind === "setOwnerOrg" ? input.value : item.ownerOrgNodeId,
          currentOrgNodeId: input.kind === "setCurrentOrg" ? input.value : item.currentOrgNodeId,
          custodianId: input.kind === "setCustodian" ? input.value : item.custodianId,
        }),
      },
    });
    applied.push(item.id);
  }
  return { applied: applied.length, itemIds: applied };
}

const FIELD_FOR_KIND: Record<"setName" | "setStatus" | "setQuantity" | "setCustodian" | "setOwnerOrg" | "setCurrentOrg", string> = {
  setName: "name",
  setStatus: "status",
  setQuantity: "qty",
  setCustodian: "custodianId",
  setOwnerOrg: "ownerOrgNodeId",
  setCurrentOrg: "currentOrgNodeId",
};
