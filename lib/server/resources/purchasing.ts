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
  RaiseNeedFields,
  ReplacementSuggestionDto,
} from "@/lib/shared";
import { prisma } from "../prisma";
import { HttpError } from "../http-error";
import * as scope from "./scope";
import * as orgScope from "../org/scope";
import { CMD_OFFICE, PROCUREMENT_OFFICE, findOffice, requireOffice } from "../org/offices";
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
import { FIRST_PIPELINE_STAGE, STAGE_LABEL, canRaiseNeed, canRecordImports, canReceive, canRunPipeline, isEditable, isFinished, nextStage } from "@/lib/domain/purchasing";
import { esc, notify, quoted, usersWithRole } from "../mail/notify";
import * as attachments from "./purchase-attachments";
import type { OrgNode as DomainOrgNode, Person } from "@/lib/domain/types";
import type { RoleKind } from "@/lib/shared";
import { paths } from "@/lib/paths";

/**
 * Track 4 — purchasing/procurement. See
 * ~/.claude/plans/replicated-sparking-gray.md for the full design.
 *
 * The approval ladder is the org chart itself, not a fixed named sequence: the
 * owning unit's head, then every college above it (both branches of a multi-parent
 * department required, not a choice between them — the same HIERARCHY selector /
 * `ancestorsOfChain()` Track 3 already relies on), then the College Managing Director's office when there is one, then the AVP,
 * then the Procurement Office.
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

/** Head → dean(s) → College Managing Director (when the office exists) → AVP →
 *  Procurement Office. The CMD sits between the college and the university: a request
 *  reaches the AVP only once the CMD has approved it. The deans are every COLLEGE above
 *  the unit (both, for a department under two colleges); the AVP is the university root's
 *  occupant. Procurement is required (a request with nowhere to be bought refuses up
 *  front); the CMD is optional, so an install without one keeps the shorter ladder. */
