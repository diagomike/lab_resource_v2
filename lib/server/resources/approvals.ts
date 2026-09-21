import "server-only";
import type { Prisma, ChainStep as PrismaChainStep } from "@prisma/client";
import type { ChangeRequestDto, ChainStepDto, ItemChangeInput, RequestTransferResultDto } from "@/lib/shared";
import { prisma } from "../prisma";
import { HttpError } from "../http-error";
import * as scope from "./scope";
import { applyChange, topMostItemIds } from "./mutate";
import { toDomainCategoryMap, toDomainItem } from "./adapt";
import { canPlace } from "@/lib/domain/placement";
import {
  activate,
  buildChain,
  buildOrgIndex,
  canDecide,
  chainSettled,
  currentStep,
  resolveApprover,
  resolvePolicy,
  validateChain,
  type ApprovalPolicy as DomainPolicy,
  type ChainStep as DomainChainStep,
} from "@/lib/domain/approvals";
import type { OrgNode as DomainOrgNode, Person } from "@/lib/domain/types";

/**
 * Track 3 — cross-lab transfers, the multi-office chain engine's first real use. See
 * ~/.claude/plans/lets-merge-the-work-memoized-journal.md §6 for the full design.
 *
 * Ported from temp_works/src/lib/store.ts's `route()` (deciding what should happen to
 * a change) and `decideRequest()` (walking a chain to its conclusion) — the exact
 * reference implementation lib/domain/approvals.ts's 45 tests were already written
 * against — substituting live Prisma reads/writes for the sandbox's in-memory store,
 * the same way lab-drafts.ts ported its own reference logic.
 *
 * Deliberately narrow: this module reads `ApprovalPolicy` rows for `transferItem`
 * ONLY. Every other `ItemChangeKind` keeps applying directly through mutate.ts,
 * completely unaffected — see §6.1 for why seeding the full SEED_POLICIES set is
 * still safe.
 */

type TransferInput = Extract<ItemChangeInput, { kind: "transferItem" }>;

// ── Loading live domain data — never cached, never re-derived from a stale read ──

async function loadPerson(userId: string): Promise<Person | undefined> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, homeNodeId: true } });
  if (!user) return undefined;
  const roles = await scope.rolesOf(userId);
  return { id: user.id, name: user.name, homeOrgNodeId: user.homeNodeId, roles };
}

/** Every org node, in the shape lib/domain/approvals.ts's chain builder walks —
 *  `parentIds` is unused by a transfer's own selectors (OWNER_HEAD/TARGET_HEAD/
 *  ITEM_CUSTODIAN/REQUESTER_RECEIPT are all direct lookups, no HIERARCHY walk), but
 *  ChainContext.orgIndex still needs building, so this stays a real conversion
 *  rather than a stub. */
async function loadDomainOrgNodes(): Promise<DomainOrgNode[]> {
  const rows = await prisma.orgNode.findMany({ include: { incomingEdges: true } });
  return rows.map((n) => ({
    id: n.id,
    name: n.name,
    kind: n.kind,
    level: n.level,
    parentIds: n.incomingEdges.map((e) => e.parentId),
    occupantId: n.userId,
    active: n.active,
  }));
}

async function loadPolicies(operation: ItemChangeInput["kind"]): Promise<DomainPolicy[]> {
  const rows = await prisma.approvalPolicy.findMany({ where: { operation, enabled: true } });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    operation: r.operation as DomainPolicy["operation"],
    appliesTo: r.appliesTo as DomainPolicy["appliesTo"],
    actorRole: (r.actorRole ?? "ANY") as DomainPolicy["actorRole"],
    outcome: r.outcome,
    chain: (r.chain as DomainPolicy["chain"] | null) ?? undefined,
    enabled: r.enabled,
  }));
}

function toDomainStep(row: PrismaChainStep): DomainChainStep {
  return {
    id: row.id,
    order: row.order,
    selector: row.selector,
    label: row.label,
    nodeId: row.nodeId,
    approverId: row.approverId,
    status: row.status,
    skipReason: row.skipReason,
    receipt: row.receipt,
    decidedById: row.decidedById ?? undefined,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : undefined,
    note: row.note ?? undefined,
  };
}

