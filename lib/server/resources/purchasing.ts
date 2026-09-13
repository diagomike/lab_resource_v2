import "server-only";
import type { Prisma, PurchaseStep as PrismaPurchaseStep } from "@prisma/client";
import type {
  AdvancePurchaseInput,
  ChainStepDto,
  CompilePurchaseInput,
  DeclineNeedInput,
  NeedLineDto,
  PurchaseLineDto,
  PurchaseRequestDto,
  RaiseNeedInput,
  ReceivePurchaseLineInput,
} from "@/lib/shared";
import { prisma } from "../prisma";
import { HttpError } from "../http-error";
import * as scope from "./scope";
import { applyChange } from "./mutate";
import {
  activate,
  buildChain,
  buildOrgIndex,
  canDecide,
  chainSettled,
  currentStep,
  resolveApprover,
  type ChainStep as DomainChainStep,
  type StepSelector,
} from "@/lib/domain/approvals";
import { FIRST_PIPELINE_STAGE, canCompile, canRaiseNeed, canReceive, canRunPipeline, isEditable, isFinished, nextStage } from "@/lib/domain/purchasing";
import type { OrgNode as DomainOrgNode, Person } from "@/lib/domain/types";
import type { RoleKind } from "@/lib/shared";

/**
 * Track 4 — purchasing/procurement. See
 * ~/.claude/plans/replicated-sparking-gray.md for the full design.
 *
 * The approval ladder is the org chart itself, not a fixed named sequence: the
 * owning unit's head, then every ancestor up to the university root (both branches
 * of a multi-parent department required, not a choice between them — the same
 * HIERARCHY selector / `ancestorsOfChain()` Track 3 already relies on), then the
 * Procurement Office. Reuses `lib/domain/approvals.ts`'s chain engine completely
 * unchanged — a `PurchaseStep` Prisma row is a sibling of `ChainStep`, not a
 * variant of it (ChainStep is hard-tied to ChangeRequest's Item-shaped payload,
 * which a purchase request has no use for), fed through the exact same pure
 * `buildChain`/`activate`/`canDecide`/`resolveApprover`/`chainSettled` functions
 * Track 3's own `lib/server/resources/approvals.ts` already proved live.
 */

function dec(v: Prisma.Decimal | number | null): number | null {
  if (v === null) return null;
  return typeof v === "number" ? v : v.toNumber();
}

// ── Loading live domain data — never cached ──────────────────────────────────────

async function loadPerson(userId: string): Promise<Person | undefined> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, homeNodeId: true } });
  if (!user) return undefined;
  const roles = await scope.rolesOf(userId);
  return { id: user.id, name: user.name, homeOrgNodeId: user.homeNodeId, roles };
}

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

function toDomainStep(row: PrismaPurchaseStep): DomainChainStep {
  return {
    id: row.id,
    order: row.order,
    selector: row.selector,
    label: row.label,
    nodeId: row.nodeId,
    approverId: row.approverId,
    status: row.status,
    skipReason: row.skipReason,
    receipt: false,
    decidedById: row.decidedById ?? undefined,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : undefined,
    note: row.note ?? undefined,
  };
}

/** Whoever currently occupies `orgNodeId`, or null if headless/inactive — the same
 *  head-of-unit check `lib/server/resources/lab-drafts.ts`'s own `currentHeadOf`
 *  private helper already established for Track 2. */
async function currentHeadOf(orgNodeId: string): Promise<string | null> {
  const node = await prisma.orgNode.findUnique({ where: { id: orgNodeId }, select: { userId: true, active: true } });
  return node?.active ? node.userId : null;
}

async function assertHeadsNode(actorId: string, orgNodeId: string): Promise<void> {
  if (await scope.isSysAdmin(actorId)) return;
  const head = await currentHeadOf(orgNodeId);
  if (head !== actorId) throw new HttpError(403, "Only this unit's head may do this.");
}

/** The single active Office-kind node named exactly "Procurement Office" — the one
 *  real rollout prerequisite (see the plan's §6). Resolved live, never cached, same
 *  discipline as every other chain-building call in this codebase. Missing or
 *  ambiguous refuses clearly rather than silently building a broken or short chain. */