async function buildLadderSteps(orgNodeId: string, actorId: string): Promise<DomainChainStep[]> {
  const nodes = await loadDomainOrgNodes();
  const procurement = await requireOffice(PROCUREMENT_OFFICE, nodes);
  const cmd = await findOffice(CMD_OFFICE, nodes);
  const orgIndex = buildOrgIndex(nodes);
  const ladder: StepSelector[] = [
    { type: "OWNER_HEAD" },
    { type: "HIERARCHY", stopAtKind: "COLLEGE" },
    ...(cmd ? [{ type: "NODE_OCCUPANT" as const, nodeId: cmd.id }] : []),
    { type: "OWNER_ANCESTOR", kind: "UNIVERSITY" },
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
  category: { select: { name: true } },
  lab: { select: { name: true } },
  purchaseLine: { select: { purchase: { select: { reference: true, stage: true } } } },
} satisfies Prisma.NeedLineInclude;

const PRIORITY_RANK: Record<NeedLineDto["priority"], number> = { ESSENTIAL: 0, IMPORTANT: 1, NICE_TO_HAVE: 2 };
const byPriorityThenAge = (a: NeedLineDto, b: NeedLineDto) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.createdAt.localeCompare(b.createdAt);

type NeedRow = Prisma.NeedLineGetPayload<{ include: typeof needInclude }>;

function toNeedDto(row: NeedRow, names: Map<string, string> = new Map()): NeedLineDto {
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
    categoryName: row.category?.name ?? null,
    labItemId: row.labItemId,
    labName: row.lab?.name ?? null,
    priority: row.priority,
    kind: row.kind,
    replacesItems: row.replacesItemIds.map((id) => ({ id, name: names.get(id) ?? "an item no longer in the register" })),
    spec: row.spec,
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

/** The items under a lab (the lab itself excluded), by id. */
async function idsInsideLab(labItemId: string): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE sub AS (
      SELECT id FROM "Item" WHERE "parentId" = ${labItemId} AND "deletedAt" IS NULL
      UNION ALL
      SELECT i.id FROM "Item" i INNER JOIN sub s ON i."parentId" = s.id WHERE i."deletedAt" IS NULL
    )
    SELECT id FROM sub
  `;
  return new Set(rows.map((r) => r.id));
}

/**
 * "This lab needs …" — raised by the lab's custodian, for a lab they run. It belongs to
 * the unit that owns the lab, whose head reads it while building a purchase request and
 * decides what to carry forward (never auto-converted). A replacement names the broken
 * or lost item it replaces, and takes that item's category.
 */
export async function raiseNeed(actorId: string, fields: RaiseNeedFields): Promise<NeedLineDto> {
  const input = { priority: "IMPORTANT" as const, kind: "NEW" as const, ...fields, replacesItemIds: fields.replacesItemIds ?? [] };
  const person = await loadPerson(actorId);
  if (!canRaiseNeed(person)) throw new HttpError(403, "Needs are raised by the custodians who run the labs.");
  const lab = await prisma.item.findUnique({ where: { id: input.labItemId }, select: { id: true, name: true, parentId: true, deletedAt: true, ownerOrgNodeId: true, category: { select: { key: true } } } });
  if (!lab || lab.deletedAt || lab.parentId) throw new HttpError(400, "Choose one of your labs.");
  await scope.assertCanMutate(actorId, [lab.id]);

  let categoryId = input.categoryId ?? null;
  let replacesItemIds: string[] = [];
  if (input.kind === "REPLACEMENT") {
    const ids = [...new Set(input.replacesItemIds)];
    if (!ids.length) throw new HttpError(400, "Choose the items this replaces.");
    const inside = await idsInsideLab(lab.id);
    if (ids.some((id) => !inside.has(id))) throw new HttpError(400, `Something chosen isn't in ${lab.name}.`);
    const replaced = await prisma.item.findMany({ where: { id: { in: ids } }, select: { id: true, status: true, categoryId: true } });
    if (replaced.some((r) => r.status !== "BROKEN" && r.status !== "LOST")) throw new HttpError(400, "Only something broken or lost is replaced — mark it so first.");
    if (new Set(replaced.map((r) => r.categoryId)).size > 1) throw new HttpError(400, "Replace one kind of thing at a time.");
    if ((await alreadyReplaced(ids)).size) throw new HttpError(409, "A replacement has already been asked for some of these.");
    replacesItemIds = ids;
    categoryId = replaced[0].categoryId;
  }

  const row = await prisma.needLine.create({
    data: {
      raisedById: actorId,
      orgNodeId: lab.ownerOrgNodeId,
      labItemId: lab.id,
      name: input.name,
      qty: input.qty,
      unit: input.unit ?? null,
      categoryId,
      priority: input.priority,
      kind: input.kind,
      replacesItemIds,
      spec: input.spec?.trim() || null,
      reason: input.reason,
    },
    include: needInclude,
  });
  const head = await prisma.orgNode.findUnique({ where: { id: lab.ownerOrgNodeId }, select: { userId: true } });
  await notify(head?.userId, actorId, {
    subject: `${lab.name} needs ${input.name}`,
    paragraphs: [
      `${esc(row.raisedBy.name)} asked for <strong>${esc(input.name)}</strong> (× ${esc(String(input.qty))}) for ${esc(lab.name)} — ${esc(PRIORITY_WORD[input.priority])}.`,
      `“${esc(input.reason)}”`,
      "Carry it into a purchase request, or decline it with a reason.",
    ],
    path: "/purchasing?tab=needs",
    action: "Review the lab's needs",
  });
  return toNeedDto(row, await namesOf(replacesItemIds));
}

/** The items among `ids` a live (open or carried) need already replaces. */
async function alreadyReplaced(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const live = await prisma.needLine.findMany({ where: { status: { in: ["OPEN", "CARRIED"] }, replacesItemIds: { hasSome: ids } }, select: { replacesItemIds: true } });
  const wanted = new Set(ids);
  return new Set(live.flatMap((n) => n.replacesItemIds).filter((id) => wanted.has(id)));
}

