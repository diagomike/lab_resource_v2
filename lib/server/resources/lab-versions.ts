import "server-only";
import crypto from "node:crypto";
import { Prisma, type Item as PrismaItem, type LabVersion, type LabVersionKind, type VersionItem } from "@prisma/client";
import type {
  DiffEntryDto,
  IdealStatRowDto,
  IdealVsActualRowDto,
  ItemChangeInput,
  ItemChangeResultDto,
  LabCommitRequestDto,
  LabStatesDto,
  LabSummaryDto,
  LabTreeNodeDto,
  LabVersionDto,
  PendingMarkersDto,
  VersionOpInput,
  DepartmentPurchasablesDto,
} from "@/lib/shared";
import type { Category, CustomProp, Item as DomainItem } from "@/lib/domain/types";
import { applyVersionOp, diffVersion, idealStats, VersionOpError, type LiveItem, type VersionOp, type VItem } from "@/lib/domain/version-ops";
import { computeStatuses, statusOf, NEEDS_ATTENTION } from "@/lib/domain/status";
import { aggregatePurchasables, type LabIdealSheet } from "@/lib/domain/purchasables";
import { prisma } from "../prisma";
import { HttpError } from "../http-error";
import * as scope from "./scope";
import * as orgScope from "../org/scope";
import { applyChange, createExactItems, type Tx } from "./mutate";
import { toDomainCategoryMap } from "./adapt";
import { storage } from "./storage";

/**
 * Lab states — Current, Draft and Ideal (2026-09-22 rework of Track 2; the pure rules
 * live in lib/domain/version-ops.ts).
 *
 * A LAB is a top-level item (a lab, a store). Its custodian edits two kinds of copy:
 *  - DRAFT — the lab's pending update (something broke, went for maintenance, was
 *    consumed, renamed, added, removed). Approved by the owning department's head, it
 *    MERGES into the live register through mutate.ts's write door, as the custodian.
 *    When the department has drafts turned on, ordinary register edits by the
 *    custodian land here automatically (`stageFromRegister`).
 *  - IDEAL_PROPOSAL — what the lab should hold. Approved, it REPLACES the lab's IDEAL,
 *    which purchasing measures the lab against. Ideal never writes the register.
 * The head only decides; they never edit a version (only custodians change resources).
 */

type KindArg = "DRAFT" | "IDEAL_PROPOSAL";

// ── Loading ──────────────────────────────────────────────────────────────

async function loadCategoryRows(client: Tx | typeof prisma = prisma) {
  return client.resourceCategory.findMany({ include: { group: { select: { name: true } }, fields: true, templateAsParent: true, placementRulesAsChild: true } });
}

async function loadCategories(client: Tx | typeof prisma = prisma): Promise<Record<string, Category>> {
  return toDomainCategoryMap(await loadCategoryRows(client));
}

async function loadLab(labItemId: string, client: Tx | typeof prisma = prisma) {
  const lab = await client.item.findUnique({
    where: { id: labItemId },
    include: { ownerOrg: { select: { id: true, name: true, draftWorkflowEnabled: true, user: { select: { id: true, name: true } } } }, custodian: { select: { id: true, name: true } } },
  });
  if (!lab || lab.deletedAt) throw new HttpError(404, "Resource not found");
  if (lab.parentId) throw new HttpError(400, "Lab states belong to a top-level resource (a lab or a store), not to something inside one.");
  return lab;
}