async function findProcurementOffice(nodes: DomainOrgNode[]): Promise<DomainOrgNode> {
  const matches = nodes.filter((n) => n.kind === "OFFICE" && n.active && n.name === "Procurement Office");
  if (matches.length === 0) {
    throw new HttpError(
      400,
      'No "Procurement Office" exists on the org chart yet. Ask an administrator to create one (an Office-kind node named exactly "Procurement Office") before raising a purchase request.',
    );
  }
  if (matches.length > 1) {
    throw new HttpError(400, 'More than one active "Procurement Office" node exists on the org chart. Ask an administrator to rename or deactivate the extra one.');
  }
  return matches[0];
}

async function buildLadderSteps(orgNodeId: string, actorId: string): Promise<DomainChainStep[]> {
  const nodes = await loadDomainOrgNodes();
  const procurement = await findProcurementOffice(nodes);
  const orgIndex = buildOrgIndex(nodes);
  const ladder: StepSelector[] = [{ type: "OWNER_HEAD" }, { type: "HIERARCHY", stopAtKind: "UNIVERSITY" }, { type: "NODE_OCCUPANT", nodeId: procurement.id }];
  return buildChain(ladder, { ownerNodeId: orgNodeId, requesterId: actorId, nodes, orgIndex });
}

/** Every referenced need must be an OPEN need already belonging to this unit — a
 *  head cannot carry someone else's department's need, or one already carried or
 *  declined, into their own request. */
async function assertNeedsOpenAt(orgNodeId: string, needIds: string[]): Promise<void> {
  if (!needIds.length) return;
  const needs = await prisma.needLine.findMany({ where: { id: { in: needIds } } });
  if (needs.length !== needIds.length || needs.some((n) => n.orgNodeId !== orgNodeId || n.status !== "OPEN")) {
    throw new HttpError(400, "One or more referenced needs are not open needs belonging to this unit.");
  }
}

async function nextReference(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.purchaseRequest.count({ where: { createdAt: { gte: new Date(Date.UTC(year, 0, 1)) } } });
  return `PR-${year}-${String(count + 1).padStart(3, "0")}`;
}

// ── Needs ──────────────────────────────────────────────────────────────────────

const needInclude = {
  raisedBy: { select: { name: true } },
  orgNode: { select: { name: true } },
  handledBy: { select: { name: true } },
  purchaseLine: { select: { purchase: { select: { reference: true, stage: true } } } },
} satisfies Prisma.NeedLineInclude;

type NeedRow = Prisma.NeedLineGetPayload<{ include: typeof needInclude }>;

function toNeedDto(row: NeedRow): NeedLineDto {
  return {
    id: row.id,
    raisedById: row.raisedById,
    raisedByName: row.raisedBy.name,
    orgNodeId: row.orgNodeId,
    orgNodeName: row.orgNode.name,
    name: row.name,
    qty: dec(row.qty)!,
    unit: row.unit,
    categoryId: row.categoryId,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
    status: row.status,
    handledById: row.handledById,
    handledByName: row.handledBy?.name ?? null,
    handledAt: row.handledAt ? row.handledAt.toISOString() : null,
    note: row.note,
    purchaseLineId: row.purchaseLineId,
    purchaseReference: row.purchaseLine?.purchase.reference ?? null,
    purchaseStage: row.purchaseLine?.purchase.stage ?? null,
  };
}

/** "We could use one of these." Never auto-converted — a head reads open needs while
 *  writing their own request and decides what to carry forward. */
export async function raiseNeed(actorId: string, input: RaiseNeedInput): Promise<NeedLineDto> {
  const person = await loadPerson(actorId);
  if (!canRaiseNeed(person)) throw new HttpError(403, "You must belong to a unit, and not be a student, to raise a need.");
  const row = await prisma.needLine.create({
    data: {
      raisedById: actorId,
      orgNodeId: person!.homeOrgNodeId!,
      name: input.name,
      qty: input.qty,
      unit: input.unit ?? null,
      categoryId: input.categoryId ?? null,
      reason: input.reason,
    },
    include: needInclude,
  });
  return toNeedDto(row);
}

/** What a head reads while compiling their own unit's request. Head-of-`orgNodeId`
 *  only, or SYS_ADMIN. */