async function namesOf(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await prisma.item.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function toNeedDtos(rows: NeedRow[]): Promise<NeedLineDto[]> {
  const names = await namesOf([...new Set(rows.flatMap((r) => r.replacesItemIds))]);
  return rows.map((r) => toNeedDto(r, names));
}

const PRIORITY_WORD: Record<NeedLineDto["priority"], string> = { ESSENTIAL: "essential", IMPORTANT: "important", NICE_TO_HAVE: "nice to have" };

/** The person who raised it takes back a need nobody has acted on yet. */
export async function withdrawNeed(actorId: string, needId: string): Promise<void> {
  const need = await prisma.needLine.findUnique({ where: { id: needId }, select: { raisedById: true, status: true } });
  if (!need || need.raisedById !== actorId) throw new HttpError(404, "Need not found");
  if (need.status !== "OPEN") throw new HttpError(409, "The head has already acted on this need.");
  await prisma.needLine.delete({ where: { id: needId } });
}

/**
 * Broken or lost items with no replacement asked for yet — in the labs a unit owns (for
 * its head, `orgNodeId`), or in the labs the caller runs (a custodian, no `orgNodeId`).
 */
export async function replacementSuggestions(actorId: string, orgNodeId?: string): Promise<ReplacementSuggestionDto[]> {
  let labs: Array<{ id: string; name: string }>;
  if (orgNodeId) {
    await assertHeadsNode(actorId, orgNodeId);
    labs = await prisma.item.findMany({ where: { ownerOrgNodeId: orgNodeId, parentId: null, deletedAt: null, category: { key: { not: "store" } } }, select: { id: true, name: true } });
  } else {
    labs = await prisma.item.findMany({ where: { custodianId: actorId, parentId: null, deletedAt: null, category: { key: { not: "store" } } }, select: { id: true, name: true } });
  }
  const out: ReplacementSuggestionDto[] = [];
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  for (const lab of labs.sort((a, b) => collator.compare(a.name, b.name))) {
    const inside = [...(await idsInsideLab(lab.id))];
    if (!inside.length) continue;
    const failed = await prisma.item.findMany({
      where: { id: { in: inside }, status: { in: ["BROKEN", "LOST"] } },
      select: { id: true, name: true, status: true, categoryId: true, category: { select: { name: true } } },
    });
    const covered = await alreadyReplaced(failed.map((f) => f.id));
    const byCategory = new Map<string, ReplacementSuggestionDto>();
    for (const f of failed.filter((f) => !covered.has(f.id)).sort((a, b) => collator.compare(a.name, b.name))) {
      const group = byCategory.get(f.categoryId) ?? { labItemId: lab.id, labName: lab.name, categoryId: f.categoryId, categoryName: f.category.name, items: [] };
      group.items.push({ id: f.id, name: f.name, status: f.status as "BROKEN" | "LOST" });
      byCategory.set(f.categoryId, group);
    }
    out.push(...[...byCategory.values()].sort((a, b) => b.items.length - a.items.length || collator.compare(a.categoryName, b.categoryName)));
  }
  return out;
}

/** What a head reads while compiling their own unit's request. Head-of-`orgNodeId`
 *  only, or SYS_ADMIN — occupancy alone (F-017 of the 2026-09-15 campaign): this
 *  used to ALSO require the MANAGER role before even reaching `assertHeadsNode`'s
 *  own occupancy check, so removing MANAGER from a sitting head silently broke
 *  this while `assertHeadsNode` alone would have kept working correctly. */
export async function listOpenNeeds(actorId: string, orgNodeId: string): Promise<NeedLineDto[]> {
  await assertHeadsNode(actorId, orgNodeId);
  const rows = await prisma.needLine.findMany({ where: { orgNodeId, status: "OPEN" }, include: needInclude, orderBy: { createdAt: "asc" } });
  return (await toNeedDtos(rows)).sort(byPriorityThenAge);
}

export async function listMyNeeds(actorId: string): Promise<NeedLineDto[]> {
  const rows = await prisma.needLine.findMany({ where: { raisedById: actorId }, include: needInclude, orderBy: { createdAt: "desc" } });
  return toNeedDtos(rows);
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
    path: "/purchasing?tab=needs",
  });
  return (await toNeedDtos([row]))[0];
}

// ── Purchase requests ────────────────────────────────────────────────────────────

