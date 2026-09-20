import "server-only";
import crypto from "node:crypto";
import type { ItemChangeInput, StageDraftChangeInput, DraftTargetKind, ItemDraftChangeDto, LabCommitRequestDto, IdealVsActualRowDto, DepartmentPurchasablesDto } from "@/lib/shared";
import { prisma } from "../prisma";
import { HttpError } from "../http-error";
import * as scope from "./scope";
import { applyChange, previewChange } from "./mutate";
import { toDomainCategoryMap, toDomainItem } from "./adapt";
import { computeStatuses, statusOf, NEEDS_ATTENTION } from "@/lib/domain/status";
import { aggregatePurchasables, type LabIdealSheet } from "@/lib/domain/purchasables";

/**
 * Track 2 — lab draft/visible/ideal states. See
 * ~/.claude/plans/lets-merge-the-work-memoized-journal.md §5 for the full design.
 *
 * A custodian free-edits their own lab in DRAFT (`ItemDraftChange` rows — no
 * approval needed to stage). Submitting a batch creates one `LabCommitRequest`,
 * decided by exactly the lab's owning department's head — resolved LIVE via the org
 * chart every time, never a frozen id, so a vacant post BLOCKS (decidable by
 * nobody) and a headship change immediately redirects who may decide. Approval to
 * VISIBLE applies every staged operation through the EXISTING, unmodified write door
 * (`applyChange`) — this module never writes an `Item` row itself. Approval to IDEAL
 * instead upserts `LabIdealTarget` rows directly — not an `Item` write at all.
 *
 * ROLLOUT SAFETY: every entry point here checks `OrgNode.draftWorkflowEnabled` for
 * the lab's OWNING unit first and refuses if it is off (today's state for every real
 * department) — direct editing via the ordinary write door is completely unaffected
 * for a department that hasn't opted in.
 */

// ── Which ItemChangeKinds may be staged at all ──────────────────────────────
//
// Anything that reaches into another unit's accountability (ownership, custody,
// cross-lab transfer) is deliberately EXCLUDED — the user's own words drew this
// line: "within his own lab, everything is in his power... but move to other
// people['s] owned things are an issue." That is Track 3's acceptance flow, not this
// one. `moveInTree` stays allowed but only to a destination WITHIN the same lab's
// own subtree (reordering containment inside the lab you already run).

const NOT_STAGEABLE = new Set(["transferItem", "setOwnerOrg", "setCurrentOrg", "setCustodian"]);

function targetIdsOf(input: ItemChangeInput): string[] {
  if (input.kind === "createItem") return input.parentId ? [input.parentId] : [];
  if (input.kind === "moveInTree") return input.value ? [...input.itemIds, input.value] : input.itemIds;
  return input.itemIds;
}

async function assertStageable(labItemId: string, input: ItemChangeInput): Promise<void> {
  if (NOT_STAGEABLE.has(input.kind)) {
    throw new HttpError(400, `"${input.kind}" changes accountability across units and cannot be staged as a lab draft — see the transfer flow instead.`);
  }
  if (input.kind === "createItem" && !input.parentId) {
    throw new HttpError(400, "A brand-new top-level resource is not part of any lab's draft — create it directly instead.");
  }
  const ids = targetIdsOf(input);
  if (!ids.length) return;
  const inSubtree = await subtreeIdSet(labItemId);
  const outside = ids.filter((id) => !inSubtree.has(id));
  if (outside.length) {
    throw new HttpError(400, "This change reaches outside the lab it is being staged under.");
  }
}

/** Every item id physically within `labItemId`'s own subtree, including itself. A
 *  small, standalone recursive query — mirrors `scope.ts`'s own
 *  `descendantIdsIncludingSelf`/`custodyItemIdsOf`, not reused directly since neither
 *  is exported and both answer a slightly different question. */