/** The lab's live subtree, the lab included. */
async function loadLive(labItemId: string, client: Tx | typeof prisma = prisma): Promise<PrismaItem[]> {
  const rows = await client.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE subtree AS (
      SELECT id FROM "Item" WHERE id = ${labItemId} AND "deletedAt" IS NULL
      UNION ALL
      SELECT i.id FROM "Item" i INNER JOIN subtree s ON i."parentId" = s.id WHERE i."deletedAt" IS NULL
    )
    SELECT id FROM subtree
  `;
  if (!rows.length) return [];
  return client.item.findMany({ where: { id: { in: rows.map((r) => r.id) } } });
}

const asCustom = (v: unknown): Record<string, CustomProp> => (v && typeof v === "object" ? (v as Record<string, CustomProp>) : {});
const asProps = (v: unknown): Record<string, string | number | boolean | null> => (v && typeof v === "object" ? (v as Record<string, string | number | boolean | null>) : {});

function toLive(row: PrismaItem): LiveItem {
  return { id: row.id, parentId: row.parentId, categoryId: row.categoryId, name: row.name, qty: Number(row.qty), status: row.status, props: asProps(row.props), customProps: asCustom(row.customProps) };
}

function toVItem(row: VersionItem): VItem {
  return {
    id: row.id,
    parentId: row.parentId,
    sourceItemId: row.sourceItemId,
    categoryId: row.categoryId,
    name: row.name,
    qty: Number(row.qty),
    status: row.status,
    critical: row.critical,
    props: asProps(row.props),
    customProps: asCustom(row.customProps),
  };
}

async function loadVersion(labItemId: string, kind: LabVersionKind, client: Tx | typeof prisma = prisma) {
  return client.labVersion.findUnique({ where: { labItemId_kind: { labItemId, kind } }, include: { items: true, createdBy: { select: { name: true } } } });
}

// ── Who may do what ──────────────────────────────────────────────────────

/** The lab's custodian (write custody of the lab row) or the admin. A department head
 *  never edits a version — only custodians change resources. */
async function canEditLab(actorId: string, labItemId: string): Promise<boolean> {
  try {
    await scope.assertCanMutate(actorId, [labItemId]);
    return true;
  } catch {
    return false;
  }
}

async function assertCanEditLab(actorId: string, labItemId: string): Promise<void> {
  if (!(await canEditLab(actorId, labItemId))) {
    throw new HttpError(403, "Only this lab's custodian changes its resources — the department head approves them.");
  }
}

async function currentHeadOf(ownerOrgNodeId: string): Promise<{ id: string; name: string } | null> {
  const node = await prisma.orgNode.findUnique({ where: { id: ownerOrgNodeId }, select: { user: { select: { id: true, name: true } } } });
  return node?.user ?? null;
}

// ── Copying a lab into a version ─────────────────────────────────────────

function newRowId(): string {
  return `v${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

/** A new version as a copy of `from` — the live tree (linked to its items) or another
 *  version's rows (keeping their links). */
async function createVersion(tx: Tx, labItemId: string, kind: LabVersionKind, actorId: string, from: { live: PrismaItem[] } | { rows: VItem[]; baseVersions: Record<string, number> }): Promise<string> {
  const idMap = new Map<string, string>();
  let rows: Array<Omit<VItem, "id" | "parentId"> & { oldId: string; oldParentId: string | null }>;
  let baseVersions: Record<string, number>;
  if ("live" in from) {
    rows = from.live.map((l) => ({ ...toLive(l), oldId: l.id, oldParentId: l.parentId, sourceItemId: l.id, critical: l.critical }));
    baseVersions = Object.fromEntries(from.live.map((l) => [l.id, l.version]));
  } else {
    rows = from.rows.map((r) => ({ ...r, oldId: r.id, oldParentId: r.parentId }));
    baseVersions = from.baseVersions;
  }
  for (const r of rows) idMap.set(r.oldId, newRowId());
  const version = await tx.labVersion.create({ data: { labItemId, kind, createdById: actorId, baseVersions: baseVersions as Prisma.InputJsonValue } });
  await tx.versionItem.createMany({
    data: rows.map((r) => ({
      id: idMap.get(r.oldId)!,
      versionId: version.id,
      parentId: r.oldParentId ? (idMap.get(r.oldParentId) ?? null) : null,
      sourceItemId: r.sourceItemId,
      categoryId: r.categoryId,
      name: r.name,
      qty: new Prisma.Decimal(r.qty),
      status: r.status,
      critical: r.critical,
      props: r.props as Prisma.InputJsonValue,
      customProps: r.customProps as unknown as Prisma.InputJsonValue,
    })),
  });
  return version.id;
}

/** The editable version of this kind — created on first edit (Draft from Current;
 *  a proposal from the approved Ideal, or from Current when there is none yet). */
async function ensureEditable(tx: Tx, labItemId: string, kind: KindArg, actorId: string): Promise<LabVersion & { items: VersionItem[] }> {
  const existing = await tx.labVersion.findUnique({ where: { labItemId_kind: { labItemId, kind } }, include: { items: true } });
  if (existing) {
    if (existing.status === "SUBMITTED") {
      throw new HttpError(409, `This lab's ${kind === "DRAFT" ? "draft" : "ideal proposal"} is waiting for the department head — withdraw it to keep editing.`);
    }
    return existing;
  }
  if (kind === "IDEAL_PROPOSAL") {
    const ideal = await tx.labVersion.findUnique({ where: { labItemId_kind: { labItemId, kind: "IDEAL" } }, include: { items: true } });
    if (ideal) {
      await createVersion(tx, labItemId, kind, actorId, { rows: ideal.items.map(toVItem), baseVersions: ideal.baseVersions as Record<string, number> });
      return (await tx.labVersion.findUniqueOrThrow({ where: { labItemId_kind: { labItemId, kind } }, include: { items: true } }));
    }
  }
  await createVersion(tx, labItemId, kind, actorId, { live: await loadLive(labItemId, tx) });
  return tx.labVersion.findUniqueOrThrow({ where: { labItemId_kind: { labItemId, kind } }, include: { items: true } });
}

// ── Editing ──────────────────────────────────────────────────────────────

/**
 * One edit to the lab's Draft or Ideal proposal. Ids may be the version's own rows or
 * real item ids (from the register), which map to the rows copied from them. A dry
 * run validates and reports the names it would give, then rolls back.
 */
export async function applyVersionEdit(
  actorId: string,
  labItemId: string,
  kind: KindArg,
  op: VersionOpInput,
  opts?: { dryRun?: boolean },
): Promise<{ touched: string[]; plannedNames?: string[] }> {
  await loadLab(labItemId);
  await assertCanEditLab(actorId, labItemId);
  let result: { touched: string[]; plannedNames?: string[] } = { touched: [] };
  const ROLLBACK = Symbol("dry-run");
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`labversion:${labItemId}:${kind}`}))`;
      const version = await ensureEditable(tx, labItemId, kind, actorId);
      const before = version.items.map(toVItem);
      const bySource = new Map(before.filter((v) => v.sourceItemId).map((v) => [v.sourceItemId!, v.id]));
      const own = new Set(before.map((v) => v.id));
      const mapId = (id: string) => {
        if (own.has(id)) return id;
        const mapped = bySource.get(id);
        if (!mapped) throw new HttpError(400, "That item isn't part of this lab's copy — it may have been added after the copy was made. Refresh the draft from Current first.");
        return mapped;
      };
      const mapped: VersionOp =
        op.kind === "createItem"
          ? { ...op, parentId: mapId(op.parentId) }
          : op.kind === "moveInTree"
            ? { ...op, itemIds: op.itemIds.map(mapId), value: mapId(op.value) }
            : ({ ...op, itemIds: op.itemIds.map(mapId) } as VersionOp);

      let after: VItem[];
      let touched: string[];
      try {
        ({ items: after, touched } = applyVersionOp(before, mapped, { categories: await loadCategories(tx), newId: newRowId }));
      } catch (err) {
        if (err instanceof VersionOpError) throw new HttpError(400, err.message);
        throw err;
      }
      await persistRows(tx, version.id, before, after);
      await tx.labVersion.update({ where: { id: version.id }, data: { updatedAt: new Date() } });
      const byId = new Map(after.map((a) => [a.id, a]));
      result = { touched, ...(op.kind === "createItem" ? { plannedNames: touched.map((id) => byId.get(id)!.name) } : {}) };
      if (opts?.dryRun) throw ROLLBACK;
    });
  } catch (err) {
    if (err !== ROLLBACK) throw err;
  }
  return result;
}

async function persistRows(tx: Tx, versionId: string, before: VItem[], after: VItem[]): Promise<void> {
  const beforeById = new Map(before.map((b) => [b.id, b]));
  const afterIds = new Set(after.map((a) => a.id));
  const removed = before.filter((b) => !afterIds.has(b.id)).map((b) => b.id);
  if (removed.length) await tx.versionItem.deleteMany({ where: { id: { in: removed } } });
  const added = after.filter((a) => !beforeById.has(a.id));
  if (added.length) {
    await tx.versionItem.createMany({
      data: added.map((a) => ({
        id: a.id,
        versionId,
        parentId: a.parentId,
        sourceItemId: a.sourceItemId,
        categoryId: a.categoryId,
        name: a.name,
        qty: new Prisma.Decimal(a.qty),
        status: a.status,
        critical: a.critical,
        props: a.props as Prisma.InputJsonValue,
        customProps: a.customProps as unknown as Prisma.InputJsonValue,
      })),
    });
  }
  for (const a of after) {
    const b = beforeById.get(a.id);
    if (!b || JSON.stringify(a) === JSON.stringify(b)) continue;
    await tx.versionItem.update({
      where: { id: a.id },
      data: {
        parentId: a.parentId,
        name: a.name,
        qty: new Prisma.Decimal(a.qty),
        status: a.status,
        critical: a.critical,
        props: a.props as Prisma.InputJsonValue,
        customProps: a.customProps as unknown as Prisma.InputJsonValue,
      },
    });
  }
}

/** Opens the Draft (a copy of Current) or an Ideal proposal (a copy of the approved
 *  Ideal, or of Current) ready to edit — what the first edit would do anyway. */
export async function startVersion(actorId: string, labItemId: string, kind: KindArg): Promise<void> {
  await loadLab(labItemId);
  await assertCanEditLab(actorId, labItemId);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`labversion:${labItemId}:${kind}`}))`;
    await ensureEditable(tx, labItemId, kind, actorId);
  });
}

