import "server-only";
import type { Prisma } from "@prisma/client";
import type { CategoryChangeDto, CategoryChangesDto, CategoryEditDecisionDto, CategoryImpactDto, CreateCategoryInput, DecideCategoryChangeInput, ResourceCategoryDto, SaveCategoryResultDto, UpdateCategoryInput } from "@/lib/shared";
import { classifyEdit, nextStage, routeEdit, type ChangeStage } from "@/lib/domain/category-governance";
import { prisma } from "../prisma";
import { HttpError } from "../http-error";
import { capabilitiesOf } from "../auth/capabilities";
import { esc, notify, quoted, usersWithRole } from "../mail/notify";
import * as categories from "./categories";
import { paths } from "@/lib/paths";

/**
 * Who may add and change categories, and when a change waits for approval
 * (lib/domain/category-governance.ts has the rules; this gathers the facts).
 *
 *  - Custodians and heads add categories for their department — it looks after them
 *    (the steward). The admin and Property Administration add university-wide ones.
 *  - An edit that only adds applies at once, and the steward's head is told.
 *  - An edit that changes data waits for the proposer's head; one reaching other
 *    departments' items then passes the admin and Property Administration.
 */

interface Editor {
  userId: string;
  name: string;
  /** SYS_ADMIN or PROPERTY_ADMIN — the end of every chain. */
  isTop: boolean;
  /** The department (or the college, for an ADAA or dean) the person acts for. */
  unitId: string | null;
  unitName: string | null;
  /** Heads that unit (occupies it, or is its ADAA). */
  headsUnit: boolean;
  canEdit: boolean;
}

/** The department a node sits in — itself, its nearest department above, else its
 *  nearest college, else the node itself. */
async function unitOf(nodeId: string): Promise<string> {
  const self = await prisma.orgNode.findUnique({ where: { id: nodeId }, select: { kind: true } });
  if (self?.kind === "DEPARTMENT" || self?.kind === "COLLEGE") return nodeId;
  const up = await prisma.orgClosure.findMany({
    where: { descendantId: nodeId, depth: { gt: 0 }, ancestor: { kind: { in: ["DEPARTMENT", "COLLEGE"] }, active: true } },
    select: { ancestorId: true, depth: true, ancestor: { select: { kind: true } } },
    orderBy: { depth: "asc" },
  });
  return (up.find((u) => u.ancestor.kind === "DEPARTMENT") ?? up[0])?.ancestorId ?? nodeId;
}

async function editorOf(userId: string): Promise<Editor> {
  const [caps, user] = await Promise.all([capabilitiesOf(userId), prisma.user.findUnique({ where: { id: userId }, select: { name: true, homeNodeId: true } })]);
  const isTop = caps.isAdmin || caps.isPropertyAdmin;
  let unitId: string | null = caps.headOf[0] ?? caps.adaaCollegeId ?? caps.deanOf[0] ?? null;
  const headsUnit = Boolean(unitId);
  if (!unitId && caps.isCustodian && user?.homeNodeId) unitId = await unitOf(user.homeNodeId);
  const unitName = unitId ? ((await prisma.orgNode.findUnique({ where: { id: unitId }, select: { name: true } }))?.name ?? null) : null;
  return { userId, name: user?.name ?? "Someone", isTop, unitId, unitName, headsUnit, canEdit: isTop || headsUnit || (caps.isCustodian && Boolean(unitId)) };
}

function assertCanEdit(editor: Editor): void {
  if (!editor.canEdit) {
    throw new HttpError(403, "Categories are added and changed by custodians and department heads, and by Property Administration. Ask the custodian of your lab.");
  }
}

/** Labs, workshops, studios and stores are the university's own kinds of place: kept by
 *  the admin and Property Administration, whatever a department adds inside them. */
function assertMayTouchPlaces(editor: Editor, isPlace: boolean): void {
  if (isPlace && !editor.isTop) throw new HttpError(403, "Labs, workshops, studios and stores are kept by Property Administration. Ask them for a change to what a place records.");
}

/** May this person add or change categories at all — what the page shows them. */
export async function canEditCategories(userId: string): Promise<boolean> {
  return (await editorOf(userId)).canEdit;
}

/** The units, other than the editor's own (and anything below it), whose items or
 *  stewardship an edit reaches — named by department. */