export async function listOpenNeeds(actorId: string, orgNodeId: string): Promise<NeedLineDto[]> {
  const person = await loadPerson(actorId);
  if (!canCompile(person)) throw new HttpError(403, "Only a head may browse a unit's open needs.");
  await assertHeadsNode(actorId, orgNodeId);
  const rows = await prisma.needLine.findMany({ where: { orgNodeId, status: "OPEN" }, include: needInclude, orderBy: { createdAt: "asc" } });
  return rows.map(toNeedDto);
}

export async function listMyNeeds(actorId: string): Promise<NeedLineDto[]> {
  const rows = await prisma.needLine.findMany({ where: { raisedById: actorId }, include: needInclude, orderBy: { createdAt: "desc" } });
  return rows.map(toNeedDto);
}

export async function declineNeed(actorId: string, needId: string, input: DeclineNeedInput): Promise<NeedLineDto> {
  const need = await prisma.needLine.findUnique({ where: { id: needId } });
  if (!need) throw new HttpError(404, "Need not found");
  if (need.status !== "OPEN") throw new HttpError(409, "This need has already been handled.");
  const person = await loadPerson(actorId);
  if (!canCompile(person)) throw new HttpError(403, "Only a head may decide on a need.");
  await assertHeadsNode(actorId, need.orgNodeId);
  const row = await prisma.needLine.update({
    where: { id: needId },
    data: { status: "DECLINED", handledById: actorId, handledAt: new Date(), note: input.note },
    include: needInclude,
  });
  return toNeedDto(row);
}

// ── Purchase requests ────────────────────────────────────────────────────────────

const requestInclude = {
  orgNode: { select: { name: true } },
  raisedBy: { select: { name: true } },
  lines: { include: { answeredNeeds: { select: { id: true } } } },
  events: { orderBy: { at: "asc" }, include: { by: { select: { name: true } } } },
  steps: { orderBy: { order: "asc" } },
} satisfies Prisma.PurchaseRequestInclude;

type RequestRow = Prisma.PurchaseRequestGetPayload<{ include: typeof requestInclude }>;
type LineRow = RequestRow["lines"][number];

function toLineDto(l: LineRow): PurchaseLineDto {
  return {
    id: l.id,
    name: l.name,
    qty: dec(l.qty)!,
    unit: l.unit,
    categoryId: l.categoryId,
    estimatedUnitCost: dec(l.estimatedUnitCost),
    justification: l.justification,
    fromNeedIds: l.answeredNeeds.map((n) => n.id),
    receivedQty: dec(l.receivedQty),
    receivedAt: l.receivedAt ? l.receivedAt.toISOString() : null,
    receivedById: l.receivedById,
  };
}

async function toRequestDto(row: RequestRow): Promise<PurchaseRequestDto> {
  const nodes = await loadDomainOrgNodes();
  const domainSteps = row.steps.map(toDomainStep);

  const userIds = new Set<string>();
  for (const s of domainSteps) {
    const live = s.status === "PENDING" || s.status === "WAITING" ? resolveApprover(s, { nodes }) : s.approverId;
    if (live) userIds.add(live);
    if (s.decidedById) userIds.add(s.decidedById);
  }
  const users = userIds.size ? await prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true } }) : [];
  const nameById = new Map(users.map((u) => [u.id, u.name]));

  const steps: ChainStepDto[] = domainSteps.map((s) => {
    const liveId = s.status === "PENDING" || s.status === "WAITING" ? resolveApprover(s, { nodes }) : s.approverId;
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
    id: row.id,
    reference: row.reference,
    orgNodeId: row.orgNodeId,
    orgNodeName: row.orgNode.name,
    raisedById: row.raisedById,
    raisedByName: row.raisedBy.name,
    createdAt: row.createdAt.toISOString(),
    title: row.title,
    lines: row.lines.map(toLineDto),
    stage: row.stage,
    history: row.events.map((e) => ({ at: e.at.toISOString(), byId: e.byId, byName: e.by.name, stage: e.stage, note: e.note })),
    feedback: row.feedback,
    steps,
  };
}

/** The department's formal ask. Compiled straight into `APPROVING` — there is no
 *  separate "save a draft, submit later" step in this first pass (see the plan's
 *  §3 note on `DRAFT`/`reviseAndResubmit`). `canCompile` and head-of-`orgNodeId`
 *  gate it; every referenced need must be OPEN and belong to this same unit. */