/** Throws away an unsubmitted Draft or proposal. */
export async function discardVersion(actorId: string, labItemId: string, kind: KindArg): Promise<void> {
  await assertCanEditLab(actorId, labItemId);
  const v = await loadVersion(labItemId, kind);
  if (!v) return;
  if (v.status === "SUBMITTED") throw new HttpError(409, "It's waiting for the department head — withdraw it first.");
  await prisma.labVersion.delete({ where: { id: v.id } });
}

/** Re-copies the Draft from Current, keeping nothing — for after the register changed
 *  underneath it (a stale merge). */
export async function refreshDraft(actorId: string, labItemId: string): Promise<void> {
  await assertCanEditLab(actorId, labItemId);
  await prisma.$transaction(async (tx) => {
    const v = await tx.labVersion.findUnique({ where: { labItemId_kind: { labItemId, kind: "DRAFT" } } });
    if (v?.status === "SUBMITTED") throw new HttpError(409, "It's waiting for the department head — withdraw it first.");
    if (v) await tx.labVersion.delete({ where: { id: v.id } });
    await createVersion(tx, labItemId, "DRAFT", actorId, { live: await loadLive(labItemId, tx) });
  });
}

// ── Diffs ────────────────────────────────────────────────────────────────

async function diffFor(version: { items: VersionItem[]; baseVersions: Prisma.JsonValue }, live: PrismaItem[], categories: Record<string, Category>): Promise<DiffEntryDto[]> {
  const base = Object.keys((version.baseVersions ?? {}) as Record<string, number>);
  return diffVersion(version.items.map(toVItem), live.map(toLive), base, {
    categoryName: (id) => categories[id]?.name ?? id,
    fieldLabel: (categoryId, key) => categories[categoryId]?.fields.find((f) => f.key === key)?.label ?? key,
  });
}

const summaryOf = (diff: DiffEntryDto[]) => diff.map((d) => ({ kind: d.kind, name: d.name, lines: d.lines }));