async function reachesBeyond(editor: Editor, ownerNodeIds: string[], stewardNodeId: string | null): Promise<string[]> {
  if (editor.isTop) return [];
  const ids = [...new Set([...ownerNodeIds, ...(stewardNodeId ? [stewardNodeId] : [])])];
  if (!ids.length) return [];
  const inside = editor.unitId ? new Set((await prisma.orgClosure.findMany({ where: { ancestorId: editor.unitId }, select: { descendantId: true } })).map((r) => r.descendantId)) : new Set<string>();
  const outside = ids.filter((id) => !inside.has(id));
  if (!outside.length) return [];
  const units = [...new Set(await Promise.all(outside.map(unitOf)))];
  const rows = await prisma.orgNode.findMany({ where: { id: { in: units } }, select: { name: true }, orderBy: { name: "asc" } });
  return rows.map((r) => r.name);
}

async function occupantOf(nodeId: string | null): Promise<string | null> {
  if (!nodeId) return null;
  return (await prisma.orgNode.findUnique({ where: { id: nodeId }, select: { userId: true } }))?.userId ?? null;
}

async function admins(): Promise<string[]> {
  return (await prisma.userRole.findMany({ where: { kind: "SYS_ADMIN", user: { status: "ACTIVE" } }, select: { userId: true } })).map((r) => r.userId);
}

async function approverIds(stage: ChangeStage, unitId: string | null): Promise<string[]> {
  if (stage === "HEAD") {
    const head = await occupantOf(unitId);
    return head ? [head] : [];
  }
  return stage === "ADMIN" ? admins() : usersWithRole("PROPERTY_ADMIN");
}

function stageLabel(stage: ChangeStage, unitName: string | null): string {
  if (stage === "HEAD") return unitName ? `the head of ${unitName}` : "the head";
  return stage === "ADMIN" ? "the admin" : "Property Administration";
}

/** A HEAD stage with nobody in the post goes straight on — to the admin when it was the
 *  only stage — so a change never waits on an empty chair. */
async function staffedStages(stages: ChangeStage[], unitId: string | null): Promise<ChangeStage[]> {
  if (stages[0] !== "HEAD" || (await occupantOf(unitId))) return stages;
  const rest = stages.slice(1);
  return rest.length ? rest : ["ADMIN"];
}

/** The steward's side, told when an edit applied without them: the steward
 *  department's head, or Property Administration for university-wide categories —
 *  plus the editor's own head when a custodian made it. */
async function stewardSide(stewardNodeId: string | null, editor: Editor): Promise<string[]> {
  const ids = stewardNodeId ? [await occupantOf(stewardNodeId)] : await usersWithRole("PROPERTY_ADMIN");
  if (!editor.headsUnit && !editor.isTop) ids.push(await occupantOf(editor.unitId));
  return ids.filter((x): x is string => Boolean(x));
}

const categoryPath = paths.category;

// ── Adding ────────────────────────────────────────────────────────────────

export async function createCategory(actorId: string, input: CreateCategoryInput): Promise<ResourceCategoryDto> {
  const editor = await editorOf(actorId);
  assertCanEdit(editor);
  assertMayTouchPlaces(editor, input.isPlace ?? false);
  const created = await categories.create(actorId, input, { stewardNodeId: editor.isTop ? null : editor.unitId });
  if (!editor.isTop) {
    await notify(await stewardSide(created.stewardNodeId, editor), actorId, {
      subject: `${editor.name} added the category ${created.name}`,
      paragraphs: [
        `${esc(editor.name)} added <strong>${esc(created.name)}</strong> for ${esc(created.stewardName)}, with ${created.fields.length} detail${created.fields.length === 1 ? "" : "s"}. It can be used right away.`,
        "Open it to adjust it, or remove it while nothing is filed under it.",
      ],
      path: categoryPath(created.id),
      action: "Open the category",
    });
  }
  return created;
}

/** "Make a copy for my department": the same details and parts, looked after by the
 *  person's own department — the usual answer to wanting a change that would reach
 *  other departments' items. */