export async function compilePurchaseRequest(actorId: string, input: CompilePurchaseInput): Promise<PurchaseRequestDto> {
  const person = await loadPerson(actorId);
  if (!canCompile(person)) throw new HttpError(403, "Only a head may compile a purchase request.");
  await assertHeadsNode(actorId, input.orgNodeId);

  const orgNode = await prisma.orgNode.findUnique({ where: { id: input.orgNodeId } });
  if (!orgNode?.active) throw new HttpError(400, "Choose an active unit.");

  const neededIds = [...new Set(input.lines.flatMap((l) => l.fromNeedIds))];
  await assertNeedsOpenAt(input.orgNodeId, neededIds);

  const steps = await buildLadderSteps(input.orgNodeId, actorId);
  const reference = await nextReference();

  const requestId = await prisma.$transaction(async (tx) => {
    const request = await tx.purchaseRequest.create({
      data: { reference, orgNodeId: input.orgNodeId, raisedById: actorId, title: input.title, stage: "APPROVING" },
    });

    const created = await Promise.all(
      input.lines.map((l) =>
        tx.purchaseLine.create({
          data: {
            purchaseId: request.id,
            name: l.name,
            qty: l.qty,
            unit: l.unit ?? null,
            categoryId: l.categoryId ?? null,
            estimatedUnitCost: l.estimatedUnitCost ?? null,
            justification: l.justification ?? null,
          },
        }),
      ),
    );
    for (let i = 0; i < input.lines.length; i++) {
      const ids = input.lines[i].fromNeedIds;
      if (!ids.length) continue;
      await tx.needLine.updateMany({ where: { id: { in: ids } }, data: { status: "CARRIED", purchaseLineId: created[i].id, handledById: actorId, handledAt: new Date() } });
    }

    await tx.purchaseStep.createMany({
      data: steps.map((s) => ({ requestId: request.id, order: s.order, selector: s.selector, label: s.label, nodeId: s.nodeId, approverId: s.approverId, status: s.status, skipReason: s.skipReason })),
    });
    await tx.purchaseEvent.create({ data: { purchaseId: request.id, byId: actorId, stage: "APPROVING", note: "Submitted for approval." } });

    return request.id;
  });

  await settleIfComplete(requestId, actorId, steps);
  return loadDto(requestId);
}

/** Every step self-held (the requester holds every post on the route) means nothing
 *  is actually left to wait for — `activate()` already skipped each one through, so
 *  this just advances the request the rest of the way, the same shortcut Track 3's
 *  transfer chain relies on, just arrived at per-request instead of via an up-front
 *  policy check (purchasing has no `ApprovalPolicy` row to resolve an AUTO outcome
 *  from — see the plan's §3). */
async function settleIfComplete(requestId: string, actorId: string, steps: DomainChainStep[]): Promise<void> {
  if (!chainSettled(steps)) return;
  await prisma.$transaction([
    prisma.purchaseRequest.update({ where: { id: requestId }, data: { stage: FIRST_PIPELINE_STAGE } }),
    prisma.purchaseEvent.create({ data: { purchaseId: requestId, byId: actorId, stage: FIRST_PIPELINE_STAGE, note: "Every approval step was self-held." } }),
  ]);
}

/** Only while `isEditable(stage)` (in practice: `REVISING`) and only the original
 *  raiser. Replaces the whole line set and rebuilds the chain fresh — old
 *  `PurchaseStep` rows are working state, not an audit log, same discipline
 *  Track 2/3 already established for `ChangeRequest`/`ChainStep` cleanup. */