// ── Submitting and deciding ──────────────────────────────────────────────

export async function submitVersion(actorId: string, labItemId: string, kind: KindArg): Promise<LabCommitRequestDto> {
  const lab = await loadLab(labItemId);
  await assertCanEditLab(actorId, labItemId);
  const v = await loadVersion(labItemId, kind);
  if (!v) throw new HttpError(400, "There is nothing to submit yet.");
  if (v.status === "SUBMITTED") throw new HttpError(409, "Already waiting for the department head.");
  const [live, categories] = await Promise.all([loadLive(labItemId), loadCategories()]);
  const diff = await diffFor(v, live, categories);
  if (kind === "DRAFT" && !diff.length) throw new HttpError(400, "The draft doesn't change anything yet.");
  const request = await prisma.$transaction(async (tx) => {
    await tx.labVersion.update({ where: { id: v.id }, data: { status: "SUBMITTED", rejectionNote: null } });
    return tx.labCommitRequest.create({
      data: { labItemId, targetKind: kind === "DRAFT" ? "VISIBLE" : "IDEAL", requesterId: actorId, versionId: v.id, summary: summaryOf(diff) as Prisma.InputJsonValue },
    });
  });
  return getRequest(actorId, request.id, lab.ownerOrgNodeId);
}

/** The custodian takes a submitted version back to keep editing. */
export async function withdrawVersion(actorId: string, labItemId: string, kind: KindArg): Promise<void> {
  await assertCanEditLab(actorId, labItemId);
  const v = await loadVersion(labItemId, kind);
  if (!v || v.status !== "SUBMITTED") throw new HttpError(409, "Nothing is waiting to be withdrawn.");
  await prisma.$transaction([
    prisma.labVersion.update({ where: { id: v.id }, data: { status: "EDITING" } }),
    prisma.labCommitRequest.updateMany({ where: { versionId: v.id, status: "PENDING" }, data: { status: "CANCELLED", resolution: "Withdrawn by the custodian" } }),
  ]);
}

/**
 * The department head's decision. A vacant headship BLOCKS (nobody may decide).
 * APPROVE on a Draft merges it into the live register as the custodian (who made
 * it), refusing — STALE, naming what changed — anything touched since the copy was
 * taken; APPROVE on a proposal makes it the lab's Ideal. REJECT returns it to the
 * custodian with the reason.
 */
export async function decideCommit(actorId: string, requestId: string, decision: "APPROVE" | "REJECT", note?: string): Promise<LabCommitRequestDto> {
  const request = await prisma.labCommitRequest.findUnique({ where: { id: requestId }, include: { lab: { select: { ownerOrgNodeId: true } } } });
  if (!request) throw new HttpError(404, "Request not found");
  if (request.status !== "PENDING") throw new HttpError(409, "This request has already been decided.");
  const head = await currentHeadOf(request.lab.ownerOrgNodeId);
  if (!head || head.id !== actorId) throw new HttpError(403, "You are not this lab's department head — you may not decide this request.");
  const version = request.versionId ? await prisma.labVersion.findUnique({ where: { id: request.versionId }, include: { items: true } }) : null;
  if (!version) throw new HttpError(409, "The version this request covers no longer exists.");

  const decided = { decidedById: actorId, decidedAt: new Date() };
  if (decision === "REJECT") {
    await prisma.$transaction([
      prisma.labCommitRequest.update({ where: { id: requestId }, data: { status: "REJECTED", ...decided, resolution: note ?? null } }),
      prisma.labVersion.update({ where: { id: version.id }, data: { status: "EDITING", rejectionNote: note?.trim() || "Sent back by the department head." } }),
    ]);
    return getRequest(actorId, requestId);
  }

  if (version.kind === "IDEAL_PROPOSAL") {
    await prisma.$transaction(async (tx) => {
      await tx.labVersion.deleteMany({ where: { labItemId: request.labItemId, kind: "IDEAL" } });
      await tx.labVersion.update({ where: { id: version.id }, data: { kind: "IDEAL", status: "APPROVED", rejectionNote: null } });
      await tx.labCommitRequest.update({ where: { id: requestId }, data: { status: "APPLIED", ...decided, resolution: note ?? null } });
    });
    return getRequest(actorId, requestId);
  }

  // DRAFT → merge.
  const stale = async (message: string) => {
    await prisma.$transaction([
      prisma.labCommitRequest.update({ where: { id: requestId }, data: { status: "STALE", ...decided, resolution: message } }),
      prisma.labVersion.update({ where: { id: version.id }, data: { status: "EDITING", rejectionNote: `Couldn't be applied: ${message} Refresh the draft from Current and redo the change.` } }),
    ]);
    return getRequest(actorId, requestId);
  };

  const cleanupKeys: string[] = [];
  try {
    await prisma.$transaction(
      async (tx) => {
        const live = await loadLive(request.labItemId, tx);
        const categories = await loadCategories(tx);
        const diff = await diffFor(version, live, categories);
        const liveById = new Map(live.map((l) => [l.id, l]));
        const base = version.baseVersions as Record<string, number>;

        // Staleness: every real item this merge writes must be as it was when copied.
        const touchedReal = new Set<string>();
        for (const d of diff) {
          if (d.sourceItemId) touchedReal.add(d.sourceItemId);
          if (d.kind === "added" && d.markerItemId) touchedReal.add(d.markerItemId);
        }
        const locked = touchedReal.size
          ? await tx.$queryRaw<{ id: string; name: string; version: number }[]>`SELECT id, name, version FROM "Item" WHERE id = ANY(${[...touchedReal]}) AND "deletedAt" IS NULL FOR UPDATE`
          : [];
        const lockedById = new Map(locked.map((l) => [l.id, l]));
        const changed = [...touchedReal].filter((id) => !lockedById.has(id) || (base[id] !== undefined && lockedById.get(id)!.version !== base[id]));
        if (changed.length) {
          const names = changed.map((id) => (lockedById.get(id) ? `"${lockedById.get(id)!.name}"` : "an item that no longer exists"));
          throw new HttpError(409, `Changed in the register since this draft was copied: ${names.join(", ")}.`);
        }

        await mergeDraft(tx, request.requesterId, version.items.map(toVItem), diff, liveById, cleanupKeys);
        await tx.labVersion.delete({ where: { id: version.id } });
        await tx.labCommitRequest.update({ where: { id: requestId }, data: { status: "APPLIED", versionId: null, ...decided, resolution: note ?? null } });
      },
      { timeout: 60_000 },
    );
  } catch (err) {
    return stale(err instanceof HttpError ? err.message : "one or more changes no longer apply.");
  }
  for (const key of cleanupKeys) await storage.remove(key).catch(() => undefined);
  return getRequest(actorId, requestId);
}