// ── Resolving what should happen to a transfer, without doing any of it ─────────
//
// Pure with respect to the database in the sense that it commits nothing — used by
// both `requestTransfer` (which then acts on the answer) and `previewTransfer` (which
// shows it to the requester before they commit to asking).

interface TransferContext {
  items: Array<{ id: string; name: string; categoryId: string; parentId: string | null; ownerOrgNodeId: string; currentOrgNodeId: string; custodianId: string; version: number }>;
  destination: { id: string; name: string; categoryId: string; custodianId: string };
}

/** The fields a transfer actually depends on — F-041 of the 2026-09-15 campaign.
 *  Deliberately excludes `version` (which a cosmetic edit like a rename bumps just
 *  as readily as a structural one) and every other column (name, properties, ...). */
interface StructuralFields {
  parentId: string | null;
  ownerOrgNodeId: string;
  currentOrgNodeId: string;
  custodianId: string;
}

function structuralFieldsOf(item: { parentId: string | null; ownerOrgNodeId: string; currentOrgNodeId: string; custodianId: string }): StructuralFields {
  return { parentId: item.parentId, ownerOrgNodeId: item.ownerOrgNodeId, currentOrgNodeId: item.currentOrgNodeId, custodianId: item.custodianId };
}

function structuralFieldsEqual(a: StructuralFields, b: StructuralFields): boolean {
  return a.parentId === b.parentId && a.ownerOrgNodeId === b.ownerOrgNodeId && a.currentOrgNodeId === b.currentOrgNodeId && a.custodianId === b.custodianId;
}

async function loadTransferContext(input: TransferInput): Promise<TransferContext> {
  const items = await prisma.item.findMany({ where: { id: { in: input.itemIds }, deletedAt: null } });
  if (items.length !== input.itemIds.length) throw new HttpError(400, "One or more of these resources no longer exist.");

  const destination = await prisma.item.findUnique({ where: { id: input.transfer.targetParentId } });
  if (!destination || destination.deletedAt) throw new HttpError(400, "The destination no longer exists.");

  const targetNode = await prisma.orgNode.findUnique({ where: { id: input.transfer.targetOrgNodeId } });
  if (!targetNode?.active) throw new HttpError(400, "Choose an active receiving unit.");

  if (input.transfer.targetCustodianId) {
    const custodian = await prisma.user.findUnique({ where: { id: input.transfer.targetCustodianId } });
    if (!custodian) throw new HttpError(400, "Choose an existing custodian.");
    // F-024 of the 2026-09-15 campaign: a handover's receiving custodian was only
    // ever checked for existing, the same gap setCustodian and root creation had —
    // custody landing on a disabled account or a student stalls the receipt step
    // forever (they can never sign in to confirm it, or shouldn't hold assets at
    // all).
    await scope.assertEligibleCustodian(input.transfer.targetCustodianId);
  }

  return { items, destination };
}

type Resolution =
  | { outcome: "DENIED"; reason: string }
  | { outcome: "APPLIED"; reason: string }
  | { outcome: "ROUTED"; reason: string; steps: DomainChainStep[] };

/**
 * Ported from `route()` — a selection spanning several categories can match several
 * policies; the worst outcome wins (DENY over CHAIN over AUTO), because applying half
 * a bulk transfer and routing the other half leaves the register in a state nobody
 * asked for.
 */