export async function reviseAndResubmit(actorId: string, requestId: string, input: CompilePurchaseInput): Promise<PurchaseRequestDto> {
  const request = await prisma.purchaseRequest.findUnique({ where: { id: requestId }, include: { lines: true } });
  if (!request) throw new HttpError(404, "Request not found");
  if (request.raisedById !== actorId) throw new HttpError(403, "Only the person who raised this request may revise it.");
  if (!isEditable(request.stage)) throw new HttpError(409, "This request can no longer be edited.");
  if (request.orgNodeId !== input.orgNodeId) throw new HttpError(400, "A request cannot change which unit it belongs to.");

  const neededIds = [...new Set(input.lines.flatMap((l) => l.fromNeedIds))];
  await assertNeedsOpenAt(input.orgNodeId, neededIds);

  const steps = await buildLadderSteps(input.orgNodeId, actorId);
  const oldLineIds = request.lines.map((l) => l.id);

  await prisma.$transaction(async (tx) => {
    if (oldLineIds.length) {
      // Release whatever the old lines had carried — a need left pointing at a
      // deleted line would sit as neither OPEN (so nobody could carry it again) nor
      // genuinely CARRIED (so nothing accounts for it) once this transaction commits.
      await tx.needLine.updateMany({ where: { purchaseLineId: { in: oldLineIds } }, data: { status: "OPEN", purchaseLineId: null, handledById: null, handledAt: null } });
    }
    await tx.purchaseLine.deleteMany({ where: { purchaseId: requestId } });
    await tx.purchaseStep.deleteMany({ where: { requestId } });

    const created = await Promise.all(
      input.lines.map((l) =>
        tx.purchaseLine.create({
          data: {
            purchaseId: requestId,
            name: l.name,
            qty: l.qty,
            unit: l.unit ?? null,
            categoryId: l.categoryId ?? null,
            estimatedUnitCost: l.estimatedUnitCost ?? null,
            justification: l.justification ?? null,
          },
        }),
      ),
    );
    for (let i = 0; i < input.lines.length; i++) {
      const ids = input.lines[i].fromNeedIds;
      if (!ids.length) continue;
      await tx.needLine.updateMany({ where: { id: { in: ids } }, data: { status: "CARRIED", purchaseLineId: created[i].id, handledById: actorId, handledAt: new Date() } });
    }

    await tx.purchaseStep.createMany({
      data: steps.map((s) => ({ requestId, order: s.order, selector: s.selector, label: s.label, nodeId: s.nodeId, approverId: s.approverId, status: s.status, skipReason: s.skipReason })),
    });

    await tx.purchaseRequest.update({ where: { id: requestId }, data: { title: input.title, stage: "APPROVING", feedback: null } });
    await tx.purchaseEvent.create({ data: { purchaseId: requestId, byId: actorId, stage: "APPROVING", note: "Revised and resubmitted." } });
  });

  await settleIfComplete(requestId, actorId, steps);
  return loadDto(requestId);
}

/**
 * `REJECT` ends the request outright (no draft to preserve, unlike Track 2's lab
 * commits — matches Track 3's own transfer rejection). `REVISE` sends it back to the
 * raiser: `stage` → `REVISING`, `feedback` set, the chain-in-progress deleted (there
 * is nothing left to decide until it is resubmitted). `APPROVE` arms the next step
 * exactly like Track 3's `decideStep`; once every step has settled, the request
 * enters the reporting pipeline.
 */
export async function decideStep(actorId: string, requestId: string, decision: "APPROVE" | "REJECT" | "REVISE", note?: string): Promise<PurchaseRequestDto> {
  const request = await prisma.purchaseRequest.findUnique({ where: { id: requestId }, include: { steps: { orderBy: { order: "asc" } } } });
  if (!request) throw new HttpError(404, "Request not found");
  if (request.stage !== "APPROVING") throw new HttpError(409, "This request is not awaiting a decision.");

  const nodes = await loadDomainOrgNodes();
  const domainSteps = request.steps.map(toDomainStep);
  const step = currentStep(domainSteps);
  const person = await loadPerson(actorId);
  if (!canDecide(step, person, nodes)) throw new HttpError(403, "This decision is not yours to make.");

  const at = new Date();
  // Every decision is also written to the request's permanent history — the steps
  // themselves are working state (REVISE deletes them), so without this a request
  // that went round several send-backs would show nothing of who sent it back or why.
  // The event's own stage already says what happened ("Sent back for revision",
  // "Rejected") — the note carries WHO decided at which step, and why.
  const eventNote = (verb?: string) => `${verb ? `${verb} — ` : ""}${step!.label}${note ? `: ${note}` : ""}`;

  if (decision === "REJECT") {
    await prisma.$transaction([
      prisma.purchaseStep.update({ where: { id: step!.id }, data: { status: "REJECTED", decidedById: actorId, decidedAt: at, note: note ?? null } }),
      prisma.purchaseRequest.update({ where: { id: requestId }, data: { stage: "REJECTED", feedback: note ?? null } }),
      prisma.purchaseEvent.create({ data: { purchaseId: requestId, byId: actorId, at, stage: "REJECTED", note: eventNote() } }),
    ]);
    return loadDto(requestId);
  }

  if (decision === "REVISE") {
    await prisma.$transaction([
      prisma.purchaseStep.deleteMany({ where: { requestId } }),
      prisma.purchaseRequest.update({ where: { id: requestId }, data: { stage: "REVISING", feedback: note ?? "Sent back for revision." } }),
      prisma.purchaseEvent.create({ data: { purchaseId: requestId, byId: actorId, at, stage: "REVISING", note: eventNote() } }),
    ]);
    return loadDto(requestId);
  }

  await prisma.$transaction([
    prisma.purchaseStep.update({ where: { id: step!.id }, data: { status: "APPROVED", decidedById: actorId, decidedAt: at, note: note ?? null } }),
    prisma.purchaseEvent.create({ data: { purchaseId: requestId, byId: actorId, at, stage: "APPROVING", note: eventNote("Approved") } }),
  ]);

  const refreshedRows = await prisma.purchaseStep.findMany({ where: { requestId }, orderBy: { order: "asc" } });
  const advanced = activate(refreshedRows.map(toDomainStep));
  await Promise.all(advanced.map((s, i) => (refreshedRows[i].status === s.status ? null : prisma.purchaseStep.update({ where: { id: refreshedRows[i].id }, data: { status: s.status } }))));

  if (chainSettled(advanced)) {
    await prisma.$transaction([
      prisma.purchaseRequest.update({ where: { id: requestId }, data: { stage: FIRST_PIPELINE_STAGE } }),
      prisma.purchaseEvent.create({ data: { purchaseId: requestId, byId: actorId, stage: FIRST_PIPELINE_STAGE, note: "Every approval step settled — handed to procurement." } }),
    ]);
  }

  return loadDto(requestId);
}