async function subtreeIdSet(labItemId: string): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE subtree AS (
      SELECT id FROM "Item" WHERE id = ${labItemId} AND "deletedAt" IS NULL
      UNION ALL
      SELECT i.id FROM "Item" i INNER JOIN subtree s ON i."parentId" = s.id WHERE i."deletedAt" IS NULL
    )
    SELECT id FROM subtree
  `;
  return new Set(rows.map((r) => r.id));
}

async function loadLabOwnerNode(labItemId: string): Promise<{ ownerOrgNodeId: string; name: string }> {
  const lab = await prisma.item.findUnique({ where: { id: labItemId, deletedAt: null }, select: { ownerOrgNodeId: true, name: true } });
  if (!lab) throw new HttpError(404, "Resource not found");
  return lab;
}

async function assertWorkflowEnabled(ownerOrgNodeId: string): Promise<void> {
  const node = await prisma.orgNode.findUnique({ where: { id: ownerOrgNodeId }, select: { draftWorkflowEnabled: true } });
  if (!node?.draftWorkflowEnabled) {
    throw new HttpError(403, "Draft mode is not enabled for this lab's department — edit directly instead.");
  }
}

/** Admin-only. Rollout safety (§5.2): default `false` for every department — this is
 *  the ONE place that changes, and it changes nothing about direct editing for any
 *  OTHER department. Toggling it back off does not touch any already-staged or
 *  already-submitted rows; it only gates NEW `stageChange`/`submitDraft` calls. */
export async function setDraftWorkflowEnabled(orgNodeId: string, enabled: boolean): Promise<void> {
  const node = await prisma.orgNode.findUnique({ where: { id: orgNodeId }, select: { id: true } });
  if (!node) throw new HttpError(404, "Org node not found");
  await prisma.orgNode.update({ where: { id: orgNodeId }, data: { draftWorkflowEnabled: enabled } });
}

/** The person who may decide a commit for this owning unit right now, or `null` if
 *  the headship is vacant — re-derived live on every call, never cached. */
async function currentHeadOf(ownerOrgNodeId: string): Promise<{ id: string; name: string } | null> {
  const node = await prisma.orgNode.findUnique({ where: { id: ownerOrgNodeId }, select: { user: { select: { id: true, name: true } } } });
  return node?.user ?? null;
}

// ── Staging ──────────────────────────────────────────────────────────────

export async function stageChange(actorId: string, labItemId: string, input: StageDraftChangeInput): Promise<ItemDraftChangeDto> {
  const lab = await loadLabOwnerNode(labItemId);
  await assertWorkflowEnabled(lab.ownerOrgNodeId);

  if (input.targetKind === "VISIBLE") {
    await assertStageable(labItemId, input.change);
    // Proves the actor may legitimately perform this operation (custody, category
    // validation, everything applyChange itself would check) WITHOUT applying it —
    // a doomed edit is caught before it is even staged, not discovered at approval
    // time by someone else. `bypassDraftWorkflowBlock: true` — staging THROUGH this
    // module is the legitimate path mutate.ts's own block exists to require; only a
    // call that skips lab-drafts.ts entirely should ever be refused by it.
    await previewChange(actorId, input.change, undefined, true);
  } else {
    // IDEAL never reaches applyChange, so it needs its own explicit custody check —
    // the same floor a direct edit to this lab would require.
    await scope.assertCanMutate(actorId, [labItemId]);
  }

  const row = await prisma.itemDraftChange.create({
    data: { labItemId, authorId: actorId, targetKind: input.targetKind, payload: input.targetKind === "VISIBLE" ? input.change : { categoryId: input.categoryId, qty: input.qty } },
    include: { author: { select: { name: true } } },
  });
  return toDraftDto(row);
}

function toDraftDto(row: { id: string; labItemId: string; authorId: string; targetKind: string; payload: unknown; status: string; batchId: string | null; createdAt: Date; author: { name: string } }): ItemDraftChangeDto {
  return {
    id: row.id,
    labItemId: row.labItemId,
    authorId: row.authorId,
    authorName: row.author.name,
    targetKind: row.targetKind as DraftTargetKind,
    payload: row.payload,
    status: row.status as ItemDraftChangeDto["status"],
    batchId: row.batchId,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The custodian's own pending-changes view — gated the same way staging is (must
 *  hold the same custody a direct edit to this lab would need). */
export async function listDraft(actorId: string, labItemId: string): Promise<ItemDraftChangeDto[]> {
  await scope.assertCanMutate(actorId, [labItemId]);
  const rows = await prisma.itemDraftChange.findMany({
    where: { labItemId, status: "OPEN" },
    include: { author: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toDraftDto);
}

export async function withdrawDraft(actorId: string, draftId: string): Promise<void> {
  const row = await prisma.itemDraftChange.findUnique({ where: { id: draftId } });
  if (!row || row.status !== "OPEN") throw new HttpError(404, "Draft change not found");
  await scope.assertCanMutate(actorId, [row.labItemId]);
  await prisma.itemDraftChange.delete({ where: { id: draftId } });
}

// ── Submitting a batch ───────────────────────────────────────────────────

export async function submitDraft(actorId: string, labItemId: string, targetKind: DraftTargetKind): Promise<LabCommitRequestDto> {
  const lab = await loadLabOwnerNode(labItemId);
  await assertWorkflowEnabled(lab.ownerOrgNodeId);
  await scope.assertCanMutate(actorId, [labItemId]);

  const open = await prisma.itemDraftChange.findMany({ where: { labItemId, authorId: actorId, targetKind, status: "OPEN" } });
  if (!open.length) throw new HttpError(400, "There is nothing staged to submit.");

  const baseVersions: Record<string, number> = {};
  if (targetKind === "VISIBLE") {
    const ids = new Set<string>();
    for (const row of open) for (const id of targetIdsOf(row.payload as ItemChangeInput)) ids.add(id);
    if (ids.size) {
      const rows = await prisma.item.findMany({ where: { id: { in: [...ids] } }, select: { id: true, version: true } });
      for (const r of rows) baseVersions[r.id] = r.version;
    }
  }

  const batchId = crypto.randomUUID();
  const request = await prisma.$transaction(async (tx) => {
    await tx.itemDraftChange.updateMany({ where: { id: { in: open.map((r) => r.id) } }, data: { status: "SUBMITTED", batchId } });
    return tx.labCommitRequest.create({
      data: { labItemId, targetKind, requesterId: actorId, batchId, baseVersions },
      include: { requester: { select: { name: true } } },
    });
  });

  return toCommitDto({ ...request, lab: { name: lab.name } }, open.map((r) => ({ ...r, status: "SUBMITTED" as const, batchId })), await currentHeadOf(lab.ownerOrgNodeId), actorId);
}

function toCommitDto(
  request: {
    id: string;
    labItemId: string;
    targetKind: string;
    requesterId: string;
    batchId: string;
    status: string;
    note: string | null;
    decidedById: string | null;
    decidedAt: Date | null;
    resolution: string | null;
    createdAt: Date;
    requester: { name: string };
    decidedBy?: { name: string } | null;
    lab: { name: string };
  },
  changes: Array<{ id: string; labItemId: string; authorId: string; targetKind: string; payload: unknown; status: string; batchId: string | null; createdAt: Date }>,
  head: { id: string; name: string } | null,
  viewerId: string,
): LabCommitRequestDto {
  return {
    id: request.id,
    labItemId: request.labItemId,
    labName: request.lab.name,
    targetKind: request.targetKind as DraftTargetKind,
    requesterId: request.requesterId,
    requesterName: request.requester.name,
    batchId: request.batchId,
    status: request.status as LabCommitRequestDto["status"],
    note: request.note,
    decidedById: request.decidedById,
    decidedByName: request.decidedBy?.name ?? null,
    decidedAt: request.decidedAt ? request.decidedAt.toISOString() : null,
    resolution: request.resolution,
    createdAt: request.createdAt.toISOString(),
    changes: changes.map((c) => ({ id: c.id, labItemId: c.labItemId, authorId: c.authorId, authorName: request.requester.name, targetKind: c.targetKind as DraftTargetKind, payload: c.payload, status: c.status as ItemDraftChangeDto["status"], batchId: c.batchId, createdAt: c.createdAt.toISOString() })),
    canDecide: request.status === "PENDING" && head?.id === viewerId,
  };
}

// ── Listing and deciding ─────────────────────────────────────────────────

async function loadRequestWithChanges(requestId: string) {
  const request = await prisma.labCommitRequest.findUnique({
    where: { id: requestId },
    include: { requester: { select: { name: true } }, decidedBy: { select: { name: true } }, lab: { select: { name: true, ownerOrgNodeId: true } } },
  });
  if (!request) throw new HttpError(404, "Request not found");
  const changes = await prisma.itemDraftChange.findMany({ where: { batchId: request.batchId } });
  return { request, changes };
}

/** `box: "inbox"` — every PENDING request this actor may decide right now (the
 *  current, live head of the request's own lab's owning unit — never a stored
 *  flag, so a reassignment moves inbox visibility automatically). `box: "mine"` —
 *  every request this actor raised, any status. */
export async function listForActor(actorId: string, box: "inbox" | "mine"): Promise<LabCommitRequestDto[]> {
  if (box === "mine") {
    const requests = await prisma.labCommitRequest.findMany({
      where: { requesterId: actorId },
      include: { requester: { select: { name: true } }, decidedBy: { select: { name: true } }, lab: { select: { name: true, ownerOrgNodeId: true } } },
      orderBy: { createdAt: "desc" },
    });
    const out: LabCommitRequestDto[] = [];
    for (const r of requests) {
      const changes = await prisma.itemDraftChange.findMany({ where: { batchId: r.batchId } });
      const head = await currentHeadOf(r.lab.ownerOrgNodeId);
      out.push(toCommitDto(r, changes, head, actorId));
    }
    return out;
  }

  // Inbox: every unit this actor currently heads, then every PENDING request owned
  // by one of those units.
  const headedNodes = await prisma.orgNode.findMany({ where: { userId: actorId }, select: { id: true } });
  if (!headedNodes.length) return [];
  const requests = await prisma.labCommitRequest.findMany({
    where: { status: "PENDING", lab: { ownerOrgNodeId: { in: headedNodes.map((n) => n.id) } } },
    include: { requester: { select: { name: true } }, decidedBy: { select: { name: true } }, lab: { select: { name: true, ownerOrgNodeId: true } } },
    orderBy: { createdAt: "asc" },
  });
  const out: LabCommitRequestDto[] = [];
  for (const r of requests) {
    const changes = await prisma.itemDraftChange.findMany({ where: { batchId: r.batchId } });
    out.push(toCommitDto(r, changes, { id: actorId, name: "" }, actorId));
  }
  return out;
}

/** A commit request carries a lab's full diff — readable only by the requester
 *  themself, the lab's current deciding head, or SYS_ADMIN. Out-of-scope returns
 *  404, matching every other item-adjacent read in this app (a 403 would confirm
 *  the request exists). */
export async function getRequest(actorId: string, requestId: string): Promise<LabCommitRequestDto> {
  const { request, changes } = await loadRequestWithChanges(requestId);
  const head = await currentHeadOf(request.lab.ownerOrgNodeId);
  const allowed = actorId === request.requesterId || actorId === head?.id || (await scope.isSysAdmin(actorId));
  if (!allowed) throw new HttpError(404, "Resource not found");
  return toCommitDto(request, changes, head, actorId);
}

/**
 * A vacant headship BLOCKS — decidable by nobody until someone is appointed, the
 * same invariant the generic chain engine already proves in 45 tests, applied here
 * to a single step instead of a walked one. Refuses with 403 either way (wrong
 * person, or nobody at all) — the vacancy itself is surfaced through the read side
 * (`getRequest`/`listForActor`'s `canDecide`), not by a different error shape here.
 */
export async function decideCommit(actorId: string, requestId: string, decision: "APPROVE" | "REJECT", note?: string): Promise<LabCommitRequestDto> {
  const { request, changes } = await loadRequestWithChanges(requestId);
  if (request.status !== "PENDING") throw new HttpError(409, "This request has already been decided.");

  const head = await currentHeadOf(request.lab.ownerOrgNodeId);
  if (!head || head.id !== actorId) {
    throw new HttpError(403, "You are not this lab's department head — you may not decide this request.");
  }

  if (decision === "REJECT") {
    await prisma.$transaction([
      prisma.labCommitRequest.update({ where: { id: requestId }, data: { status: "REJECTED", decidedById: actorId, decidedAt: new Date(), resolution: note ?? null } }),
      // Stays in draft for revision — the user's explicit choice — never deleted.
      prisma.itemDraftChange.updateMany({ where: { batchId: request.batchId }, data: { status: "OPEN", batchId: null } }),
    ]);
    return getRequest(actorId, requestId);
  }

  if (request.targetKind === "IDEAL") {
    await prisma.$transaction(async (tx) => {
      for (const c of changes) {
        const { categoryId, qty } = c.payload as { categoryId: string; qty: number };
        await tx.labIdealTarget.upsert({
          where: { labItemId_categoryId: { labItemId: request.labItemId, categoryId } },
          update: { idealQty: qty },
          create: { labItemId: request.labItemId, categoryId, idealQty: qty },
        });
      }
      await tx.itemDraftChange.updateMany({ where: { batchId: request.batchId }, data: { status: "APPLIED" } });
      await tx.labCommitRequest.update({ where: { id: requestId }, data: { status: "APPLIED", decidedById: actorId, decidedAt: new Date(), resolution: note ?? null } });
    });
    return getRequest(actorId, requestId);
  }

  // VISIBLE: pre-flight every staged operation as a dry run FIRST. Each real
  // `applyChange` call below manages its OWN transaction (mutate.ts's own design —
  // "one write door", not a second transactional path this module opens instead),
  // so this batch cannot be made formally atomic across all N operations the way a
  // single applyChange call is atomic within itself. The pre-flight pass is what
  // makes "nothing partially applies" true in practice: every operation is proven
  // valid against CURRENT state before any of them commits for real. The residual
  // race — state changing between the pre-flight and the real apply of a LATER
  // operation in the same batch, in the few milliseconds of one request — is the
  // same class of risk `assertVersionsMatch`'s own FOR UPDATE lock already narrows
  // per-operation; it is not eliminated for the batch as a whole.
  // `bypassDraftWorkflowBlock: true` on both loops — this IS the approved conclusion
  // of the draft workflow mutate.ts's own block exists to require; by this point
  // staging and approval have already happened, so the block must not refuse the
  // very apply it was raised to enable.
  for (const c of changes) {
    try {
      await previewChange(request.requesterId, c.payload as ItemChangeInput, undefined, true);
    } catch (err) {
      await prisma.labCommitRequest.update({ where: { id: requestId }, data: { status: "STALE", resolution: err instanceof HttpError ? err.message : "One or more staged changes no longer apply." } });
      return getRequest(actorId, requestId);
    }
  }

  for (const c of changes) {
    await applyChange(request.requesterId, c.payload as ItemChangeInput, { bypassDraftWorkflowBlock: true });
    await prisma.itemDraftChange.update({ where: { id: c.id }, data: { status: "APPLIED" } });
  }
  await prisma.labCommitRequest.update({ where: { id: requestId }, data: { status: "APPLIED", decidedById: actorId, decidedAt: new Date(), resolution: note ?? null } });
  return getRequest(actorId, requestId);
}

// ── Ideal vs. actual ─────────────────────────────────────────────────────

/** "Needs attention" here is the same EFFECTIVE status the register/dashboard
 *  already use (`lib/domain/status.ts`'s `NEEDS_ATTENTION`, not the raw stored
 *  column) — an item nested under an impaired container is exactly the kind of
 *  thing a department head reviewing a lab's gap should see flagged, the same as
 *  everywhere else in this app. */
export async function getIdealVsActual(actorId: string, labItemId: string): Promise<IdealVsActualRowDto[]> {
  await scope.assertMaySeeLabAggregate(actorId, labItemId);
  return idealVsActualRows(labItemId, await loadCategoryRows());
}

function loadCategoryRows() {
  return prisma.resourceCategory.findMany({ include: { group: { select: { name: true } }, fields: true, templateAsParent: true, placementRulesAsChild: true } });
}

async function idealVsActualRows(labItemId: string, categoryRows: Awaited<ReturnType<typeof loadCategoryRows>>): Promise<IdealVsActualRowDto[]> {
  const subtree = await subtreeIdSet(labItemId);
  subtree.delete(labItemId); // categories apply to what's placed INSIDE the lab, not the lab row itself

  const [targets, itemRows] = await Promise.all([
    prisma.labIdealTarget.findMany({ where: { labItemId }, include: { category: { select: { name: true } } } }),
    subtree.size ? prisma.item.findMany({ where: { id: { in: [...subtree] } }, include: { images: true } }) : Promise.resolve([]),
  ]);

  const categories = toDomainCategoryMap(categoryRows);
  const items = itemRows.map((r) => toDomainItem(r, r.images));
  const statuses = computeStatuses(items, categories);

  const byCategory = new Map<string, { name: string; count: number; broken: Array<{ id: string; name: string; status: string }> }>();
  for (const item of items) {
    const category = categories[item.categoryId];
    const entry = byCategory.get(item.categoryId) ?? { name: category?.name ?? item.categoryId, count: 0, broken: [] };
    entry.count += 1;
    const effective = statusOf(statuses, item.id);
    if (NEEDS_ATTENTION.includes(effective)) entry.broken.push({ id: item.id, name: item.name, status: effective });
    byCategory.set(item.categoryId, entry);
  }

  const categoryIds = new Set([...targets.map((t) => t.categoryId), ...byCategory.keys()]);
  return [...categoryIds].map((categoryId) => {
    const target = targets.find((t) => t.categoryId === categoryId);
    const actual = byCategory.get(categoryId);
    const idealQty = target?.idealQty ?? 0;
    const actualCount = actual?.count ?? 0;
    return {
      categoryId,
      categoryName: target?.category.name ?? actual?.name ?? categoryId,
      idealQty,
      actualCount,
      gap: Math.max(0, idealQty - actualCount),
      brokenItems: actual?.broken ?? [],
    };
  });
}

/**
 * What a department could buy to bring every one of its labs to its approved ideal
 * state — each lab that owns at least one `LabIdealTarget` and is OWNED by
 * `orgNodeId`, run through the same per-lab computation `getIdealVsActual` uses, then
 * rolled up by `lib/domain/purchasables.ts`. Ownership, not current location: a lab's
 * ideal state is its owning department's responsibility to fund. Readable by that
 * department's live head or SYS_ADMIN — the one person who compiles its purchase
 * requests.
 */
export async function getDepartmentPurchasables(actorId: string, orgNodeId: string): Promise<DepartmentPurchasablesDto> {
  const node = await prisma.orgNode.findUnique({ where: { id: orgNodeId }, select: { id: true, name: true } });
  if (!node) throw new HttpError(404, "Org node not found");
  if (!(await scope.isSysAdmin(actorId))) {
    const head = await currentHeadOf(orgNodeId);
    if (head?.id !== actorId) throw new HttpError(403, "Only this unit's head may compute its purchasables.");
  }

  const labs = await prisma.item.findMany({
    where: { ownerOrgNodeId: orgNodeId, deletedAt: null, labIdealTargets: { some: {} } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const categoryRows = await loadCategoryRows();
  const sheets: LabIdealSheet[] = [];
  for (const lab of labs) {
    sheets.push({ labItemId: lab.id, labName: lab.name, rows: await idealVsActualRows(lab.id, categoryRows) });
  }

  return { orgNodeId: node.id, orgNodeName: node.name, labCount: labs.length, rows: aggregatePurchasables(sheets) };
}