export async function copyCategory(actorId: string, id: string): Promise<ResourceCategoryDto> {
  const editor = await editorOf(actorId);
  assertCanEdit(editor);
  const source = await categories.getOne(id);
  const unit = editor.unitId ? await prisma.orgNode.findUnique({ where: { id: editor.unitId }, select: { code: true, name: true } }) : null;
  const suffix = unit?.code ?? unit?.name ?? "copy";
  const taken = new Set((await prisma.resourceCategory.findMany({ where: { name: { startsWith: source.name, mode: "insensitive" } }, select: { name: true } })).map((r) => r.name.toLowerCase()));
  let name = `${source.name} (${suffix})`;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${source.name} (${suffix} ${n})`;
  return createCategory(actorId, {
    name: name.slice(0, 160),
    description: source.description ?? undefined,
    iconKey: source.iconKey,
    groupId: source.groupId,
    countingMode: source.countingMode,
    unit: source.unit ?? undefined,
    impairRule: source.impairRule,
    isPlace: source.isPlace,
    bookingMode: source.bookingMode,
    publicListed: false,
    fields: source.fields.map((f) => ({ key: f.key, label: f.label, type: f.type, options: f.options, unit: f.unit ?? undefined, summary: f.summary, longText: f.longText, required: f.required, sortOrder: f.sortOrder, hint: f.hint })),
    templateChildren: source.templateChildren.map((c) => ({ childCategoryId: c.childCategoryId, qty: c.qty, critical: c.critical })),
  });
}

// ── Changing ──────────────────────────────────────────────────────────────

interface Judged {
  editor: Editor;
  ctx: categories.EditContext;
  reasons: string[];
  reaches: string[];
  route: ReturnType<typeof routeEdit>;
}

async function judge(actorId: string, id: string, draft: categories.EditDraft): Promise<Judged> {
  const editor = await editorOf(actorId);
  assertCanEdit(editor);
  const ctx = await categories.editContext(id, draft);
  assertMayTouchPlaces(editor, Boolean(ctx.before.isPlace || ctx.after.isPlace));
  const { cls, reasons } = classifyEdit(ctx.before, ctx.after, ctx.domainItems, draft.fills ?? {});
  const reaches = cls === "CHANGING" ? await reachesBeyond(editor, ctx.items.map((i) => i.ownerOrgNodeId), ctx.row.stewardNodeId) : [];
  const route = routeEdit(cls, { isTop: editor.isTop, headsOwnUnit: editor.headsUnit }, reaches.length > 0);
  if (route.kind === "PROPOSE") route.stages = await staffedStages(route.stages, editor.unitId);
  return { editor, ctx, reasons, reaches, route };
}

/** What an edit would do, and who decides it — the editor's review step. */
export async function previewEdit(actorId: string, id: string, draft: categories.EditDraft): Promise<CategoryImpactDto> {
  const [impact, judged] = await Promise.all([categories.previewImpact(id, draft), judge(actorId, id, draft)]);
  const decision: CategoryEditDecisionDto = {
    applies: judged.route.kind === "APPLY",
    reasons: judged.reasons,
    approvers: judged.route.kind === "PROPOSE" ? judged.route.stages.map((s) => stageLabel(s, judged.editor.unitName)) : [],
    reaches: judged.reaches,
  };
  return { ...impact, decision };
}

/** Save an edit: it applies, or it waits as a CategoryChange for the first approver. */
export async function saveCategory(actorId: string, id: string, input: categories.UpdateArgs): Promise<SaveCategoryResultDto> {
  const { editor, ctx, reasons, reaches, route } = await judge(actorId, id, input);
  if (ctx.row.version !== input.expectedVersion) {
    throw new HttpError(409, "Version conflict", {
      message: "This category has changed since you loaded it.",
      code: "VERSION_CONFLICT",
      expectedVersion: input.expectedVersion,
      actualVersion: ctx.row.version,
    });
  }

  if (route.kind === "APPLY") {
    const category = await categories.update(actorId, id, input);
    if (!editor.isTop || ctx.row.stewardNodeId) {
      const steward = await stewardSide(ctx.row.stewardNodeId, editor);
      await notify(steward, actorId, {
        subject: `${editor.name} changed the category ${category.name}`,
        paragraphs: [
          `${esc(editor.name)} changed <strong>${esc(category.name)}</strong>. ${
            reasons.length ? `It changes what items hold:<br>${reasons.map((r) => `• ${esc(r)}`).join("<br>")}` : "It only added to the category, so nothing items already hold was changed."
          }${quoted(input.note)}`,
          "Open it to see the change, adjust it, or undo it.",
        ],
        path: categoryPath(id),
        action: "Open the category",
      });
    }
    return { status: "APPLIED", category, change: null, notice: "Saved." };
  }

  // One waiting change per person per category: a newer proposal replaces theirs.
  await prisma.categoryChange.updateMany({ where: { categoryId: id, proposedById: actorId, status: "PENDING" }, data: { status: "WITHDRAWN" } });
  const { expectedVersion, note, ...payload } = input;
  const change = await prisma.categoryChange.create({
    data: {
      categoryId: id,
      proposedById: actorId,
      unitId: editor.unitId,
      payload: payload as unknown as Prisma.InputJsonValue,
      baseVersion: expectedVersion,
      summary: reasons,
      reaches,
      stages: route.stages,
      stage: route.stages[0],
      note: note?.trim() || null,
    },
  });
  await tellApprovers(change.id);
  const dto = await changeDto(change.id, actorId);
  return {
    status: "PENDING",
    category: await categories.getOne(id),
    change: dto,
    notice: `Sent to ${dto.waitingOn} for approval. It applies once approved. Until then, the category stays as it was.`,
  };
}

async function tellApprovers(changeId: string): Promise<void> {
  const c = await prisma.categoryChange.findUniqueOrThrow({ where: { id: changeId }, include: { category: { select: { name: true } }, proposedBy: { select: { name: true } } } });
  const to = await approverIds(c.stage, c.unitId);
  await notify(to, c.proposedById, {
    subject: `A change to ${c.category.name} is waiting for your approval`,
    paragraphs: [
      `${esc(c.proposedBy.name)} wants to change <strong>${esc(c.category.name)}</strong>:<br>${c.summary.map((s) => `• ${esc(s)}`).join("<br>")}${quoted(c.note)}`,
      c.reaches.length ? `It reaches items of ${esc(c.reaches.join(", "))}. If it is only needed by one department, a separate category for it is usually better.` : "",
    ].filter(Boolean),
    path: categoryPath(c.categoryId, c.id),
    action: "Review the change",
  });
}

interface TrailEntry {
  stage: ChangeStage;
  byId: string;
  byName: string;
  at: string;
  approved: boolean;
  note: string | null;
}

export async function decideChange(actorId: string, changeId: string, input: DecideCategoryChangeInput): Promise<CategoryChangeDto> {
  const c = await prisma.categoryChange.findUnique({ where: { id: changeId }, include: { category: { select: { name: true } }, proposedBy: { select: { name: true } } } });
  if (!c) throw new HttpError(404, "That change was not found.");
  if (c.status !== "PENDING") throw new HttpError(409, "This change has already been decided.");
  if (!(await approverIds(c.stage, c.unitId)).includes(actorId)) throw new HttpError(403, `This change is waiting for ${stageLabel(c.stage, null)}.`);
  const me = await prisma.user.findUniqueOrThrow({ where: { id: actorId }, select: { name: true } });
  const note = input.note?.trim() || null;
  const trail = [...((c.trail as unknown as TrailEntry[]) ?? []), { stage: c.stage, byId: actorId, byName: me.name, at: new Date().toISOString(), approved: input.approve, note }];
  const done = { trail: trail as unknown as Prisma.InputJsonValue, decidedById: actorId, decidedAt: new Date() };

  if (!input.approve) {
    await prisma.categoryChange.update({ where: { id: changeId }, data: { status: "REJECTED", ...done } });
    await notify(c.proposedById, actorId, {
      subject: `Your change to ${c.category.name} was not approved`,
      paragraphs: [`${esc(me.name)} did not approve your change to <strong>${esc(c.category.name)}</strong>.${quoted(note)}`, "The category stays as it was. A category of your own department's may fit better. Open it and choose “Make a copy for my department”."],
      path: categoryPath(c.categoryId),
      action: "Open the category",
      declined: true,
    });
    return changeDto(changeId, actorId);
  }

  const next = nextStage(c.stages, c.stage);
  if (next) {
    await prisma.categoryChange.update({ where: { id: changeId }, data: { stage: next, trail: trail as unknown as Prisma.InputJsonValue } });
    await tellApprovers(changeId);
    return changeDto(changeId, actorId);
  }

  try {
    await categories.update(actorId, c.categoryId, {
      ...(c.payload as unknown as Omit<UpdateCategoryInput, "expectedVersion">),
      expectedVersion: c.baseVersion,
      note: `Proposed by ${c.proposedBy.name}${c.note ? `: ${c.note}` : ""}`,
    } as UpdateCategoryInput);
  } catch (err) {
    if (err instanceof HttpError && err.status === 409 && (err.body as { code?: string } | undefined)?.code === "VERSION_CONFLICT") {
      await prisma.categoryChange.update({ where: { id: changeId }, data: { status: "STALE", ...done } });
      await notify(c.proposedById, actorId, {
        subject: `Your change to ${c.category.name} needs redoing`,
        paragraphs: [`<strong>${esc(c.category.name)}</strong> was changed by someone else before yours was approved, so yours was not applied over it. Open it, and make your change again on the category as it is now.`],
        path: categoryPath(c.categoryId),
        action: "Open the category",
      });
      return changeDto(changeId, actorId);
    }
    throw err;
  }
  await prisma.categoryChange.update({ where: { id: changeId }, data: { status: "APPROVED", ...done } });
  await notify(c.proposedById, actorId, {
    subject: `Your change to ${c.category.name} was approved`,
    paragraphs: [`${esc(me.name)} approved your change to <strong>${esc(c.category.name)}</strong>, and it now applies.${quoted(note)}`],
    path: categoryPath(c.categoryId),
    action: "Open the category",
  });
  return changeDto(changeId, actorId);
}

export async function withdrawChange(actorId: string, changeId: string): Promise<CategoryChangeDto> {
  const c = await prisma.categoryChange.findUnique({ where: { id: changeId }, select: { proposedById: true, status: true } });
  if (!c) throw new HttpError(404, "That change was not found.");
  if (c.proposedById !== actorId) throw new HttpError(403, "Only the person who proposed a change can withdraw it.");
  if (c.status !== "PENDING") throw new HttpError(409, "This change has already been decided.");
  await prisma.categoryChange.update({ where: { id: changeId }, data: { status: "WITHDRAWN" } });
  return changeDto(changeId, actorId);
}

/** The changes waiting for this person, and their own (pending, and decided in the
 *  last 30 days). */
export async function listChanges(actorId: string, categoryId?: string): Promise<CategoryChangesDto> {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const rows = await prisma.categoryChange.findMany({
    where: { ...(categoryId ? { categoryId } : {}), OR: [{ status: "PENDING" }, { proposedById: actorId, updatedAt: { gte: since } }] },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, stage: true, unitId: true, status: true, proposedById: true },
  });
  const waiting: CategoryChangeDto[] = [];
  const mine: CategoryChangeDto[] = [];
  for (const r of rows) {
    if (r.status === "PENDING" && (await approverIds(r.stage, r.unitId)).includes(actorId)) waiting.push(await changeDto(r.id, actorId));
    else if (r.proposedById === actorId) mine.push(await changeDto(r.id, actorId));
  }
  return { waiting, mine };
}

/** How many category changes wait for this person — for Home and the sidebar. */
export async function waitingCount(actorId: string): Promise<number> {
  const rows = await prisma.categoryChange.findMany({ where: { status: "PENDING" }, select: { stage: true, unitId: true } });
  let n = 0;
  for (const r of rows) if ((await approverIds(r.stage, r.unitId)).includes(actorId)) n++;
  return n;
}

async function changeDto(id: string, viewerId: string): Promise<CategoryChangeDto> {
  const c = await prisma.categoryChange.findUniqueOrThrow({
    where: { id },
    include: { category: { select: { name: true, iconKey: true } }, proposedBy: { select: { name: true } }, unit: { select: { name: true } } },
  });
  const approvers = c.status === "PENDING" ? await approverIds(c.stage, c.unitId) : [];
  return {
    id: c.id,
    categoryId: c.categoryId,
    categoryName: c.category.name,
    categoryIconKey: c.category.iconKey,
    proposedById: c.proposedById,
    proposedByName: c.proposedBy.name,
    unitName: c.unit?.name ?? null,
    summary: c.summary,
    reaches: c.reaches,
    stages: c.stages,
    stage: c.stage,
    status: c.status,
    note: c.note,
    waitingOn: stageLabel(c.stage, c.unit?.name ?? null),
    trail: ((c.trail as unknown as TrailEntry[]) ?? []).map((t) => ({ stage: t.stage, byName: t.byName, at: t.at, approved: t.approved, note: t.note })),
    createdAt: c.createdAt.toISOString(),
    canDecide: approvers.includes(viewerId),
    isMine: c.proposedById === viewerId,
  };
}

// ── Removing ──────────────────────────────────────────────────────────────

/** The admin, Property Administration, the steward department's head, or whoever made
 *  it — and only while nothing is filed under it (categories.ts `remove`). */
export async function removeCategory(actorId: string, id: string, opts: { confirmTemplateRemoval?: boolean }): Promise<void> {
  const editor = await editorOf(actorId);
  const row = await prisma.resourceCategory.findUnique({ where: { id }, select: { stewardNodeId: true, createdById: true } });
  if (!row) throw new HttpError(404, "Category not found");
  const mayRemove = editor.isTop || row.createdById === actorId || (editor.headsUnit && row.stewardNodeId !== null && row.stewardNodeId === editor.unitId);
  if (!mayRemove) throw new HttpError(403, "A category is removed by the head of the department that looks after it, by whoever made it, or by Property Administration.");
  await categories.remove(actorId, id, opts);
}