export async function cancelPurchaseRequest(actorId: string, requestId: string): Promise<void> {
  const request = await prisma.purchaseRequest.findUnique({ where: { id: requestId } });
  if (!request) throw new HttpError(404, "Request not found");
  if (request.raisedById !== actorId) throw new HttpError(403, "Only the person who raised this request may cancel it.");
  if (isFinished(request.stage)) throw new HttpError(409, "This request has already finished.");
  await prisma.$transaction([
    prisma.purchaseRequest.update({ where: { id: requestId }, data: { stage: "CANCELLED" } }),
    prisma.purchaseEvent.create({ data: { purchaseId: requestId, byId: actorId, stage: "CANCELLED", note: "Withdrawn by the requester." } }),
  ]);
}

/** The reporting pipeline: ORDER_PLACED → BUYER_FOUND → ON_DELIVERY → IN_STORE. A
 *  record, not a decision — nobody approves these, procurement just reports
 *  progress. */
export async function advanceStage(actorId: string, requestId: string, input: AdvancePurchaseInput): Promise<PurchaseRequestDto> {
  const person = await loadPerson(actorId);
  if (!canRunPipeline(person)) throw new HttpError(403, "Only procurement may advance the pipeline.");

  const request = await prisma.purchaseRequest.findUnique({ where: { id: requestId } });
  if (!request) throw new HttpError(404, "Request not found");
  const next = nextStage(request.stage);
  if (!next) throw new HttpError(400, `"${request.stage}" cannot be advanced further.`);

  await prisma.$transaction([
    prisma.purchaseRequest.update({ where: { id: requestId }, data: { stage: next } }),
    prisma.purchaseEvent.create({ data: { purchaseId: requestId, byId: actorId, stage: next, note: input.note ?? null } }),
  ]);
  return loadDto(requestId);
}

/**
 * The one seam with the register (see `lib/shared/resources/purchasing.ts`'s own
 * header comment): from this moment the goods are an ordinary `Item`, created
 * through the existing `applyChange` write door — its own authorization (custody on
 * `storeParentId`) applies unchanged, so this module adds no second authorization
 * path for WHERE the item lands, only WHO may receive at all (`canReceive`). A
 * SERIALIZED category receives one root item per unit (`count`); a BULK category
 * receives one root item at `count: 1`, then a follow-up `setQuantity` to the
 * received amount, since a BULK item's own qty is not a `createItem` field.
 * Cumulative across several deliveries; closes the request once every line's own
 * received amount meets its ordered amount.
 */
