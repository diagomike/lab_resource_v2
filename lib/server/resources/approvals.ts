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
  items: Array<{ id: string; name: string; categoryId: string; ownerOrgNodeId: string; custodianId: string; version: number }>;
  destination: { id: string; name: string; categoryId: string };
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
async function resolveTransfer(actorId: string, input: TransferInput, ctx: TransferContext): Promise<Resolution> {
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

  const policies = await loadPolicies("transferItem");
  const resolutions = ctx.items.map((item) => resolvePolicy({ operation: "transferItem", person, category: categories[item.categoryId], policies }));

  const denied = resolutions.find((r) => r.outcome === "DENY");
  if (denied) return { outcome: "DENIED", reason: denied.reason };

  const routed = resolutions.find((r) => r.outcome === "CHAIN");
  if (!routed?.policy?.chain) return { outcome: "APPLIED", reason: resolutions[0]?.reason ?? "Applied." };

  const first = ctx.items[0];
  const ownerNodeId = first.ownerOrgNodeId;
  const targetNodeId = input.transfer.targetOrgNodeId;
  const targetCustodianId = input.transfer.targetCustodianId ?? first.custodianId;

  const nodes = await loadDomainOrgNodes();
  const orgIndex = buildOrgIndex(nodes);

  const broken = validateChain(routed.policy.chain, { ownerNodeId, targetNodeId, nodes, orgIndex });
  if (broken) return { outcome: "DENIED", reason: broken };

  const firstRow = await prisma.item.findUnique({ where: { id: first.id } });
  const domainItem = firstRow ? toDomainItem(firstRow, []) : undefined;

  const steps = buildChain(routed.policy.chain, {
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
async function assertTransferParties(actorId: string, input: TransferInput): Promise<TransferInput> {
  if (input.transfer.transferOwnership) {
    await assertMayTransferOwnership(actorId, input);
    await scope.assertCanMutate(actorId, input.itemIds);
    return input;
  }

  const destination = await prisma.item.findUnique({ where: { id: input.transfer.targetParentId } });
  if (!destination || destination.deletedAt) throw new HttpError(400, "The destination no longer exists.");
  await scope.assertCanMutate(actorId, [destination.id]);

  const held = new Set(await scope.custodyItemIdsOf(actorId));
  if (input.itemIds.some((id) => held.has(id))) {
    throw new HttpError(400, "You already hold this resource — use Move to place it elsewhere in your own lab.");
  }

  return {
    ...input,
    transfer: { targetParentId: destination.id, targetOrgNodeId: destination.currentOrgNodeId, targetCustodianId: null },
  };
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
  const input = await assertTransferParties(actorId, await normalizeTransfer(rawInput));
  const ctx = await loadTransferContext(input);
  const resolution = await resolveTransfer(actorId, input, ctx);
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
  const input = await assertTransferParties(actorId, await normalizeTransfer(rawInput));

  const ctx = await loadTransferContext(input);
  const resolution = await resolveTransfer(actorId, input, ctx);

  if (resolution.outcome === "DENIED") throw new HttpError(403, resolution.reason);

  if (resolution.outcome === "APPLIED") {
    const result = await applyChange(actorId, input, { viaApprovalEngine: true });
    return { outcome: "APPLIED", result };
  }

  const baseVersions: Record<string, number> = Object.fromEntries(ctx.items.map((i) => [i.id, i.version]));

  const requestId = await prisma.$transaction(async (tx) => {
    const request = await tx.changeRequest.create({
      data: {
        payload: input as unknown as Prisma.InputJsonValue,
        requesterId: actorId,
        status: "PENDING",
        baseVersions,
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

/**
 * Ends the request outright on REJECT (no draft to preserve here, unlike Track 2's
 * lab commits — see §6.3). On APPROVE, arms the next step; once every step (the
 * REQUESTER_RECEIPT included) is APPROVED or SKIPPED, applies the payload through
 * the ordinary write door, attributed to the ORIGINAL REQUESTER regardless of who
 * cast the last approval — the same attribution discipline Track 2 established.
 */
export async function decideStep(actorId: string, requestId: string, decision: "APPROVE" | "REJECT", note?: string): Promise<ChangeRequestDto> {
  const request = await loadRequestWithSteps(requestId);
  if (request.status !== "PENDING") throw new HttpError(409, "This request has already been decided.");

  const payload = request.payload as unknown as TransferInput;
  const subjectRow = await prisma.item.findUnique({ where: { id: payload.itemIds[0] } });
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
    await prisma.$transaction([
      prisma.chainStep.update({ where: { id: step!.id }, data: { status: "REJECTED", decidedById: actorId, decidedAt: at, note: note ?? null } }),
      prisma.changeRequest.update({ where: { id: requestId }, data: { status: "REJECTED", resolvedAt: at, resolution: note ?? null } }),
    ]);
    return getRequest(actorId, requestId);
  }

  await prisma.chainStep.update({ where: { id: step!.id }, data: { status: "APPROVED", decidedById: actorId, decidedAt: at, note: note ?? null } });

  const refreshedRows = await prisma.chainStep.findMany({ where: { requestId }, orderBy: { order: "asc" } });
  const advanced = activate(refreshedRows.map(toDomainStep));
  await Promise.all(
    advanced.map((s, i) => (refreshedRows[i].status === s.status ? null : prisma.chainStep.update({ where: { id: refreshedRows[i].id }, data: { status: s.status } }))),
  );

  if (!chainSettled(advanced)) {
    return getRequest(actorId, requestId);
  }

  try {
    const result = await applyChange(request.requesterId, { ...payload, expectedVersions: request.baseVersions as Record<string, number> }, { viaApprovalEngine: true });
    await prisma.changeRequest.update({ where: { id: requestId }, data: { status: "APPLIED", resolvedAt: at, resolution: note ?? null } });
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
