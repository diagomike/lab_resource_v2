import "server-only";
import { Prisma, type PurchaseStep as PrismaPurchaseStep } from "@prisma/client";
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
import * as orgScope from "../org/scope";
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
import { FIRST_PIPELINE_STAGE, STAGE_LABEL, canRaiseNeed, canReceive, canRunPipeline, isEditable, isFinished, nextStage } from "@/lib/domain/purchasing";
import { esc, notify, quoted, usersWithRole } from "../mail/notify";
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
 * College Managing Director's office when there is one, then the Procurement Office.
 * Reuses `lib/domain/approvals.ts`'s chain engine completely
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

/** Occupancy, via the one canonical "head" definition (`org/scope.ts`'s own
 *  `isHeadOf` — F-017 of the 2026-09-15 campaign consolidated this module's
 *  previously-local copy into it, alongside removing the redundant MANAGER-role
 *  pre-checks that used to gate every caller of this function). */
async function assertHeadsNode(actorId: string, orgNodeId: string): Promise<void> {
  if (!(await orgScope.isHeadOf(actorId, orgNodeId))) throw new HttpError(403, "Only this unit's head may do this.");
}

/** The Procurement Office — the one real rollout prerequisite (see the plan's §6).
 *  Resolved by the node's stable `code` ("PROC") first (F-006 of the 2026-09-15
 *  campaign: a name lookup broke purchasing university-wide the moment the office was
 *  renamed, an ordinary Org Studio edit). Falls back to the exact-name match for an
 *  install that hasn't set the code yet, so nothing breaks before an admin does.
 *  Resolved live, never cached, same discipline as every other chain-building call in
 *  this codebase. Missing or ambiguous refuses clearly rather than silently building a
 *  broken or short chain. */
async function findProcurementOffice(nodes: DomainOrgNode[]): Promise<DomainOrgNode> {
  const byCode = await prisma.orgNode.findFirst({ where: { kind: "OFFICE", active: true, code: "PROC" } });
  if (byCode) return nodes.find((n) => n.id === byCode.id) ?? { ...byCode, parentIds: [], occupantId: byCode.userId };

  const matches = nodes.filter((n) => n.kind === "OFFICE" && n.active && n.name === "Procurement Office");
  if (matches.length === 0) {
    throw new HttpError(
      400,
      'No Procurement Office exists on the org chart yet. Ask an administrator to create one (an Office-kind node with code "PROC", or named exactly "Procurement Office") before raising a purchase request.',
    );
  }
  if (matches.length > 1) {
    throw new HttpError(
      400,
      'More than one active "Procurement Office" node exists on the org chart. Ask an administrator to give the real one the code "PROC", or deactivate the extra one.',
    );
  }
  return matches[0];
}

/** The College Managing Director's office — the last approval before Procurement,
 *  after the AVP. Optional, unlike Procurement: an install without one keeps the
 *  shorter ladder rather than refusing every request. Resolved like the Procurement
 *  Office: its stable code ("CMD") first, then the exact name. Ambiguity refuses, for
 *  the same reason — silently picking one of two offices would route money wrongly. */
const CMD_OFFICE_NAME = "College Managing Director";
async function findCmdOffice(nodes: DomainOrgNode[]): Promise<DomainOrgNode | null> {
  const byCode = await prisma.orgNode.findFirst({ where: { kind: "OFFICE", active: true, code: "CMD" } });
  if (byCode) return nodes.find((n) => n.id === byCode.id) ?? { ...byCode, parentIds: [], occupantId: byCode.userId };

  const matches = nodes.filter((n) => n.kind === "OFFICE" && n.active && n.name === CMD_OFFICE_NAME);
  if (matches.length > 1) {
    throw new HttpError(
      400,
      `More than one active "${CMD_OFFICE_NAME}" office exists on the org chart. Ask an administrator to give the real one the code "CMD", or deactivate the extra one.`,
    );
  }
  return matches[0] ?? null;
}