export async function receivePurchaseLine(actorId: string, requestId: string, input: ReceivePurchaseLineInput): Promise<PurchaseRequestDto> {
  const person = await loadPerson(actorId);
  if (!canReceive(person)) throw new HttpError(403, "Only the store keeper may register arrived stock.");

  const request = await prisma.purchaseRequest.findUnique({ where: { id: requestId }, include: { lines: true } });
  if (!request) throw new HttpError(404, "Request not found");
  if (request.stage !== "IN_STORE") throw new HttpError(409, "This request is not at the store yet.");

  const line = request.lines.find((l) => l.id === input.lineId);
  if (!line) throw new HttpError(404, "Line not found on this request");

  const category = await prisma.resourceCategory.findUnique({ where: { id: input.categoryId } });
  if (!category) throw new HttpError(400, "Choose an existing category.");

  const isSerialized = category.countingMode === "SERIALIZED";
  if (isSerialized && !Number.isInteger(input.qty)) {
    throw new HttpError(400, "A serialized category must be received in whole units.");
  }

  const result = await applyChange(actorId, {
    kind: "createItem",
    parentId: input.storeParentId,
    categoryId: input.categoryId,
    count: isSerialized ? input.qty : 1,
    name: line.name,
    note: `Received against purchase request ${request.reference}`,
  });

  if (!isSerialized && result.itemIds[0]) {
    await applyChange(actorId, { kind: "setQuantity", itemIds: [result.itemIds[0]], value: input.qty });
  }

  const newReceivedQty = (dec(line.receivedQty) ?? 0) + input.qty;
  await prisma.purchaseLine.update({ where: { id: line.id }, data: { receivedQty: newReceivedQty, receivedAt: new Date(), receivedById: actorId } });

  const updatedLines = await prisma.purchaseLine.findMany({ where: { purchaseId: requestId } });
  const allComplete = updatedLines.every((l) => l.receivedQty !== null && dec(l.receivedQty)! >= dec(l.qty)!);
  if (allComplete) {
    await prisma.$transaction([
      prisma.purchaseRequest.update({ where: { id: requestId }, data: { stage: "CLOSED" } }),
      prisma.purchaseEvent.create({ data: { purchaseId: requestId, byId: actorId, stage: "CLOSED", note: "Every line registered." } }),
    ]);
  }

  return loadDto(requestId);
}

// ── Reading ──────────────────────────────────────────────────────────────────────

/** The current DTO, no access check — for a function that has ALREADY authorized
 *  the actor to perform the specific action that led here (`canDecide`,
 *  `canRunPipeline`, `canReceive`, ...) to return its own result. A REVISE clears
 *  every step, and a receiving STORE_KEEPER is never a step's approver — re-running
 *  `getRequest`'s stricter "who may READ this" gate on your own action's output
 *  would incorrectly 404 both. */
async function loadDto(requestId: string): Promise<PurchaseRequestDto> {
  const row = await prisma.purchaseRequest.findUnique({ where: { id: requestId }, include: requestInclude });
  if (!row) throw new HttpError(404, "Resource not found");
  return toRequestDto(row);
}

/** Roles that run or oversee the purchasing process for every department, and so
 *  follow every request's status. */
const READS_EVERY_REQUEST: RoleKind[] = ["SYS_ADMIN", "PROPERTY_ADMIN", "PROCUREMENT", "STORE_KEEPER"];

/**
 * Who may follow a purchase request's status — everyone who takes part in it, not
 * just whoever has to act next:
 *  - the university-wide purchasing roles (`READS_EVERY_REQUEST`);
 *  - the person who raised it, anyone who ever decided or recorded anything on it
 *    (its event history), and anyone named on a live step;
 *  - the raising unit's own members (home unit), and the occupant of that unit or of
 *    ANY unit above it in the org chart — the offices its ladder walks through,
 *    resolved via `OrgClosure` so a newly appointed dean sees it immediately;
 *  - the occupant of any office its chain names directly (the Procurement Office);
 *  - anyone whose need was carried into one of its lines.
 * Returned as a Prisma filter (`null` = unrestricted) so a list and a point read
 * enforce exactly the same rule.
 */