/** Applies a Draft's difference through the write door, inside the caller's
 *  transaction: additions first (exact names, parts included), then field changes
 *  and moves, then removals. */
async function mergeDraft(tx: Tx, authorId: string, rows: VItem[], diff: DiffEntryDto[], liveById: Map<string, PrismaItem>, cleanupKeys: string[]): Promise<void> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const realOf = new Map<string, string>(); // version row id → real item id (linked or just created)
  for (const r of rows) if (r.sourceItemId && liveById.has(r.sourceItemId)) realOf.set(r.id, r.sourceItemId);
  const apply = (input: ItemChangeInput) => applyChange(authorId, input, { bypassDraftWorkflowBlock: true, tx, cleanupKeys });

  for (const d of diff.filter((x) => x.kind === "added")) {
    const top = byId.get(d.versionItemId!)!;
    const parentReal = top.parentId ? realOf.get(top.parentId) : undefined;
    if (!parentReal) throw new HttpError(409, `The place "${top.name}" was added to no longer exists.`);
    const subtree: VItem[] = [];
    const stack = [top.id];
    while (stack.length) {
      const id = stack.pop()!;
      subtree.push(byId.get(id)!);
      for (const r of rows) if (r.parentId === id) stack.push(r.id);
    }
    const created = await createExactItems(tx, authorId, parentReal, subtree);
    for (const [rowId, realId] of created) realOf.set(rowId, realId);
  }

  for (const d of diff.filter((x) => x.kind === "changed")) {
    const v = byId.get(d.versionItemId!)!;
    const l = liveById.get(d.sourceItemId!)!;
    const ids = [l.id];
    if (v.name !== l.name) await apply({ kind: "setName", itemIds: ids, value: v.name });
    if (v.status !== l.status) await apply({ kind: "setStatus", itemIds: ids, value: v.status });
    if (Number(v.qty) !== Number(l.qty)) await apply({ kind: "setQuantity", itemIds: ids, value: v.qty });
    const lp = asProps(l.props);
    for (const key of new Set([...Object.keys(v.props), ...Object.keys(lp)])) {
      if ((v.props[key] ?? null) !== (lp[key] ?? null)) await apply({ kind: "setProperty", itemIds: ids, propKey: key, value: v.props[key] ?? null });
    }
    const lc = asCustom(l.customProps);
    for (const key of new Set([...Object.keys(v.customProps), ...Object.keys(lc)])) {
      const after = v.customProps[key];
      const before = lc[key];
      if (!after && before) await apply({ kind: "removeCustomProperty", itemIds: ids, key });
      else if (after && !before) await apply({ kind: "addCustomProperty", itemIds: ids, key, type: after.type, value: after.value });
      else if (after && before && after.value !== before.value) await apply({ kind: "setCustomProperty", itemIds: ids, key, value: after.value });
    }
    const newParent = v.parentId ? realOf.get(v.parentId) : null;
    if (newParent && newParent !== l.parentId) await apply({ kind: "moveInTree", itemIds: ids, value: newParent });
  }

  const removed = diff.filter((x) => x.kind === "removed").map((x) => x.sourceItemId!);
  if (removed.length) await apply({ kind: "deleteItem", itemIds: removed });
}

// ── From the register: auto-staging when a department uses drafts ───────

const OP_KINDS = new Set(["createItem", "setName", "setStatus", "setQuantity", "setProperty", "addCustomProperty", "setCustomProperty", "removeCustomProperty", "deleteItem", "moveInTree"]);

/**
 * Called by the write door before a direct edit. When every item the edit touches is
 * owned by a department with drafts turned on (and the actor isn't the admin), the
 * edit goes into that lab's Draft instead of the register and this returns the
 * "staged" result; otherwise it returns null and the edit applies directly.
 */