/** Head → dean → AVP (the org chart, up to the university) → College Managing
 *  Director (when the office exists) → Procurement Office. */
async function buildLadderSteps(orgNodeId: string, actorId: string): Promise<DomainChainStep[]> {
  const nodes = await loadDomainOrgNodes();
  const procurement = await findProcurementOffice(nodes);
  const cmd = await findCmdOffice(nodes);
  const orgIndex = buildOrgIndex(nodes);
  const ladder: StepSelector[] = [
    { type: "OWNER_HEAD" },
    { type: "HIERARCHY", stopAtKind: "UNIVERSITY" },
    ...(cmd ? [{ type: "NODE_OCCUPANT" as const, nodeId: cmd.id }] : []),
    { type: "NODE_OCCUPANT", nodeId: procurement.id },
  ];
  return buildChain(ladder, { ownerNodeId: orgNodeId, requesterId: actorId, nodes, orgIndex });
}

/** F-045 of the 2026-09-15 campaign: a SERIALIZED category (Computer, not
 *  Ethanol) receives one unit at a time — a fractional order like qty: 2.5 could
 *  compile but could then never be received exactly. Checked at compile/resubmit
 *  time, not just at receiving, so the request never gets that far unfixable. */
async function assertSerializedQtyIsInteger(lines: CompilePurchaseInput["lines"]): Promise<void> {
  const categoryIds = [...new Set(lines.map((l) => l.categoryId).filter((id): id is string => !!id))];
  if (!categoryIds.length) return;
  const categories = await prisma.resourceCategory.findMany({ where: { id: { in: categoryIds } }, select: { id: true, countingMode: true } });
  const serializedIds = new Set(categories.filter((c) => c.countingMode === "SERIALIZED").map((c) => c.id));
  const bad = lines.find((l) => l.categoryId && serializedIds.has(l.categoryId) && !Number.isInteger(l.qty));
  if (bad) throw new HttpError(400, `"${bad.name}" is a serialized category — order whole units, not ${bad.qty}.`);
}

/** Every referenced need must be an OPEN need already belonging to this unit — a
 *  head cannot carry someone else's department's need, or one already carried or
 *  declined, into their own request. */
async function assertNeedsOpenAt(client: typeof prisma | Prisma.TransactionClient, orgNodeId: string, needIds: string[]): Promise<void> {
  if (!needIds.length) return;
  const needs = await client.needLine.findMany({ where: { id: { in: needIds } } });
  if (needs.length !== needIds.length || needs.some((n) => n.orgNodeId !== orgNodeId || n.status !== "OPEN")) {
    throw new HttpError(400, "One or more referenced needs are not open needs belonging to this unit.");
  }
}

/**
 * MAX(numeric suffix) + 1 for the year, run INSIDE the caller's transaction against
 * `tx` — the identical fix `lib/server/external/requests.ts`'s own `nextReference`
 * already applied for the same flaw (F-044 of the 2026-09-15 campaign): a row-count
 * numbering scheme goes stale the moment any request row is ever deleted (a
 * verification pass's own cleanup, a retention job), after which "next" collides
 * with a reference that already exists and stays permanently wrong — count-based
 * numbering can only go UP, but a deletion moves the true next number DOWN. Reading
 * the actual highest number in use, instead of counting rows, self-heals through any
 * deletion. The caller retries the whole transaction on a P2002 collision (two
 * requests compiled in the same instant computing the same next number), exactly
 * like the external-request intake already does.
 */