async function readableRequestWhere(actorId: string): Promise<Prisma.PurchaseRequestWhereInput | null> {
  const [roles, user, occupied] = await Promise.all([
    scope.rolesOf(actorId),
    prisma.user.findUnique({ where: { id: actorId }, select: { homeNodeId: true } }),
    prisma.orgNode.findMany({ where: { userId: actorId, active: true }, select: { id: true } }),
  ]);
  if (roles.some((r) => READS_EVERY_REQUEST.includes(r))) return null;

  const occupiedIds = occupied.map((n) => n.id);
  const below = occupiedIds.length ? await prisma.orgClosure.findMany({ where: { ancestorId: { in: occupiedIds } }, select: { descendantId: true } }) : [];
  const unitIds = [...new Set([...occupiedIds, ...below.map((c) => c.descendantId), ...(user?.homeNodeId ? [user.homeNodeId] : [])])];

  const stepMatch: Prisma.PurchaseStepWhereInput[] = [{ approverId: actorId }, { decidedById: actorId }];
  if (occupiedIds.length) stepMatch.push({ nodeId: { in: occupiedIds } });

  const or: Prisma.PurchaseRequestWhereInput[] = [
    { raisedById: actorId },
    { events: { some: { byId: actorId } } },
    { steps: { some: { OR: stepMatch } } },
    { lines: { some: { answeredNeeds: { some: { raisedById: actorId } } } } },
  ];
  if (unitIds.length) or.push({ orgNodeId: { in: unitIds } });
  return { OR: or };
}

/** 404 when unreadable (Track 3's own discipline: a 403 would confirm the row
 *  exists) — see `readableRequestWhere` for who may read. */
export async function getRequest(actorId: string, requestId: string): Promise<PurchaseRequestDto> {
  const where = await readableRequestWhere(actorId);
  const visible = await prisma.purchaseRequest.count({ where: where ? { AND: [{ id: requestId }, where] } : { id: requestId } });
  if (!visible) throw new HttpError(404, "Resource not found");
  return loadDto(requestId);
}

const PIPELINE_STAGES = ["ORDER_PLACED", "BUYER_FOUND", "ON_DELIVERY", "IN_STORE"] as const;

/** `"inbox"` — every request at `APPROVING` whose current step's live-resolved
 *  approver is this actor. `"mine"` — every request this actor raised, any status.
 *  `"pipeline"` — every request procurement is running (`ORDER_PLACED` through
 *  `IN_STORE`), university-wide — what `advanceStage` acts on. `"receiving"` —
 *  every request at `IN_STORE` specifically, university-wide — what
 *  `receivePurchaseLine` acts on. The last two are university-wide rather than
 *  scoped to the requester's own unit because procurement and the store run this
 *  half of the process for every department, not just their own. */
export async function listForActor(actorId: string, box: "inbox" | "mine" | "pipeline" | "receiving" | "tracking"): Promise<PurchaseRequestDto[]> {
  if (box === "tracking") {
    const where = await readableRequestWhere(actorId);
    const rows = await prisma.purchaseRequest.findMany({ where: where ?? {}, include: requestInclude, orderBy: { createdAt: "desc" } });
    return Promise.all(rows.map(toRequestDto));
  }

  if (box === "mine") {
    const rows = await prisma.purchaseRequest.findMany({ where: { raisedById: actorId }, include: requestInclude, orderBy: { createdAt: "desc" } });
    return Promise.all(rows.map(toRequestDto));
  }

  if (box === "pipeline") {
    const person = await loadPerson(actorId);
    if (!canRunPipeline(person)) throw new HttpError(403, "Only procurement may browse the pipeline.");
    const rows = await prisma.purchaseRequest.findMany({ where: { stage: { in: [...PIPELINE_STAGES] } }, include: requestInclude, orderBy: { createdAt: "asc" } });
    return Promise.all(rows.map(toRequestDto));
  }

  if (box === "receiving") {
    const person = await loadPerson(actorId);
    if (!canReceive(person)) throw new HttpError(403, "Only the store keeper may browse what's ready to receive.");
    const rows = await prisma.purchaseRequest.findMany({ where: { stage: "IN_STORE" }, include: requestInclude, orderBy: { createdAt: "asc" } });
    return Promise.all(rows.map(toRequestDto));
  }

  const rows = await prisma.purchaseRequest.findMany({ where: { stage: "APPROVING" }, include: requestInclude, orderBy: { createdAt: "asc" } });
  const dtos = await Promise.all(rows.map(toRequestDto));
  return dtos.filter((d) => d.steps.some((s) => s.status === "PENDING" && s.approverId === actorId));
}