const requestInclude = {
  orgNode: { select: { name: true } },
  raisedBy: { select: { name: true } },
  lines: { include: { answeredNeeds: { select: { id: true } } } },
  events: { orderBy: { at: "asc" }, include: { by: { select: { name: true } }, attachments: attachments.eventAttachmentsInclude } },
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
    history: row.events.map((e) => ({
      at: e.at.toISOString(),
      byId: e.byId,
      byName: e.by.name,
      stage: e.stage,
      note: e.note,
      attachments: e.attachments.map(attachments.toAttachmentDto),
    })),
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
        const event = await tx.purchaseEvent.create({ data: { purchaseId: request.id, byId: actorId, stage: "APPROVING", note: "Submitted for approval." } });
        await attachments.claim(tx, actorId, input.attachmentIds, request.id, event.id);

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
 *  transfer chain relies on. */
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
    const event = await tx.purchaseEvent.create({ data: { purchaseId: requestId, byId: actorId, stage: "APPROVING", note: "Revised and resubmitted." } });
    await attachments.claim(tx, actorId, input.attachmentIds, requestId, event.id);
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

export async function decideStep(
  actorId: string,
  requestId: string,
  decision: "APPROVE" | "REJECT" | "REVISE",
  note?: string,
  attachmentIds?: string[],
): Promise<PurchaseRequestDto> {
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
      const event = await tx.purchaseEvent.create({ data: { purchaseId: requestId, byId: actorId, at, stage: "REJECTED", note: eventNote() } });
      await attachments.claim(tx, actorId, attachmentIds, requestId, event.id);
      await reopenCarriedNeeds(tx, requestId, request.reference, `rejected${note ? `: ${note}` : ""}`);
      return;
    }

    if (decision === "REVISE") {
      await tx.purchaseStep.deleteMany({ where: { requestId } });
      await tx.purchaseRequest.update({ where: { id: requestId }, data: { stage: "REVISING", feedback: note ?? "Sent back for revision." } });
      const event = await tx.purchaseEvent.create({ data: { purchaseId: requestId, byId: actorId, at, stage: "REVISING", note: eventNote() } });
      await attachments.claim(tx, actorId, attachmentIds, requestId, event.id);
      return;
    }

    await tx.purchaseStep.update({ where: { id: step!.id }, data: { status: "APPROVED", decidedById: actorId, decidedAt: at, note: note ?? null } });
    const event = await tx.purchaseEvent.create({ data: { purchaseId: requestId, byId: actorId, at, stage: "APPROVING", note: eventNote("Approved") } });
    await attachments.claim(tx, actorId, attachmentIds, requestId, event.id);

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
  const cited = documentsSentWith(dto);
  if (dto.stage === "APPROVING") await tellNextApprover(dto, actorId);
  else if (dto.stage === "REJECTED")
    await tellRaiser(dto, actorId, `${dto.reference} was rejected`, [`${summary(dto)} was rejected and won't go further. Any needs carried into it are open again.${quoted(note)}`, ...cited]);
  else if (dto.stage === "REVISING")
    await tellRaiser(dto, actorId, `${dto.reference} was sent back for revision`, [
      `${summary(dto)} was sent back to you. Edit it and resubmit; the approval chain starts again.${quoted(note)}`,
      ...cited,
    ]);
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
export async function cancelPurchaseRequest(actorId: string, requestId: string, note?: string, attachmentIds?: string[]): Promise<void> {
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
    const event = await tx.purchaseEvent.create({
      data: { purchaseId: requestId, byId: actorId, stage: "CANCELLED", note: isRaiser ? "Withdrawn by the requester." : `Cancelled by procurement: ${note}` },
    });
    await attachments.claim(tx, actorId, attachmentIds, requestId, event.id);
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
    await tellRaiser(dto, actorId, `${dto.reference} was cancelled by procurement`, [
      `Procurement cancelled ${summary(dto)}. Any needs carried into it are open again.${quoted(note)}`,
      ...documentsSentWith(dto),
    ]);
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
    // Property Administration records what actually came (the import record); the
    // store keeper loads the store from that record — never straight off the request.
    await notify(await usersWithRole("PROPERTY_ADMIN"), actorId, {
      subject: `${dto.reference} has arrived at the main store`,
      paragraphs: [`${summary(dto)} has arrived. Record what came in as an import record under <strong>Purchasing → Imports</strong>, so the store keeper can load it into the store.`],
      path: paths.arrivals(),
    });
  }
  return dto;
}

/**
 * Goods reach the register through an import record now (lib/server/resources/
 * imports.ts): Property Administration records what arrived, the store keeper loads
 * it, and each loaded line linked to one of this request's lines adds to that line's
 * `receivedQty`. This closes the request once every line has been received in full,
 * and tells the raiser — called by the import loader after each load.
 */