async function nextReference(tx: Prisma.TransactionClient): Promise<string> {
  const prefix = "PR-" + new Date().getFullYear() + "-";
  const [{ max }] = await tx.$queryRaw<[{ max: number | null }]>`
    SELECT MAX(CAST(substring(reference FROM ${prefix.length + 1}::int) AS integer)) AS max
    FROM "PurchaseRequest" WHERE reference LIKE ${prefix + "%"} AND substring(reference FROM ${prefix.length + 1}::int) ~ '^[0-9]+$'
  `;
  return `${prefix}${String((max ?? 0) + 1).padStart(3, "0")}`;
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
 *  only, or SYS_ADMIN — occupancy alone (F-017 of the 2026-09-15 campaign): this
 *  used to ALSO require the MANAGER role before even reaching `assertHeadsNode`'s
 *  own occupancy check, so removing MANAGER from a sitting head silently broke
 *  this while `assertHeadsNode` alone would have kept working correctly. */
export async function listOpenNeeds(actorId: string, orgNodeId: string): Promise<NeedLineDto[]> {
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
  // Occupancy alone decides this (F-017) — see listOpenNeeds's own note.
  await assertHeadsNode(actorId, need.orgNodeId);
  const row = await prisma.needLine.update({
    where: { id: needId },
    data: { status: "DECLINED", handledById: actorId, handledAt: new Date(), note: input.note },
    include: needInclude,
  });
  await notify(need.raisedById, actorId, {
    subject: `Your need "${need.name}" was declined`,
    paragraphs: [`The head declined your need for <strong>${esc(need.name)}</strong> (× ${esc(String(need.qty))}).${quoted(input.note)}`],
    path: "/purchasing",
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

function toLineDto(l: LineRow, showCost: boolean): PurchaseLineDto {
  return {
    id: l.id,
    name: l.name,
    qty: dec(l.qty)!,
    unit: l.unit,
    categoryId: l.categoryId,
    estimatedUnitCost: showCost ? dec(l.estimatedUnitCost) : null,
    justification: l.justification,
    fromNeedIds: l.answeredNeeds.map((n) => n.id),
    receivedQty: dec(l.receivedQty),
    receivedAt: l.receivedAt ? l.receivedAt.toISOString() : null,
    receivedById: l.receivedById,
  };
}

/** F-048: estimated costs follow the same rule as item costs (`scope.canSeeCost`) — the roles
 *  that run or price purchasing, plus anyone who occupies a post (the ladder approvers who
 *  must weigh the price) and the person who raised the request (they typed the figure; the
 *  revise form re-reads it). A unit's plain custodians and staff can still follow the
 *  request, just not the money. Computed once per read, not per row. */
async function costVisibleTo(actorId: string): Promise<(raisedById: string) => boolean> {
  const [priced, occupies] = await Promise.all([orgScope.canSeeCost(actorId), orgScope.headNodeIdsOf(actorId).then((ids) => ids.length > 0)]);
  return (raisedById) => priced || occupies || raisedById === actorId;
}

async function toRequestDto(row: RequestRow, showCost: boolean): Promise<PurchaseRequestDto> {
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
    lines: row.lines.map((l) => toLineDto(l, showCost)),
    stage: row.stage,
    history: row.events.map((e) => ({ at: e.at.toISOString(), byId: e.byId, byName: e.by.name, stage: e.stage, note: e.note })),
    feedback: row.feedback,
    steps,
  };
}

/** The department's formal ask. Compiled straight into `APPROVING` — there is no
 *  separate "save a draft, submit later" step in this first pass (see the plan's
 *  §3 note on `DRAFT`/`reviseAndResubmit`). Head-of-`orgNodeId` (occupancy, not the
 *  MANAGER role — F-017 of the 2026-09-15 campaign: see listOpenNeeds's own note)
 *  gates it; every referenced need must be OPEN and belong to this same unit. */
export async function compilePurchaseRequest(actorId: string, input: CompilePurchaseInput): Promise<PurchaseRequestDto> {
  await assertHeadsNode(actorId, input.orgNodeId);

  const orgNode = await prisma.orgNode.findUnique({ where: { id: input.orgNodeId } });
  if (!orgNode?.active) throw new HttpError(400, "Choose an active unit.");

  await assertSerializedQtyIsInteger(input.lines);

  const neededIds = [...new Set(input.lines.flatMap((l) => l.fromNeedIds))];
  await assertNeedsOpenAt(prisma, input.orgNodeId, neededIds);

  const steps = await buildLadderSteps(input.orgNodeId, actorId);

  let requestId = "";
  for (let attempt = 0; ; attempt++) {
    try {
      requestId = await prisma.$transaction(async (tx) => {
        const reference = await nextReference(tx);
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
      break;
    } catch (err) {
      const collided = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && String(err.meta?.target).includes("reference");
      if (!collided || attempt >= 4) throw err;
    }
  }

  await settleIfComplete(requestId, actorId, steps);
  const dto = await loadDto(requestId, actorId);
  await tellNextApprover(dto, actorId);
  return dto;
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

  await assertSerializedQtyIsInteger(input.lines);

  const steps = await buildLadderSteps(input.orgNodeId, actorId);
  const oldLineIds = request.lines.map((l) => l.id);
  const neededIds = [...new Set(input.lines.flatMap((l) => l.fromNeedIds))];

  await prisma.$transaction(async (tx) => {
    if (oldLineIds.length) {
      // Release whatever the old lines had carried — a need left pointing at a
      // deleted line would sit as neither OPEN (so nobody could carry it again) nor
      // genuinely CARRIED (so nothing accounts for it) once this transaction commits.
      await tx.needLine.updateMany({ where: { purchaseLineId: { in: oldLineIds } }, data: { status: "OPEN", purchaseLineId: null, handledById: null, handledAt: null } });
    }

    // Checked HERE, not before the transaction opened (F-043 of the 2026-09-15
    // campaign): a resubmission that keeps the SAME need link used to 400 outright,
    // because its own needs were still CARRIED by the very lines this transaction
    // is about to replace. Now that the release above has already run, a kept link
    // passes the ordinary "must be OPEN" check like any other — no special case
    // needed for "already carried by this request".
    await assertNeedsOpenAt(tx, input.orgNodeId, neededIds);

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
  const dto = await loadDto(requestId, actorId);
  await tellNextApprover(dto, actorId);
  return dto;
}

/**
 * `REJECT` ends the request outright (no draft to preserve, unlike Track 2's lab
 * commits — matches Track 3's own transfer rejection). `REVISE` sends it back to the
 * raiser: `stage` → `REVISING`, `feedback` set, the chain-in-progress deleted (there
 * is nothing left to decide until it is resubmitted). `APPROVE` arms the next step
 * exactly like Track 3's `decideStep`; once every step has settled, the request
 * enters the reporting pipeline.
 */
/** F-046 of the 2026-09-15 campaign — a need carried into a request that's then
 *  rejected or cancelled used to stay CARRIED forever: not OPEN (so the head could
 *  never carry it into a new request), not visible in the head's open-needs list,
 *  and not declinable either (declineNeed also requires OPEN). The staff member who
 *  raised it saw it permanently attached to a dead request. Reopening mirrors
 *  reviseAndResubmit's own release exactly, plus a note recording why. */
async function reopenCarriedNeeds(tx: Prisma.TransactionClient, requestId: string, reference: string, reason: string): Promise<void> {
  const lineIds = (await tx.purchaseLine.findMany({ where: { purchaseId: requestId }, select: { id: true } })).map((l) => l.id);
  if (!lineIds.length) return;
  await tx.needLine.updateMany({
    where: { purchaseLineId: { in: lineIds } },
    data: { status: "OPEN", purchaseLineId: null, handledById: null, handledAt: null, note: `Returned from ${reference} (${reason})` },
  });
}

export async function decideStep(actorId: string, requestId: string, decision: "APPROVE" | "REJECT" | "REVISE", note?: string): Promise<PurchaseRequestDto> {
  // Serialised per request (F-040's own closing note: "apply the same pattern to
  // purchasing decideStep"): before this, an APPROVE and a REVISE by the same
  // approver on the same step, fired together, both passed the stage/step check and
  // both wrote — the request ended ORDER_PLACED with a REVISING event in its history.
  // The lock is transaction-scoped, so everything below runs in ONE transaction and
  // the second caller re-reads a request that has already moved on.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${requestId}))`;
    const request = await tx.purchaseRequest.findUnique({ where: { id: requestId }, include: { steps: { orderBy: { order: "asc" } } } });
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
      await tx.purchaseStep.update({ where: { id: step!.id }, data: { status: "REJECTED", decidedById: actorId, decidedAt: at, note: note ?? null } });
      await tx.purchaseRequest.update({ where: { id: requestId }, data: { stage: "REJECTED", feedback: note ?? null } });
      await tx.purchaseEvent.create({ data: { purchaseId: requestId, byId: actorId, at, stage: "REJECTED", note: eventNote() } });
      await reopenCarriedNeeds(tx, requestId, request.reference, `rejected${note ? `: ${note}` : ""}`);
      return;
    }

    if (decision === "REVISE") {
      await tx.purchaseStep.deleteMany({ where: { requestId } });
      await tx.purchaseRequest.update({ where: { id: requestId }, data: { stage: "REVISING", feedback: note ?? "Sent back for revision." } });
      await tx.purchaseEvent.create({ data: { purchaseId: requestId, byId: actorId, at, stage: "REVISING", note: eventNote() } });
      return;
    }

    await tx.purchaseStep.update({ where: { id: step!.id }, data: { status: "APPROVED", decidedById: actorId, decidedAt: at, note: note ?? null } });
    await tx.purchaseEvent.create({ data: { purchaseId: requestId, byId: actorId, at, stage: "APPROVING", note: eventNote("Approved") } });

    const refreshedRows = await tx.purchaseStep.findMany({ where: { requestId }, orderBy: { order: "asc" } });
    const advanced = activate(refreshedRows.map(toDomainStep));
    for (let i = 0; i < advanced.length; i++) {
      if (refreshedRows[i].status !== advanced[i].status) await tx.purchaseStep.update({ where: { id: refreshedRows[i].id }, data: { status: advanced[i].status } });
    }

    if (chainSettled(advanced)) {
      await tx.purchaseRequest.update({ where: { id: requestId }, data: { stage: FIRST_PIPELINE_STAGE } });
      await tx.purchaseEvent.create({ data: { purchaseId: requestId, byId: actorId, stage: FIRST_PIPELINE_STAGE, note: "Every approval step settled — handed to procurement." } });
    }
  });

  const dto = await loadDto(requestId, actorId);
  if (dto.stage === "APPROVING") await tellNextApprover(dto, actorId);
  else if (dto.stage === "REJECTED") await tellRaiser(dto, actorId, `${dto.reference} was rejected`, [`${summary(dto)} was rejected and won't go further. Any needs carried into it are open again.${quoted(note)}`]);
  else if (dto.stage === "REVISING")
    await tellRaiser(dto, actorId, `${dto.reference} was sent back for revision`, [`${summary(dto)} was sent back to you. Edit it and resubmit; the approval chain starts again.${quoted(note)}`]);
  else if (dto.stage === FIRST_PIPELINE_STAGE)
    await tellRaiser(dto, actorId, `${dto.reference} is approved`, [`${summary(dto)} passed every approval and is with procurement: <strong>${STAGE_LABEL[dto.stage]}</strong>.`]);
  return dto;
}

/**
 * F-047 of the 2026-09-15 campaign — the raiser could cancel a request procurement
 * had already placed and shipped, with nobody in procurement or the store asked or
 * told, and the goods still arriving with no way left to register them. The raiser
 * may withdraw only while the request is still THEIRS to decide (APPROVING/
 * REVISING, before it ever reaches procurement); once it's ORDER_PLACED or beyond,
 * cancelling is procurement's own act (`canRunPipeline`), with a required note —
 * their pipeline history is where the store and everyone tracking it will read why.
 */
export async function cancelPurchaseRequest(actorId: string, requestId: string, note?: string): Promise<void> {
  const request = await prisma.purchaseRequest.findUnique({ where: { id: requestId } });
  if (!request) throw new HttpError(404, "Request not found");
  if (isFinished(request.stage)) throw new HttpError(409, "This request has already finished.");

  const isRaiser = request.raisedById === actorId;
  if (isRaiser) {
    if (!isEditable(request.stage) && request.stage !== "APPROVING") {
      throw new HttpError(409, "This request has already been sent to procurement — ask procurement to cancel it.");
    }
  } else {
    const person = await loadPerson(actorId);
    if (!canRunPipeline(person)) throw new HttpError(403, "Only the person who raised this request, or procurement, may cancel it.");
    if (!note?.trim()) throw new HttpError(400, "A note is required when procurement cancels a placed order.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.purchaseRequest.update({ where: { id: requestId }, data: { stage: "CANCELLED" } });
    await tx.purchaseEvent.create({
      data: { purchaseId: requestId, byId: actorId, stage: "CANCELLED", note: isRaiser ? "Withdrawn by the requester." : `Cancelled by procurement: ${note}` },
    });
    await reopenCarriedNeeds(tx, requestId, request.reference, "cancelled");
  });

  const dto = await loadDto(requestId, actorId);
  if (isRaiser) {
    // Whoever it was waiting on has nothing left to decide.
    const waitingOn = dto.steps.find((s) => s.status === "PENDING")?.approverId;
    await notify(waitingOn, actorId, {
      subject: `${dto.reference} was withdrawn`,
      paragraphs: [`${summary(dto)} was withdrawn by ${esc(dto.raisedByName)}. There's nothing left for you to decide.`],
      path: "/approvals",
    });
  } else {
    await tellRaiser(dto, actorId, `${dto.reference} was cancelled by procurement`, [`Procurement cancelled ${summary(dto)}. Any needs carried into it are open again.${quoted(note)}`]);
  }
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
  const dto = await loadDto(requestId, actorId);
  await tellRaiser(dto, actorId, `${dto.reference}: ${STAGE_LABEL[next]}`, [`${summary(dto)} moved on: <strong>${STAGE_LABEL[next]}</strong>.${quoted(input.note)}`]);
  if (next === "IN_STORE") {
    await notify(await usersWithRole("STORE_KEEPER"), actorId, {
      subject: `${dto.reference} has arrived at the main store`,
      paragraphs: [`${summary(dto)} has arrived. Register what came in against its lines under <strong>Purchasing → Receive</strong>.`],
      path: "/purchasing",
    });
  }
  return dto;
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
  if (!(input.qty > 0)) throw new HttpError(400, "Received quantity must be greater than zero.");

  const request = await prisma.purchaseRequest.findUnique({ where: { id: requestId }, include: { lines: true } });
  if (!request) throw new HttpError(404, "Request not found");
  if (request.stage !== "IN_STORE") throw new HttpError(409, "This request is not at the store yet.");

  const line = request.lines.find((l) => l.id === input.lineId);
  if (!line) throw new HttpError(404, "Line not found on this request");

  // F-045 of the 2026-09-15 campaign: a line ordered as one category (Computer)
  // could be received against a completely different one (Chair), creating an
  // item nobody ordered and leaving the real order looking un-received.
  if (line.categoryId && line.categoryId !== input.categoryId) {
    throw new HttpError(400, "The received category does not match what this line ordered.");
  }

  const category = await prisma.resourceCategory.findUnique({ where: { id: input.categoryId } });
  if (!category) throw new HttpError(400, "Choose an existing category.");

  const isSerialized = category.countingMode === "SERIALIZED";
  if (isSerialized && !Number.isInteger(input.qty)) {
    throw new HttpError(400, "A serialized category must be received in whole units.");
  }

  // Atomic cap, not read-then-check: the threshold (ordered minus THIS call's own
  // qty) is a constant known before the query runs, so the WHERE clause is
  // correct against whatever the row's true current value is at execution time —
  // no window for two concurrent receipts to each pass a check computed against
  // the same stale reading. This closes both halves of F-045 at once: the lost
  // update (two simultaneous 1-unit receipts on the same line, both creating an
  // item but only one recorded) and the over-receipt hole (10 ordered, 500
  // received, closing the request as though fully delivered) — each of the two
  // attempts below either claims the row or it doesn't; nothing in between.
  const orderedQty = dec(line.qty)!;
  const threshold = orderedQty - input.qty;
  if (threshold < 0) {
    // This single call's own qty already exceeds the whole order, regardless of
    // anything received before it — no need to touch the row to know that.
    const remaining = orderedQty - (dec(line.receivedQty) ?? 0);
    throw new HttpError(409, `Only ${remaining} ${line.unit ?? "unit(s)"} remain on this line — refusing to receive ${input.qty}.`);
  }
  const startingFromZero = await prisma.purchaseLine.updateMany({
    where: { id: line.id, receivedQty: null },
    data: { receivedQty: input.qty, receivedAt: new Date(), receivedById: actorId },
  });
  if (startingFromZero.count === 0) {
    const claimed = await prisma.purchaseLine.updateMany({
      where: { id: line.id, receivedQty: { lte: threshold } },
      data: { receivedQty: { increment: input.qty }, receivedAt: new Date(), receivedById: actorId },
    });
    if (claimed.count === 0) {
      const current = await prisma.purchaseLine.findUniqueOrThrow({ where: { id: line.id } });
      const remaining = orderedQty - (dec(current.receivedQty) ?? 0);
      throw new HttpError(409, `Only ${remaining} ${line.unit ?? "unit(s)"} remain on this line — refusing to receive ${input.qty}.`);
    }
  }

  // The item creation below is a SEPARATE commit from the claim above (fix B of
  // F-045's own write-up: a minimal patch, not the fully atomic tx-aware
  // applyChange fix A would need) — a failure here leaves the line's own
  // receivedQty already booked with no item behind it yet, a narrower and more
  // honest gap than the pre-fix state (no accounting at all, and no cap).
  let result;
  try {
    result = await applyChange(actorId, {
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
  } catch (err) {
    // Roll back the claim so a failed item creation doesn't book a receipt with
    // nothing behind it — the two-updateMany dance above has no natural "undo"
    // built in, so this reverses it explicitly.
    await prisma.purchaseLine.update({ where: { id: line.id }, data: { receivedQty: { decrement: input.qty } } });
    throw err;
  }

  const updatedLines = await prisma.purchaseLine.findMany({ where: { purchaseId: requestId } });
  const allComplete = updatedLines.every((l) => l.receivedQty !== null && dec(l.receivedQty)! >= dec(l.qty)!);
  if (allComplete) {
    await prisma.$transaction([
      prisma.purchaseRequest.update({ where: { id: requestId }, data: { stage: "CLOSED" } }),
      prisma.purchaseEvent.create({ data: { purchaseId: requestId, byId: actorId, stage: "CLOSED", note: "Every line registered." } }),
    ]);
  }

  const dto = await loadDto(requestId, actorId);
  if (allComplete) {
    await tellRaiser(dto, actorId, `${dto.reference} is in the store`, [`Everything on ${summary(dto)} is registered in the main store. The store keeper can now hand it over to your labs.`]);
  }
  return dto;
}

// ── Notifications (lib/server/mail/notify.ts) — always after the write commits ────

function summary(dto: PurchaseRequestDto): string {
  return `<strong>${esc(dto.reference)}</strong> “${esc(dto.title)}” (${esc(dto.orgNodeName)}, ${dto.lines.length} line${dto.lines.length === 1 ? "" : "s"})`;
}

/** The approver the request is now waiting on, if anyone holds that post. */
async function tellNextApprover(dto: PurchaseRequestDto, actorId: string): Promise<void> {
  const step = dto.steps.find((s) => s.status === "PENDING");
  if (!step?.approverId) return;
  await notify(step.approverId, actorId, {
    subject: `${dto.reference} is waiting for your approval`,
    paragraphs: [
      `A purchase request has reached your step (${esc(step.label)}): ${summary(dto)}, raised by ${esc(dto.raisedByName)}.`,
      "Approve it, send it back for revision, or reject it under <strong>Approvals → Purchasing</strong>.",
    ],
    path: "/approvals",
    action: "Review it in Approvals",
  });
}

async function tellRaiser(dto: PurchaseRequestDto, actorId: string, subject: string, paragraphs: string[]): Promise<void> {
  await notify(dto.raisedById, actorId, { subject, paragraphs, path: "/purchasing" });
}

// ── Reading ──────────────────────────────────────────────────────────────────────

/** The current DTO, no access check — for a function that has ALREADY authorized
 *  the actor to perform the specific action that led here (`canDecide`,
 *  `canRunPipeline`, `canReceive`, ...) to return its own result. A REVISE clears
 *  every step, and a receiving STORE_KEEPER is never a step's approver — re-running
 *  `getRequest`'s stricter "who may READ this" gate on your own action's output
 *  would incorrectly 404 both. */
async function loadDto(requestId: string, actorId: string): Promise<PurchaseRequestDto> {
  const row = await prisma.purchaseRequest.findUnique({ where: { id: requestId }, include: requestInclude });
  if (!row) throw new HttpError(404, "Resource not found");
  return toRequestDto(row, (await costVisibleTo(actorId))(row.raisedById));
}

async function toRequestDtos(rows: RequestRow[], actorId: string): Promise<PurchaseRequestDto[]> {
  const visible = await costVisibleTo(actorId);
  return Promise.all(rows.map((r) => toRequestDto(r, visible(r.raisedById))));
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
 *  - the occupant of any office its chain names directly (the College Managing
 *    Director, the Procurement Office);
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
  return loadDto(requestId, actorId);
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
    return toRequestDtos(rows, actorId);
  }

  if (box === "mine") {
    const rows = await prisma.purchaseRequest.findMany({ where: { raisedById: actorId }, include: requestInclude, orderBy: { createdAt: "desc" } });
    return toRequestDtos(rows, actorId);
  }

  if (box === "pipeline") {
    const person = await loadPerson(actorId);
    if (!canRunPipeline(person)) throw new HttpError(403, "Only procurement may browse the pipeline.");
    const rows = await prisma.purchaseRequest.findMany({ where: { stage: { in: [...PIPELINE_STAGES] } }, include: requestInclude, orderBy: { createdAt: "asc" } });
    return toRequestDtos(rows, actorId);
  }

  if (box === "receiving") {
    const person = await loadPerson(actorId);
    if (!canReceive(person)) throw new HttpError(403, "Only the store keeper may browse what's ready to receive.");
    const rows = await prisma.purchaseRequest.findMany({ where: { stage: "IN_STORE" }, include: requestInclude, orderBy: { createdAt: "asc" } });
    return toRequestDtos(rows, actorId);
  }

  const rows = await prisma.purchaseRequest.findMany({ where: { stage: "APPROVING" }, include: requestInclude, orderBy: { createdAt: "asc" } });
  const dtos = await toRequestDtos(rows, actorId);
  return dtos.filter((d) => d.steps.some((s) => s.status === "PENDING" && s.approverId === actorId));
}