export async function stageFromRegister(actorId: string, input: ItemChangeInput, opts?: { dryRun?: boolean }): Promise<ItemChangeResultDto | null> {
  if (input.kind === "transferItem" || input.kind === "addImage" || input.kind === "removeImage") return null;
  if (input.kind === "createItem" && !input.parentId) return null; // a brand-new lab is nobody's draft
  const targets =
    input.kind === "createItem" ? [input.parentId!] : input.kind === "moveInTree" ? [...input.itemIds, ...(input.value ? [input.value] : [])] : input.itemIds;
  if (!targets.length) return null;
  const rows = await prisma.item.findMany({ where: { id: { in: targets } }, select: { ownerOrgNodeId: true } });
  const owners = await prisma.orgNode.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.ownerOrgNodeId))] } }, select: { name: true, draftWorkflowEnabled: true } });
  const drafting = owners.find((o) => o.draftWorkflowEnabled);
  if (!drafting) return null;
  if (await scope.isSysAdmin(actorId)) return null; // the admin's corrections stay direct

  if (!OP_KINDS.has(input.kind) || (input.kind === "moveInTree" && !input.value)) {
    throw new HttpError(403, `${drafting.name} uses draft mode — custody, ownership and moves out of a lab go through a transfer, not a draft.`);
  }
  const labs = await prisma.$queryRaw<{ start: string; root: string }[]>`
    WITH RECURSIVE up AS (
      SELECT id AS start, id, "parentId" FROM "Item" WHERE id = ANY(${targets})
      UNION ALL
      SELECT up.start, i.id, i."parentId" FROM "Item" i INNER JOIN up ON i.id = up."parentId"
    )
    SELECT start, id AS root FROM up WHERE "parentId" IS NULL
  `;
  const labIds = [...new Set(labs.map((l) => l.root))];
  if (labIds.length !== 1) throw new HttpError(400, "A draft covers one lab at a time — change one lab's items at a time.");
  const labItemId = labIds[0];

  const { expectedVersions: _ignored, note: _note, ...rest } = input as ItemChangeInput & { expectedVersions?: unknown; note?: unknown };
  void _ignored;
  void _note;
  const op = rest as unknown as VersionOpInput;
  const res = await applyVersionEdit(actorId, labItemId, "DRAFT", op, opts);
  const lab = await prisma.item.findUniqueOrThrow({ where: { id: labItemId }, select: { name: true } });
  return { applied: 0, itemIds: [], staged: { labItemId, labName: lab.name }, ...(res.plannedNames ? { plannedNames: res.plannedNames } : {}) };
}

/** Register markers: which real items a pending Draft would change, and how. */
export async function pendingMarkers(actorId: string): Promise<PendingMarkersDto> {
  const drafts = await prisma.labVersion.findMany({ where: { kind: "DRAFT" }, include: { items: true } });
  if (!drafts.length) return {};
  const categories = await loadCategories();
  const out: PendingMarkersDto = {};
  for (const d of drafts) {
    if (!(await scope.canSeeItem(actorId, d.labItemId))) continue;
    const diff = await diffFor(d, await loadLive(d.labItemId), categories);
    for (const e of diff) {
      if (!e.markerItemId) continue;
      const lines = e.kind === "added" ? [`+ ${e.name} (new)`] : e.kind === "removed" ? [`${e.name}: removed`] : e.lines;
      const cur = out[e.markerItemId] ?? { labItemId: d.labItemId, lines: [] };
      cur.lines.push(...lines);
      out[e.markerItemId] = cur;
    }
  }
  return out;
}

// ── Reading: the Lab states page ─────────────────────────────────────────

function effectiveStatuses(nodes: Array<{ id: string; parentId: string | null; categoryId: string; name: string; qty: number; status: DomainItem["status"]; critical: boolean; props: Record<string, string | number | boolean | null> }>, categories: Record<string, Category>) {
  const items: DomainItem[] = nodes.map((n) => ({
    ...n,
    images: [],
    ownerOrgNodeId: "-",
    currentOrgNodeId: "-",
    custodianId: "-",
    version: 1,
    createdAt: "",
    updatedAt: "",
  }));
  return computeStatuses(items, categories);
}

function treeNodes(rows: Array<VItem & { critical: boolean }>, categories: Record<string, Category>): LabTreeNodeDto[] {
  const statuses = effectiveStatuses(rows, categories);
  return rows.map((r) => ({
    id: r.id,
    parentId: r.parentId,
    sourceItemId: r.sourceItemId,
    categoryId: r.categoryId,
    categoryName: categories[r.categoryId]?.name ?? r.categoryId,
    categoryIconKey: categories[r.categoryId]?.iconKey ?? "Package",
    name: r.name,
    qty: r.qty,
    status: r.status,
    effectiveStatus: statusOf(statuses, r.id),
    critical: r.critical,
    props: r.props,
    customProps: r.customProps,
  }));
}