export async function closeIfFullyReceived(requestId: string, actorId: string): Promise<boolean> {
  const request = await prisma.purchaseRequest.findUnique({ where: { id: requestId }, include: { lines: true } });
  if (!request || request.stage !== "IN_STORE") return false;
  const complete = request.lines.every((l) => l.receivedQty !== null && dec(l.receivedQty)! >= dec(l.qty)!);
  if (!complete) return false;
  await prisma.$transaction([
    prisma.purchaseRequest.update({ where: { id: requestId }, data: { stage: "CLOSED" } }),
    prisma.purchaseEvent.create({ data: { purchaseId: requestId, byId: actorId, stage: "CLOSED", note: "Every line registered." } }),
  ]);
  const dto = await loadDto(requestId, actorId);
  await tellRaiser(dto, actorId, `${dto.reference} is in the store`, [`Everything on ${summary(dto)} is registered in the main store. The store keeper can now hand it over to your labs.`]);
  return true;
}

// ── Notifications (lib/server/mail/notify.ts) — always after the write commits ────

function summary(dto: PurchaseRequestDto): string {
  return `<strong>${esc(dto.reference)}</strong> “${esc(dto.title)}” (${esc(dto.orgNodeName)}, ${dto.lines.length} line${dto.lines.length === 1 ? "" : "s"})`;
}

function fileList(files: PurchaseRequestDto["history"][number]["attachments"]): string {
  return files.map((f) => `“${esc(f.fileName)}”`).join(", ");
}

/** The documents sent with the latest action, as a mail paragraph. The files stay in
 *  the app (never attached to mail): they are read there, behind the request's own
 *  read check. */
function documentsSentWith(dto: PurchaseRequestDto): string[] {
  const files = dto.history.at(-1)?.attachments ?? [];
  if (!files.length) return [];
  return [`Documents sent with it: ${fileList(files)}. Open the request in the app to read them.`];
}

/** The approver the request is now waiting on, if anyone holds that post. */
async function tellNextApprover(dto: PurchaseRequestDto, actorId: string): Promise<void> {
  const step = dto.steps.find((s) => s.status === "PENDING");
  if (!step?.approverId) return;
  const files = dto.history.flatMap((e) => e.attachments);
  await notify(step.approverId, actorId, {
    subject: `${dto.reference} is waiting for your approval`,
    paragraphs: [
      `A purchase request has reached your step (${esc(step.label)}): ${summary(dto)}, raised by ${esc(dto.raisedByName)}.`,
      ...(files.length ? [`It carries ${files.length} supporting document${files.length === 1 ? "" : "s"}: ${fileList(files)}.`] : []),
      "Approve it, send it back for revision, or reject it under <strong>Approvals → Purchasing</strong>.",
    ],
    path: paths.decide("purchase", dto.id),
    action: "Review the request",
  });
}

async function tellRaiser(dto: PurchaseRequestDto, actorId: string, subject: string, paragraphs: string[]): Promise<void> {
  await notify(dto.raisedById, actorId, { subject, paragraphs, path: paths.mine("purchase", dto.id) });
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
  await assertCanReadRequest(actorId, requestId);
  return loadDto(requestId, actorId);
}

/** The same "who may follow this request" gate, on its own — also guards the request's
 *  documents (app/api/resources/purchase-attachments/[id]). */
export async function assertCanReadRequest(actorId: string, requestId: string): Promise<void> {
  const where = await readableRequestWhere(actorId);
  const visible = await prisma.purchaseRequest.count({ where: where ? { AND: [{ id: requestId }, where] } : { id: requestId } });
  if (!visible) throw new HttpError(404, "Resource not found");
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
    // What has arrived and needs an import record (Property Administration), or is
    // about to be loaded (the store keeper).
    const person = await loadPerson(actorId);
    if (!canRecordImports(person) && !canReceive(person)) throw new HttpError(403, "Only Property Administration and the store keeper browse what has arrived.");
    const rows = await prisma.purchaseRequest.findMany({ where: { stage: "IN_STORE" }, include: requestInclude, orderBy: { createdAt: "asc" } });
    return toRequestDtos(rows, actorId);
  }

  const rows = await prisma.purchaseRequest.findMany({ where: { stage: "APPROVING" }, include: requestInclude, orderBy: { createdAt: "asc" } });
  const dtos = await toRequestDtos(rows, actorId);
  return dtos.filter((d) => d.steps.some((s) => s.status === "PENDING" && s.approverId === actorId));
}