async function resolveTransfer(actorId: string, input: TransferInput, ctx: TransferContext, isReturn: boolean): Promise<Resolution> {
  const person = await loadPerson(actorId);
  if (!person) return { outcome: "DENIED", reason: "Nobody is signed in." };

  const categoryRows = await prisma.resourceCategory.findMany({
    include: { group: { select: { name: true } }, fields: true, templateAsParent: true, placementRulesAsChild: true },
  });
  const categories = toDomainCategoryMap(categoryRows);

  for (const item of ctx.items) {
    if (!canPlace(categories, item.categoryId, ctx.destination.categoryId)) {
      throw new HttpError(400, `"${categories[item.categoryId]?.name ?? item.categoryId}" may not be placed inside the selected destination.`);
    }
  }

  if (isReturn) {
    // A fixed, always-available two-step flow — not something an approval policy
    // row could misconfigure into oblivion, and not decided by resolvePolicy (which
    // has no "is this a return" dimension to match on). See assertTransferParties's
    // own header for why this is detected by shape rather than a client flag.
    const first = ctx.items[0];
    const nodes = await loadDomainOrgNodes();
    const orgIndex = buildOrgIndex(nodes);
    const firstRow = await prisma.item.findUnique({ where: { id: first.id } });
    const domainItem = firstRow ? toDomainItem(firstRow, []) : undefined;
    const hostReleaserId = await resolveHostReleaserId(first.id);
    const steps = buildChain([{ type: "HOST_RELEASE" }, { type: "OWNER_RECEIPT" }], {
      item: domainItem,
      ownerNodeId: first.ownerOrgNodeId,
      targetNodeId: input.transfer.targetOrgNodeId,
      hostReleaserId,
      requesterId: actorId,
      nodes,
      orgIndex,
    });
    if (steps.every((s) => s.status === "SKIPPED")) {
      return { outcome: "APPLIED", reason: "Returned directly — nobody else to ask." };
    }
    return { outcome: "ROUTED", reason: "Returning it to its own owning unit", steps };
  }

  const policies = await loadPolicies("transferItem");
  const resolutions = ctx.items.map((item) => resolvePolicy({ operation: "transferItem", person, category: categories[item.categoryId], policies }));

  const denied = resolutions.find((r) => r.outcome === "DENY");
  if (denied) return { outcome: "DENIED", reason: denied.reason };

  const routed = resolutions.find((r) => r.outcome === "CHAIN");
  if (!routed?.policy?.chain) return { outcome: "APPLIED", reason: resolutions[0]?.reason ?? "Applied." };

  const first = ctx.items[0];
  const ownerNodeId = first.ownerOrgNodeId;
  const targetNodeId = input.transfer.targetOrgNodeId;

  const nodes = await loadDomainOrgNodes();
  const orgIndex = buildOrgIndex(nodes);

  // F-042 of the 2026-09-15 campaign: resolvePolicy matches by actor ROLE only, with
  // no notion of the transfer's own SHAPE — so a store keeper's pull (not a
  // handover) reused pol-store-transfer (built for handing stock OUT, whose chain
  // is TARGET_HEAD → TARGET_CUSTODIAN only) and never asked the owning head at all,
  // and a manager/dean's pull used pol-transfer-mgr, which omits TARGET_HEAD
  // entirely — nobody at the RECEIVING end was ever asked. A pull's consent needs
  // are the same shape regardless of the requester's role: whoever currently
  // answers for the item, the unit that owns it, whoever runs the room it's about
  // to sit in (the destination CONTAINER's own custodian — a plain pull never
  // reassigns the ITEM's own custody, which stays with the lender; this is a
  // courtesy/security consult for the room, not an accountability question, so it's
  // skipped like any other post when the requester already holds it themselves),
  // the receiving unit's head, and finally the requester's own confirmation that it
  // arrived. Handovers (`transferOwnership: true`) are a different shape entirely
  // (ownership itself changes hands) and keep using the resolved policy's own chain
  // (`pol-store-transfer`) and its own client-supplied `targetCustodianId` (the
  // person taking on custody) unchanged.
  const targetCustodianId = input.transfer.transferOwnership ? (input.transfer.targetCustodianId ?? first.custodianId) : ctx.destination.custodianId;
  const chain = input.transfer.transferOwnership
    ? routed.policy.chain
    : [
        { type: "ITEM_CUSTODIAN" as const },
        { type: "OWNER_HEAD" as const },
        ...(targetCustodianId !== actorId ? [{ type: "TARGET_CUSTODIAN" as const }] : []),
        { type: "TARGET_HEAD" as const },
        { type: "REQUESTER_RECEIPT" as const },
      ];

  const broken = validateChain(chain, { ownerNodeId, targetNodeId, nodes, orgIndex });
  if (broken) return { outcome: "DENIED", reason: broken };

  const firstRow = await prisma.item.findUnique({ where: { id: first.id } });
  const domainItem = firstRow ? toDomainItem(firstRow, []) : undefined;

  const steps = buildChain(chain, {
    item: domainItem,
    ownerNodeId,
    targetNodeId,
    targetCustodianId,
    requesterId: actorId,
    nodes,
    orgIndex,
  });

  // Every step skipped means one thing only: the requester holds every post on the
  // route, so each step is their own signature on their own request. Applying
  // directly here is what keeps "I already head both units" instant, exactly as
  // today, while everyone else goes through the real chain (§6.2).
  if (steps.every((s) => s.status === "SKIPPED")) {
    return { outcome: "APPLIED", reason: "No eligible approver — applied directly." };
  }

  return { outcome: "ROUTED", reason: routed.reason, steps };
}