function statRows(ideal: VItem[], live: PrismaItem[], labItemId: string, categories: Record<string, Category>): IdealStatRowDto[] {
  const liveNodes = live.map((l) => ({ ...toLive(l), sourceItemId: l.id, critical: l.critical }));
  const statuses = effectiveStatuses(liveNodes, categories);
  const attention = new Map<string, number>();
  for (const l of live) {
    if (l.id === labItemId) continue;
    if (NEEDS_ATTENTION.includes(statusOf(statuses, l.id))) attention.set(l.categoryId, (attention.get(l.categoryId) ?? 0) + 1);
  }
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return idealStats(ideal, live.map(toLive), labItemId)
    .map((r) => ({
      ...r,
      categoryName: categories[r.categoryId]?.name ?? r.categoryId,
      categoryIconKey: categories[r.categoryId]?.iconKey ?? "Package",
      needsAttention: attention.get(r.categoryId) ?? 0,
    }))
    .sort((a, b) => b.gap - a.gap || collator.compare(a.categoryName, b.categoryName));
}

async function versionDto(v: Awaited<ReturnType<typeof loadVersion>>, live: PrismaItem[], categories: Record<string, Category>): Promise<LabVersionDto | null> {
  if (!v) return null;
  return {
    id: v.id,
    kind: v.kind,
    status: v.status,
    rejectionNote: v.rejectionNote,
    createdByName: v.createdBy.name,
    updatedAt: v.updatedAt.toISOString(),
    nodes: treeNodes(v.items.map(toVItem), categories),
    diff: await diffFor(v, live, categories),
  };
}

export async function getLabStates(actorId: string, labItemId: string): Promise<LabStatesDto> {
  const lab = await loadLab(labItemId);
  await scope.assertMaySeeLabAggregate(actorId, labItemId);
  const [live, categories, draft, ideal, proposal, head] = await Promise.all([
    loadLive(labItemId),
    loadCategories(),
    loadVersion(labItemId, "DRAFT"),
    loadVersion(labItemId, "IDEAL"),
    loadVersion(labItemId, "IDEAL_PROPOSAL"),
    currentHeadOf(lab.ownerOrgNodeId),
  ]);
  const commits = await prisma.labCommitRequest.findMany({ where: { labItemId }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true } });
  return {
    lab: {
      id: lab.id,
      name: lab.name,
      ownerOrgNodeId: lab.ownerOrgNodeId,
      ownerOrgNodeName: lab.ownerOrg.name,
      custodianId: lab.custodianId,
      custodianName: lab.custodian.name,
      headName: head?.name ?? null,
      draftWorkflowEnabled: lab.ownerOrg.draftWorkflowEnabled,
    },
    canEdit: await canEditLab(actorId, labItemId),
    isHead: head?.id === actorId,
    current: treeNodes(live.map((l) => ({ ...toLive(l), sourceItemId: l.id, critical: l.critical })), categories),
    draft: await versionDto(draft, live, categories),
    ideal: await versionDto(ideal, live, categories),
    idealProposal: await versionDto(proposal, live, categories),
    idealStats: ideal ? statRows(ideal.items.map(toVItem), live, labItemId, categories) : [],
    proposalStats: proposal ? statRows(proposal.items.map(toVItem), live, labItemId, categories) : [],
    commits: await Promise.all(commits.map((c) => getRequest(actorId, c.id, lab.ownerOrgNodeId))),
  };
}

/** Every lab the caller answers for: the admin sees all; a custodian their own; a
 *  head (or dean) every lab their unit(s) own. */
export async function listLabs(actorId: string): Promise<LabSummaryDto[]> {
  const where: Prisma.ItemWhereInput = { parentId: null, deletedAt: null };
  if (!(await scope.isSysAdmin(actorId))) {
    const headed = await orgScope.headNodeIdsOf(actorId);
    const units = headed.length ? await orgScope.visibleNodeIds(actorId) : [];
    where.OR = [{ custodianId: actorId }, ...(units.length ? [{ ownerOrgNodeId: { in: units } }] : [])];
  }
  const labs = await prisma.item.findMany({
    where,
    include: {
      ownerOrg: { select: { name: true } },
      custodian: { select: { name: true } },
      category: { select: { iconKey: true } },
      labVersions: { select: { kind: true, status: true } },
      labCommitRequests: { where: { status: "PENDING" }, select: { id: true } },
    },
  });
  const drafts = await prisma.labVersion.findMany({ where: { kind: "DRAFT", labItemId: { in: labs.map((l) => l.id) } }, include: { items: true } });
  const categories = drafts.length ? await loadCategories() : {};
  const draftChanges = new Map<string, number>();
  for (const d of drafts) draftChanges.set(d.labItemId, (await diffFor(d, await loadLive(d.labItemId), categories)).length);
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return labs
    .map((l) => ({
      id: l.id,
      name: l.name,
      categoryIconKey: l.category.iconKey,
      ownerOrgNodeId: l.ownerOrgNodeId,
      ownerOrgNodeName: l.ownerOrg.name,
      custodianName: l.custodian.name,
      draft: l.labVersions.find((v) => v.kind === "DRAFT")?.status ?? null,
      draftChanges: draftChanges.get(l.id) ?? 0,
      hasIdeal: l.labVersions.some((v) => v.kind === "IDEAL"),
      proposal: l.labVersions.find((v) => v.kind === "IDEAL_PROPOSAL")?.status ?? null,
      pendingCommits: l.labCommitRequests.length,
    }))
    .sort((a, b) => collator.compare(a.ownerOrgNodeName, b.ownerOrgNodeName) || collator.compare(a.name, b.name));
}

// ── Requests ─────────────────────────────────────────────────────────────

export async function getRequest(actorId: string, requestId: string, knownOwner?: string): Promise<LabCommitRequestDto> {
  const r = await prisma.labCommitRequest.findUnique({
    where: { id: requestId },
    include: { requester: { select: { name: true } }, decidedBy: { select: { name: true } }, lab: { select: { name: true, ownerOrgNodeId: true } } },
  });
  if (!r) throw new HttpError(404, "Request not found");
  const head = await currentHeadOf(knownOwner ?? r.lab.ownerOrgNodeId);
  if (!knownOwner) {
    const allowed = actorId === r.requesterId || actorId === head?.id || (await scope.isSysAdmin(actorId)) || (await scope.canSeeItem(actorId, r.labItemId));
    if (!allowed) throw new HttpError(404, "Resource not found");
  }
  return {
    id: r.id,
    labItemId: r.labItemId,
    labName: r.lab.name,
    targetKind: r.targetKind,
    requesterId: r.requesterId,
    requesterName: r.requester.name,
    versionId: r.versionId,
    status: r.status,
    summary: (Array.isArray(r.summary) ? r.summary : []) as LabCommitRequestDto["summary"],
    note: r.note,
    decidedById: r.decidedById,
    decidedByName: r.decidedBy?.name ?? null,
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    resolution: r.resolution,
    createdAt: r.createdAt.toISOString(),
    canDecide: r.status === "PENDING" && head?.id === actorId,
  };
}

/** `inbox` — pending requests the caller decides now (as the live head); `mine` —
 *  requests the caller raised. */
export async function listForActor(actorId: string, box: "inbox" | "mine"): Promise<LabCommitRequestDto[]> {
  if (box === "mine") {
    const rows = await prisma.labCommitRequest.findMany({ where: { requesterId: actorId }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true } });
    return Promise.all(rows.map((r) => getRequest(actorId, r.id)));
  }
  const headed = await prisma.orgNode.findMany({ where: { userId: actorId }, select: { id: true } });
  if (!headed.length) return [];
  const rows = await prisma.labCommitRequest.findMany({
    where: { status: "PENDING", lab: { ownerOrgNodeId: { in: headed.map((n) => n.id) } } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return Promise.all(rows.map((r) => getRequest(actorId, r.id)));
}

// ── Purchasing: Ideal vs Current ─────────────────────────────────────────

async function idealSheetRows(labItemId: string, categories: Record<string, Category>): Promise<IdealVsActualRowDto[]> {
  const ideal = await loadVersion(labItemId, "IDEAL");
  if (!ideal) return [];
  const live = await loadLive(labItemId);
  const liveNodes = live.map((l) => ({ ...toLive(l), sourceItemId: l.id, critical: l.critical }));
  const statuses = effectiveStatuses(liveNodes, categories);
  return idealStats(ideal.items.map(toVItem), live.map(toLive), labItemId).map((r) => ({
    categoryId: r.categoryId,
    categoryName: categories[r.categoryId]?.name ?? r.categoryId,
    idealQty: r.idealCount,
    actualCount: r.currentCount,
    gap: r.gap,
    brokenItems: live
      .filter((l) => l.id !== labItemId && l.categoryId === r.categoryId && NEEDS_ATTENTION.includes(statusOf(statuses, l.id)))
      .map((l) => ({ id: l.id, name: l.name, status: statusOf(statuses, l.id) })),
  }));
}

export async function getIdealVsActual(actorId: string, labItemId: string): Promise<IdealVsActualRowDto[]> {
  await scope.assertMaySeeLabAggregate(actorId, labItemId);
  return idealSheetRows(labItemId, await loadCategories());
}

/**
 * What a department could buy to bring every one of its labs to its approved Ideal —
 * each lab it OWNS that has an approved Ideal, rolled up by
 * lib/domain/purchasables.ts. Readable by the department's live head or the admin.
 */
export async function getDepartmentPurchasables(actorId: string, orgNodeId: string): Promise<DepartmentPurchasablesDto> {
  const node = await prisma.orgNode.findUnique({ where: { id: orgNodeId }, select: { id: true, name: true } });
  if (!node) throw new HttpError(404, "Org node not found");
  if (!(await scope.isSysAdmin(actorId))) {
    const head = await currentHeadOf(orgNodeId);
    if (head?.id !== actorId) throw new HttpError(403, "Only this unit's head may compute its purchasables.");
  }
  const labs = await prisma.item.findMany({
    where: { ownerOrgNodeId: orgNodeId, deletedAt: null, parentId: null, labVersions: { some: { kind: "IDEAL" } } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const categories = await loadCategories();
  const sheets: LabIdealSheet[] = [];
  for (const lab of labs) sheets.push({ labItemId: lab.id, labName: lab.name, rows: await idealSheetRows(lab.id, categories) });
  return { orgNodeId: node.id, orgNodeName: node.name, labCount: labs.length, rows: aggregatePurchasables(sheets) };
}

/** Admin-only: turns a department's draft workflow on or off. Already-open drafts are
 *  untouched either way; only where NEW register edits go changes. */
export async function setDraftWorkflowEnabled(orgNodeId: string, enabled: boolean): Promise<void> {
  const node = await prisma.orgNode.findUnique({ where: { id: orgNodeId }, select: { id: true } });
  if (!node) throw new HttpError(404, "Org node not found");
  await prisma.orgNode.update({ where: { id: orgNodeId }, data: { draftWorkflowEnabled: enabled } });
}