function summarize(ctx: TransferContext, input: TransferInput): string {
  const subject = ctx.items.length === 1 ? ctx.items[0].name : `${ctx.items.length} resources`;
  return `${input.transfer.transferOwnership ? "Store handover" : "Transfer between units"}: ${subject} → ${ctx.destination.name}`;
}

// ── Requesting a transfer ────────────────────────────────────────────────────────

/** Moving OWNERSHIP along with the resource is the main store handing stock over to a
 *  department — nobody else's to ask for. A custodian or head lending something keeps
 *  their own unit as the owner, which is the whole point of the owner/current split. */
async function assertMayTransferOwnership(actorId: string, input: TransferInput): Promise<void> {
  if (!input.transfer.transferOwnership) return;
  const roles = await scope.rolesOf(actorId);
  if (!roles.includes("STORE_KEEPER") && !roles.includes("SYS_ADMIN")) {
    throw new HttpError(403, "Only the store keeper may hand ownership of stock over to another unit.");
  }
}

/**
 * Return flow (2026-09-20, F-039 of the 2026-09-15 campaign) — sending a borrowed
 * item back to its own owning unit. Not a policy-table CHAIN (resolvePolicy has no
 * notion of "is this a return" as a dimension to match on): detected structurally,
 * by shape, and built directly. A transfer is a return exactly when every named
 * item is currently on loan (owner ≠ current) and the chosen destination belongs to
 * that SAME owning unit — sending it home, never anywhere else.
 */
async function isReturnShape(destinationUnitId: string, items: Array<{ ownerOrgNodeId: string; currentOrgNodeId: string }>): Promise<boolean> {
  return items.length > 0 && items.every((i) => i.ownerOrgNodeId !== i.currentOrgNodeId && i.ownerOrgNodeId === destinationUnitId);
}

/**
 * Either side of a loan may ask for it back: the lender (their ordinary custody/
 * MANAGER write reach over the item itself) or the host (they currently physically
 * hold it, via the READ-side containment walk — `custodyItemIdsOf`, unchanged by
 * the 2026-09-20 write-custody fix — even though that same fix means the host may
 * no longer WRITE the item directly; asking for it to leave is not writing it).
 * Neither check alone is right for both directions, so this tries both.
 */
async function mayInitiateReturn(actorId: string, itemIds: string[]): Promise<boolean> {
  try {
    await scope.assertCanMutate(actorId, itemIds);
    return true;
  } catch {
    // fall through to the host-side check below
  }
  const hosted = new Set(await scope.custodyItemIdsOf(actorId));
  return itemIds.every((id) => hosted.has(id));
}

/** HOST_RELEASE's approver: whoever custodies the item's current physical
 *  container, falling back to the current unit's own occupant if the item is
 *  somehow a root. Resolved once, at request time — the same frozen-person
 *  discipline `targetCustodianId` already uses for TARGET_CUSTODIAN, not a live
 *  office re-resolution (there is no "office" here, just whoever happens to run
 *  the room today). */
async function resolveHostReleaserId(itemId: string): Promise<string | null> {
  const item = await prisma.item.findUnique({ where: { id: itemId }, select: { parentId: true, currentOrgNodeId: true } });
  if (item?.parentId) {
    const parent = await prisma.item.findUnique({ where: { id: item.parentId }, select: { custodianId: true } });
    if (parent?.custodianId) return parent.custodianId;
  }
  if (item?.currentOrgNodeId) {
    const node = await prisma.orgNode.findUnique({ where: { id: item.currentOrgNodeId }, select: { userId: true } });
    return node?.userId ?? null;
  }
  return null;
}

/**
 * Track 5 — who is on which end of a transfer. Transfers are PULLED: the unit that
 * needs something finds it (University resources) and asks for it into a place it
 * already holds, and the chain (`pol-transfer-cust`: the item's custodian → its owning
 * head → the requester's head → the requester's receipt) is how the other side says
 * yes. So a pull is checked against the DESTINATION — the requester must be able to
 * write it — and the source must not already be theirs (that is a Move, not a
 * transfer). The receiving unit is read off the destination rather than trusted from
 * the client, and custody stays with the lender, the same borrow semantics as before.
 *
 * The one push left is the main store handing stock over (`transferOwnership`):
 * store keeper/SYS_ADMIN only, checked against the SOURCE as it always was.
 */
async function assertTransferParties(actorId: string, input: TransferInput): Promise<{ input: TransferInput; isReturn: boolean }> {
  if (input.transfer.transferOwnership) {
    await assertMayTransferOwnership(actorId, input);
    await scope.assertCanMutate(actorId, input.itemIds);
    return { input, isReturn: false };
  }

  const destination = await prisma.item.findUnique({ where: { id: input.transfer.targetParentId } });
  if (!destination || destination.deletedAt) throw new HttpError(400, "The destination no longer exists.");

  const items = await prisma.item.findMany({ where: { id: { in: input.itemIds } }, select: { ownerOrgNodeId: true, currentOrgNodeId: true } });
  const normalized: TransferInput = {
    ...input,
    transfer: { targetParentId: destination.id, targetOrgNodeId: destination.currentOrgNodeId, targetCustodianId: null },
  };

  if (await isReturnShape(destination.currentOrgNodeId, items)) {
    // Sending something home is the lender's own standing already exercised, or the
    // host's own standing to let it go — see mayInitiateReturn's own header. The
    // ordinary pull's "you already hold this" refusal below is about a PULL
    // specifically (asking for something into a place you already run); it must not
    // block either return party, so this branches BEFORE reaching it.
    if (!(await mayInitiateReturn(actorId, input.itemIds))) throw new HttpError(404, "Resource not found");
    return { input: normalized, isReturn: true };
  }

  await scope.assertCanMutate(actorId, [destination.id]);

  const held = new Set(await scope.custodyItemIdsOf(actorId));
  if (input.itemIds.some((id) => held.has(id))) {
    throw new HttpError(400, "You already hold this resource — use Move to place it elsewhere in your own lab.");
  }

  return { input: normalized, isReturn: false };
}

/** Preview only — resolves what WOULD happen, commits nothing. What `TransferModal`
 *  calls before the requester commits to asking, so it can say "applies immediately"
 *  or "needs approval from X, then Y" up front. */
/** The request is about the top-most selected resources only — see
 *  `topMostItemIds`. Collapsed before anything else runs, so placement, policy and
 *  the stored payload all describe what will actually move. */
async function normalizeTransfer(input: TransferInput): Promise<TransferInput> {
  return { ...input, itemIds: await topMostItemIds(prisma, input.itemIds) };
}

export async function previewTransfer(actorId: string, rawInput: TransferInput): Promise<{ outcome: "APPLIED" | "ROUTED" | "DENIED"; reason: string; steps?: ChainStepDto[] }> {
  const { input, isReturn } = await assertTransferParties(actorId, await normalizeTransfer(rawInput));
  const ctx = await loadTransferContext(input);
  const resolution = await resolveTransfer(actorId, input, ctx, isReturn);
  if (resolution.outcome !== "ROUTED") return resolution;

  // buildChain already resolved each step's approver against LIVE org data a moment
  // ago, so the ids here are current — only the display names need a lookup.
  const approverIds = [...new Set(resolution.steps.map((s) => s.approverId).filter((id): id is string => Boolean(id)))];
  const users = approverIds.length ? await prisma.user.findMany({ where: { id: { in: approverIds } }, select: { id: true, name: true } }) : [];
  const nameById = new Map(users.map((u) => [u.id, u.name]));

  return {
    outcome: "ROUTED",
    reason: resolution.reason,
    steps: resolution.steps.map((s) => toStepDto(s, s.approverId, s.approverId ? (nameById.get(s.approverId) ?? null) : null)),
  };
}

export async function requestTransfer(actorId: string, rawInput: TransferInput): Promise<RequestTransferResultDto> {
  const { input, isReturn } = await assertTransferParties(actorId, await normalizeTransfer(rawInput));

  const ctx = await loadTransferContext(input);
  const resolution = await resolveTransfer(actorId, input, ctx, isReturn);

  if (resolution.outcome === "DENIED") throw new HttpError(403, resolution.reason);

  if (resolution.outcome === "APPLIED") {
    const result = await applyChange(actorId, input, { viaApprovalEngine: true });
    return { outcome: "APPLIED", result };
  }

  const baseVersions: Record<string, number> = Object.fromEntries(ctx.items.map((i) => [i.id, i.version]));
  const structuralSnapshot: Record<string, StructuralFields> = Object.fromEntries(ctx.items.map((i) => [i.id, structuralFieldsOf(i)]));

  const requestId = await prisma.$transaction(async (tx) => {
    const request = await tx.changeRequest.create({
      data: {
        payload: input as unknown as Prisma.InputJsonValue,
        requesterId: actorId,
        status: "PENDING",
        baseVersions,
        structuralSnapshot: structuralSnapshot as unknown as Prisma.InputJsonValue,
        summary: summarize(ctx, input),
        note: input.note ?? null,
      },
    });
    await tx.chainStep.createMany({
      data: resolution.steps.map((s) => ({
        requestId: request.id,
        order: s.order,
        selector: s.selector,
        label: s.label,
        nodeId: s.nodeId,
        approverId: s.approverId,
        status: s.status,
        skipReason: s.skipReason,
        receipt: s.receipt,
      })),
    });
    return request.id;
  });

  return { outcome: "ROUTED", request: await getRequest(actorId, requestId) };
}

// ── Deciding a step ──────────────────────────────────────────────────────────────

async function loadRequestWithSteps(requestId: string) {
  const request = await prisma.changeRequest.findUnique({
    where: { id: requestId },
    include: { steps: { orderBy: { order: "asc" } }, requester: { select: { name: true } } },
  });
  if (!request) throw new HttpError(404, "Request not found");
  return request;
}

type DecideOutcome = { done: true } | { done: false; requesterId: string; payload: TransferInput; freshVersions: Record<string, number>; at: Date; note?: string };

/**
 * Ends the request outright on REJECT (no draft to preserve here, unlike Track 2's
 * lab commits — see §6.3). On APPROVE, arms the next step; once every step (the
 * REQUESTER_RECEIPT included) is APPROVED or SKIPPED, applies the payload through
 * the ordinary write door, attributed to the ORIGINAL REQUESTER regardless of who
 * cast the last approval — the same attribution discipline Track 2 established.
 *
 * F-040 of the 2026-09-15 campaign: everything up to and including the chain-step
 * advancement now runs inside ONE transaction opened with an advisory lock keyed on
 * `requestId`, serialising concurrent decisions on the SAME request (a double-click
 * on "confirm receipt", two tabs). Before this, two concurrent calls could both pass
 * the PENDING check, both advance the same step, and — after the ITEM's own
 * optimistic version check correctly let only one `applyChange` actually win —
 * BOTH unconditionally overwrote the request's own status, so the loser's STALE
 * write could land last even though the register showed the transfer had gone
 * through. Serialised, a second concurrent caller now finds the step already
 * decided (`currentStep` returns nothing left to decide) and gets a plain 403,
 * never reaching the settle/apply logic at all — there is structurally only ever
 * one caller who can settle a given request, so the final `applyChange` and status
 * write need no lock of their own.
 */
export async function decideStep(actorId: string, requestId: string, decision: "APPROVE" | "REJECT", note?: string): Promise<ChangeRequestDto> {
  const outcome = await prisma.$transaction(async (tx): Promise<DecideOutcome> => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${requestId}))`;

    const request = await tx.changeRequest.findUnique({ where: { id: requestId }, include: { steps: { orderBy: { order: "asc" } } } });
    if (!request) throw new HttpError(404, "Request not found");
    if (request.status !== "PENDING") throw new HttpError(409, "This request has already been decided.");

    const payload = request.payload as unknown as TransferInput;
    const subjectRow = await tx.item.findUnique({ where: { id: payload.itemIds[0] } });
    const domainItem = subjectRow ? toDomainItem(subjectRow, []) : undefined;
    const nodes = await loadDomainOrgNodes();

    const domainSteps = request.steps.map(toDomainStep);
    const step = currentStep(domainSteps);
    const person = await loadPerson(actorId);
    if (!canDecide(step, person, nodes, domainItem)) {
      throw new HttpError(403, "This decision is not yours to make.");
    }

    const at = new Date();

    if (decision === "REJECT") {
      await tx.chainStep.update({ where: { id: step!.id }, data: { status: "REJECTED", decidedById: actorId, decidedAt: at, note: note ?? null } });
      await tx.changeRequest.update({ where: { id: requestId }, data: { status: "REJECTED", resolvedAt: at, resolution: note ?? null } });
      return { done: true };
    }

    // F-041, part 1 of the 2026-09-15 campaign: re-validate every subject item
    // BEFORE recording this decision — existence, and the fields a transfer
    // actually depends on (structuralFieldsOf's own note explains why not the
    // whole-row version). A mismatch fails the request immediately, named, instead
    // of walking every remaining step only to fail at the very last one with an
    // unexplained "Version conflict".
    const snapshot = request.structuralSnapshot as Record<string, StructuralFields> | null;
    if (snapshot) {
      const liveItems = await tx.item.findMany({ where: { id: { in: payload.itemIds } } });
      const liveById = new Map(liveItems.map((i) => [i.id, i]));
      const reasons = new Set<string>();
      for (const itemId of payload.itemIds) {
        const was = snapshot[itemId];
        if (!was) continue; // no snapshot for this id — never our own case, skip rather than false-flag
        const live = liveById.get(itemId);
        if (!live || live.deletedAt) reasons.add("an item this request names was deleted");
        else if (!structuralFieldsEqual(structuralFieldsOf(live), was)) reasons.add(`"${live.name}" was moved, re-owned, re-homed or given a new custodian since this request was raised`);
      }
      if (reasons.size) {
        await tx.changeRequest.update({ where: { id: requestId }, data: { status: "STALE", resolvedAt: at, resolution: [...reasons].join("; ") } });
        return { done: true };
      }
    }

    await tx.chainStep.update({ where: { id: step!.id }, data: { status: "APPROVED", decidedById: actorId, decidedAt: at, note: note ?? null } });

    const refreshedRows = await tx.chainStep.findMany({ where: { requestId }, orderBy: { order: "asc" } });
    const advanced = activate(refreshedRows.map(toDomainStep));
    for (let i = 0; i < advanced.length; i++) {
      if (refreshedRows[i].status !== advanced[i].status) {
        await tx.chainStep.update({ where: { id: refreshedRows[i].id }, data: { status: advanced[i].status } });
      }
    }

    if (!chainSettled(advanced)) return { done: true };

    // Fresh versions, taken right here under the lock, not the request's own
    // creation-time baseVersions — a rename tolerated by the structural check above
    // would have bumped those, incorrectly failing this final version check even
    // though nothing this transfer actually depends on changed (F-041).
    const finalItems = await tx.item.findMany({ where: { id: { in: payload.itemIds } } });
    const freshVersions: Record<string, number> = Object.fromEntries(finalItems.map((i) => [i.id, i.version]));
    return { done: false, requesterId: request.requesterId, payload, freshVersions, at, note };
  });

  if (outcome.done) return getRequest(actorId, requestId);

  const { requesterId, payload, freshVersions, at, note: settleNote } = outcome;
  try {
    const result = await applyChange(requesterId, { ...payload, expectedVersions: freshVersions }, { viaApprovalEngine: true });
    await prisma.changeRequest.update({ where: { id: requestId }, data: { status: "APPLIED", resolvedAt: at, resolution: settleNote ?? null } });
    void result; // the applied ItemChangeResultDto isn't surfaced on the request itself — the change log already records it
  } catch (err) {
    const message = err instanceof HttpError ? err.message : "One or more of these resources changed while this was waiting, so nothing was applied.";
    await prisma.changeRequest.update({ where: { id: requestId }, data: { status: "STALE", resolvedAt: at, resolution: message } });
  }

  return getRequest(actorId, requestId);
}

export async function cancelRequest(actorId: string, requestId: string): Promise<void> {
  const request = await prisma.changeRequest.findUnique({ where: { id: requestId } });
  if (!request || request.status !== "PENDING") throw new HttpError(404, "Request not found");
  if (request.requesterId !== actorId) throw new HttpError(403, "Only the person who raised this request may cancel it.");
  await prisma.changeRequest.update({ where: { id: requestId }, data: { status: "CANCELLED", resolvedAt: new Date() } });
}

// ── Reading ──────────────────────────────────────────────────────────────────────

function toStepDto(step: DomainChainStep, liveApproverId: string | null, approverName: string | null): ChainStepDto {
  return {
    id: step.id,
    order: step.order,
    selector: step.selector,
    label: step.label,
    nodeId: step.nodeId,
    approverId: liveApproverId,
    approverName,
    status: step.status,
    skipReason: step.skipReason,
    receipt: step.receipt,
    decidedById: step.decidedById ?? null,
    decidedByName: null,
    decidedAt: step.decidedAt ?? null,
    note: step.note ?? null,
  };
}

async function toDto(request: Awaited<ReturnType<typeof loadRequestWithSteps>>): Promise<ChangeRequestDto> {
  const nodes = await loadDomainOrgNodes();
  const subjectPayload = request.payload as unknown as TransferInput;
  const subjectRow = subjectPayload?.itemIds?.[0] ? await prisma.item.findUnique({ where: { id: subjectPayload.itemIds[0] } }) : null;
  const domainItem = subjectRow ? toDomainItem(subjectRow, []) : undefined;

  const domainSteps = request.steps.map(toDomainStep);
  const userIds = new Set<string>();
  for (const s of domainSteps) {
    const live = s.status === "PENDING" || s.status === "WAITING" ? resolveApprover(s, { nodes, item: domainItem }) : s.approverId;
    if (live) userIds.add(live);
    if (s.decidedById) userIds.add(s.decidedById);
  }
  const users = userIds.size ? await prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true } }) : [];
  const nameById = new Map(users.map((u) => [u.id, u.name]));

  const steps: ChainStepDto[] = domainSteps.map((s) => {
    const liveId = s.status === "PENDING" || s.status === "WAITING" ? resolveApprover(s, { nodes, item: domainItem }) : s.approverId;
    return {
      id: s.id,
      order: s.order,
      selector: s.selector,
      label: s.label,
      nodeId: s.nodeId,
      approverId: liveId,
      approverName: liveId ? (nameById.get(liveId) ?? null) : null,
      status: s.status,
      skipReason: s.skipReason,
      receipt: s.receipt,
      decidedById: s.decidedById ?? null,
      decidedByName: s.decidedById ? (nameById.get(s.decidedById) ?? null) : null,
      decidedAt: s.decidedAt ?? null,
      note: s.note ?? null,
    };
  });

  return {
    id: request.id,
    requesterId: request.requesterId,
    requesterName: request.requester.name,
    createdAt: request.createdAt.toISOString(),
    status: request.status,
    steps,
    summary: request.summary,
    note: request.note,
    resolvedAt: request.resolvedAt ? request.resolvedAt.toISOString() : null,
    resolution: request.resolution,
  };
}

/** Readable by the requester, any step's current or past resolved approver, or
 *  SYS_ADMIN — 404 otherwise (a 403 would confirm the row exists). */
export async function getRequest(actorId: string, requestId: string): Promise<ChangeRequestDto> {
  const request = await loadRequestWithSteps(requestId);
  const dto = await toDto(request);
  const isParty = actorId === request.requesterId || dto.steps.some((s) => s.approverId === actorId || s.decidedById === actorId);
  if (!isParty && !(await scope.isSysAdmin(actorId))) throw new HttpError(404, "Resource not found");
  return dto;
}

/** `"inbox"` — every PENDING request whose CURRENT step's live-resolved approver is
 *  this actor. `"mine"` — every request this actor raised, any status. These can
 *  legitimately overlap: a REQUESTER_RECEIPT step names the requester as its own
 *  approver, so a request someone raised reappears in their own inbox once it
 *  reaches that final step — expected, not a bug (§6.3). */
export async function listForActor(actorId: string, box: "inbox" | "mine"): Promise<ChangeRequestDto[]> {
  if (box === "mine") {
    const requests = await prisma.changeRequest.findMany({
      where: { requesterId: actorId },
      include: { steps: { orderBy: { order: "asc" } }, requester: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    return Promise.all(requests.map(toDto));
  }

  const pending = await prisma.changeRequest.findMany({
    where: { status: "PENDING" },
    include: { steps: { orderBy: { order: "asc" } }, requester: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const dtos = await Promise.all(pending.map(toDto));
  return dtos.filter((d) => d.steps.some((s) => s.status === "PENDING" && s.approverId === actorId));
}
