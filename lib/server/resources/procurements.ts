import "server-only";
import { Prisma } from "@prisma/client";
import type {
  AddProcurementRequestsInput,
  CancelProcurementInput,
  EditProcurementLinesInput,
  MoveProcurementInput,
  ProcurementDto,
  ProcurementLineInput,
  RoleKind,
  StartProcurementInput,
  WaitingRequestDto,
} from "@/lib/shared";
import {
  PROCUREMENT_LABEL,
  canMove,
  describeArrival,
  describeLineChanges,
  isLive,
  linesEditable,
  requestStageFor,
  requestsEditable,
  type ProcurementStage,
} from "@/lib/domain/procurement";
import { STAGE_LABEL } from "@/lib/domain/purchasing";
import { paths } from "@/lib/paths";
import { prisma } from "../prisma";
import { HttpError } from "../http-error";
import * as scope from "./scope";
import { esc, notify, quoted, usersWithRole } from "../mail/notify";

/**
 * Procurement as a process (2026-10-02; rules in lib/domain/procurement.ts). The
 * procurement office starts a procurement from approved requests (or none, for a
 * standalone EGP purchase), edits what is really being bought, and moves it forward
 * stage by stage; the requests it covers follow it, and their raisers are told. At
 * ARRIVED it records what came; Property Administration's import record starts from
 * those counts, and once the store keeper has loaded everything it closes, with the
 * requests it covers.
 */

const RUNS: RoleKind[] = ["PROCUREMENT", "SYS_ADMIN"];
const READS: RoleKind[] = ["PROCUREMENT", "SYS_ADMIN", "PROPERTY_ADMIN", "STORE_KEEPER"];

async function assertRuns(actorId: string): Promise<void> {
  const roles = await scope.rolesOf(actorId);
  if (!roles.some((r) => RUNS.includes(r))) throw new HttpError(403, "Only the procurement office runs a procurement.");
}

const dec = (v: Prisma.Decimal | number | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));

const include = {
  createdBy: { select: { name: true } },
  requests: { include: { purchaseRequest: { select: { id: true, reference: true, title: true, raisedById: true, orgNode: { select: { name: true } }, raisedBy: { select: { name: true } } } } } },
  lines: {
    orderBy: { sortOrder: "asc" },
    include: { category: { select: { name: true } }, purchaseLine: { select: { qty: true, purchase: { select: { reference: true } } } } },
  },
  events: { orderBy: { at: "asc" }, include: { by: { select: { name: true } } } },
  imports: { where: { status: { not: "CANCELLED" } }, select: { id: true, reference: true, status: true }, orderBy: { createdAt: "desc" } },
} satisfies Prisma.ProcurementInclude;

type Row = Prisma.ProcurementGetPayload<{ include: typeof include }>;

function toDto(row: Row, runs: boolean): ProcurementDto {
  const stage = row.stage as ProcurementStage;
  const lines = row.lines.map((l) => ({
    id: l.id,
    name: l.name,
    categoryId: l.categoryId,
    categoryName: l.category?.name ?? null,
    qty: dec(l.qty)!,
    unit: l.unit,
    unitCost: dec(l.unitCost),
    spec: l.spec,
    purchaseLineId: l.purchaseLineId,
    purchaseReference: l.purchaseLine?.purchase.reference ?? null,
    requestedQty: dec(l.purchaseLine?.qty),
    arrivedQty: dec(l.arrivedQty),
  }));
  const costed = lines.every((l) => l.unitCost !== null);
  return {
    id: row.id,
    reference: row.reference,
    title: row.title,
    egpReference: row.egpReference,
    supplier: row.supplier,
    stage,
    createdByName: row.createdBy.name,
    createdAt: row.createdAt.toISOString(),
    requests: row.requests.map(({ purchaseRequest: p }) => ({ id: p.id, reference: p.reference, title: p.title, orgNodeName: p.orgNode.name, raisedByName: p.raisedBy.name })),
    lines,
    events: row.events.map((e) => ({ at: e.at.toISOString(), byName: e.by.name, stage: e.stage as ProcurementStage, note: e.note, lineChanges: e.lineChanges })),
    importRecord: row.imports[0] ? { id: row.imports[0].id, reference: row.imports[0].reference, status: row.imports[0].status } : null,
    total: lines.length && costed ? lines.reduce((sum, l) => sum + l.qty * (l.unitCost ?? 0), 0) : null,
    can: {
      move: runs && isLive(stage) && stage !== "ARRIVED",
      editLines: runs && linesEditable(stage),
      addRequests: runs && requestsEditable(stage),
      cancel: runs && isLive(stage) && stage !== "ARRIVED",
    },
  };
}

async function load(id: string, actorId: string): Promise<ProcurementDto> {
  const row = await prisma.procurement.findUnique({ where: { id }, include });
  if (!row) throw new HttpError(404, "Procurement not found");
  const roles = await scope.rolesOf(actorId);
  return toDto(row, roles.some((r) => RUNS.includes(r)));
}

/** Readers: the purchasing roles, and anyone who raised one of the requests it covers. */
export async function getProcurement(actorId: string, id: string): Promise<ProcurementDto> {
  const roles = await scope.rolesOf(actorId);
  if (!roles.some((r) => READS.includes(r))) {
    const covers = await prisma.procurementRequest.count({ where: { procurementId: id, purchaseRequest: { raisedById: actorId } } });
    if (!covers) throw new HttpError(404, "Procurement not found");
  }
  return load(id, actorId);
}

/** Every procurement, live ones first (newest first within each). */
export async function listProcurements(actorId: string): Promise<ProcurementDto[]> {
  const roles = await scope.rolesOf(actorId);
  const where: Prisma.ProcurementWhereInput = roles.some((r) => READS.includes(r)) ? {} : { requests: { some: { purchaseRequest: { raisedById: actorId } } } };
  const rows = await prisma.procurement.findMany({ where, include, orderBy: { createdAt: "desc" } });
  const runs = roles.some((r) => RUNS.includes(r));
  const dtos = rows.map((r) => toDto(r, runs));
  return [...dtos.filter((d) => isLive(d.stage)), ...dtos.filter((d) => !isLive(d.stage))];
}

/** Approved requests procurement hasn't started buying yet. */
export async function waitingRequests(actorId: string): Promise<WaitingRequestDto[]> {
  await assertRuns(actorId);
  const rows = await prisma.purchaseRequest.findMany({
    where: { stage: "WITH_PROCUREMENT", procurements: { none: { procurement: { stage: { notIn: ["CANCELLED"] } } } } },
    include: { orgNode: { select: { name: true } }, raisedBy: { select: { name: true } }, _count: { select: { lines: true } }, events: { orderBy: { at: "desc" }, take: 1, select: { at: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    reference: r.reference,
    title: r.title,
    orgNodeName: r.orgNode.name,
    raisedByName: r.raisedBy.name,
    lineCount: r._count.lines,
    approvedAt: (r.events[0]?.at ?? r.createdAt).toISOString(),
  }));
}

async function nextReference(tx: Prisma.TransactionClient): Promise<string> {
  const prefix = "PROC-" + new Date().getFullYear() + "-";
  const [{ max }] = await tx.$queryRaw<[{ max: number | null }]>`
    SELECT MAX(CAST(substring(reference FROM ${prefix.length + 1}::int) AS integer)) AS max
    FROM "Procurement" WHERE reference LIKE ${prefix + "%"} AND substring(reference FROM ${prefix.length + 1}::int) ~ '^[0-9]+$'
  `;
  return `${prefix}${String((max ?? 0) + 1).padStart(3, "0")}`;
}

/** The requests, checked: approved, waiting for procurement, not in a live procurement. */
async function assertWaiting(client: Prisma.TransactionClient | typeof prisma, requestIds: string[]) {
  const ids = [...new Set(requestIds)];
  const rows = await client.purchaseRequest.findMany({
    where: { id: { in: ids } },
    include: { lines: { orderBy: { id: "asc" } }, procurements: { include: { procurement: { select: { reference: true, stage: true } } } } },
  });
  if (rows.length !== ids.length) throw new HttpError(404, "One of the chosen requests no longer exists.");
  for (const r of rows) {
    if (r.stage !== "WITH_PROCUREMENT") throw new HttpError(409, `${r.reference} isn't waiting for procurement (it is "${STAGE_LABEL[r.stage]}").`);
    const live = r.procurements.find((p) => p.procurement.stage !== "CANCELLED");
    if (live) throw new HttpError(409, `${r.reference} is already being bought through ${live.procurement.reference}.`);
  }
  return rows;
}

async function assertCategories(client: Prisma.TransactionClient | typeof prisma, lines: ProcurementLineInput[]): Promise<void> {
  const ids = [...new Set(lines.map((l) => l.categoryId).filter((c): c is string => !!c))];
  if (!ids.length) return;
  const found = await client.resourceCategory.count({ where: { id: { in: ids } } });
  if (found !== ids.length) throw new HttpError(400, "A line names a category that no longer exists. Choose it again.");
}

const lineData = (l: ProcurementLineInput, i: number) => ({
  name: l.name,
  categoryId: l.categoryId ?? null,
  qty: l.qty,
  unit: l.unit || null,
  unitCost: l.unitCost ?? null,
  spec: l.spec || null,
  purchaseLineId: l.purchaseLineId ?? null,
  sortOrder: i,
});

/** A covered request follows its procurement: its stage, and a line in its history. */
async function mirror(tx: Prisma.TransactionClient, procurementId: string, actorId: string, stage: ProcurementStage, reference: string, note?: string | null) {
  const links = await tx.procurementRequest.findMany({ where: { procurementId }, select: { purchaseRequestId: true } });
  const target = requestStageFor(stage);
  for (const { purchaseRequestId } of links) {
    await tx.purchaseRequest.update({ where: { id: purchaseRequestId }, data: { stage: target } });
    await tx.purchaseEvent.create({ data: { purchaseId: purchaseRequestId, byId: actorId, stage: target, note: `${reference}: ${PROCUREMENT_LABEL[stage]}${note ? `: ${note}` : ""}` } });
  }
}

async function raisersOf(procurementId: string): Promise<string[]> {
  const rows = await prisma.procurementRequest.findMany({ where: { procurementId }, select: { purchaseRequest: { select: { raisedById: true } } } });
  return [...new Set(rows.map((r) => r.purchaseRequest.raisedById))];
}

async function tellRaisers(dto: ProcurementDto, actorId: string, subject: string, paragraphs: string[], declined = false): Promise<void> {
  await notify(await raisersOf(dto.id), actorId, { subject, paragraphs, path: paths.procurement(dto.id), action: "Open the procurement", declined });
}

const requestList = (dto: ProcurementDto) => dto.requests.map((r) => `<strong>${esc(r.reference)}</strong>`).join(", ");

/** Start buying: from approved requests (their lines to begin with), or standalone. */
export async function startProcurement(actorId: string, input: StartProcurementInput): Promise<ProcurementDto> {
  await assertRuns(actorId);
  if (!input.requestIds.length && !input.lines?.length) throw new HttpError(400, "A standalone EGP purchase lists what it buys: add at least one line.");
  if (!input.requestIds.length && !input.egpReference?.trim()) throw new HttpError(400, "A standalone purchase needs its EGP number.");
  if (input.lines) await assertCategories(prisma, input.lines);

  let id = "";
  for (let attempt = 0; ; attempt++) {
    try {
      id = await prisma.$transaction(async (tx) => {
        const requests = await assertWaiting(tx, input.requestIds);
        const fromRequests: ProcurementLineInput[] = requests.flatMap((r) =>
          r.lines.map((l) => ({ name: l.name, categoryId: l.categoryId, qty: Number(l.qty), unit: l.unit, unitCost: dec(l.estimatedUnitCost), purchaseLineId: l.id })),
        );
        const lines = input.lines?.length ? input.lines : fromRequests;
        if (!lines.length) throw new HttpError(400, "The chosen requests have no lines to buy.");
        const own = new Set(fromRequests.map((l) => l.purchaseLineId));
        if (lines.some((l) => l.purchaseLineId && !own.has(l.purchaseLineId))) throw new HttpError(400, "A line points at a request line this procurement doesn't cover.");
        const reference = await nextReference(tx);
        const title = input.title?.trim() || (requests.length ? requests.map((r) => r.title).join("; ").slice(0, 200) : `Standalone EGP purchase ${input.egpReference ?? ""}`.trim());
        const row = await tx.procurement.create({
          data: {
            reference,
            title,
            egpReference: input.egpReference || null,
            supplier: input.supplier || null,
            createdById: actorId,
            requests: { create: requests.map((r) => ({ purchaseRequestId: r.id })) },
            lines: { create: lines.map(lineData) },
            events: {
              create: {
                byId: actorId,
                stage: "PREPARING",
                note: [requests.length ? `Started from ${requests.map((r) => r.reference).join(", ")}` : "A standalone EGP purchase", input.note].filter(Boolean).join(". "),
              },
            },
          },
        });
        for (const r of requests) {
          await tx.purchaseEvent.create({ data: { purchaseId: r.id, byId: actorId, stage: "WITH_PROCUREMENT", note: `${reference}: procurement started buying it.` } });
        }
        return row.id;
      });
      break;
    } catch (err) {
      const collided = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
      if (!collided || attempt >= 4) throw err;
    }
  }
  const dto = await load(id, actorId);
  if (dto.requests.length) {
    await tellRaisers(dto, actorId, `${dto.reference}: procurement started buying your request`, [
      `Procurement is buying ${requestList(dto)} through <strong>${esc(dto.reference)}</strong>. You'll be told as it moves: placed on EGP, supplier found, on delivery, arrived.`,
    ]);
  }
  return dto;
}

/** Add more approved requests while it is still being prepared; their lines join it. */
export async function addRequests(actorId: string, id: string, input: AddProcurementRequestsInput): Promise<ProcurementDto> {
  await assertRuns(actorId);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
    const row = await tx.procurement.findUnique({ where: { id }, include: { _count: { select: { lines: true } } } });
    if (!row) throw new HttpError(404, "Procurement not found");
    if (!requestsEditable(row.stage as ProcurementStage)) throw new HttpError(409, `${row.reference} is already placed. Start another procurement for these requests.`);
    const requests = await assertWaiting(tx, input.requestIds);
    let i = row._count.lines;
    for (const r of requests) {
      await tx.procurementRequest.create({ data: { procurementId: id, purchaseRequestId: r.id } });
      for (const l of r.lines) {
        await tx.procurementLine.create({
          data: { procurementId: id, ...lineData({ name: l.name, categoryId: l.categoryId, qty: Number(l.qty), unit: l.unit, unitCost: dec(l.estimatedUnitCost), purchaseLineId: l.id }, i++) },
        });
      }
      await tx.purchaseEvent.create({ data: { purchaseId: r.id, byId: actorId, stage: "WITH_PROCUREMENT", note: `${row.reference}: procurement started buying it.` } });
    }
    await tx.procurementEvent.create({ data: { procurementId: id, byId: actorId, stage: row.stage, note: `Added ${requests.map((r) => r.reference).join(", ")}` } });
  });
  const dto = await load(id, actorId);
  await notify(
    (await prisma.purchaseRequest.findMany({ where: { id: { in: input.requestIds } }, select: { raisedById: true } })).map((r) => r.raisedById),
    actorId,
    { subject: `${dto.reference}: procurement started buying your request`, paragraphs: [`Your request is now part of <strong>${esc(dto.reference)}</strong> “${esc(dto.title)}”.`], path: paths.procurement(dto.id), action: "Open the procurement" },
  );
  return dto;
}

/** Edit what is really being bought (fewer found, more bought, a line added or
 *  dropped), saying why. Recorded in its history in words; whoever's request lost or
 *  shrank a line is told. */
export async function editLines(actorId: string, id: string, input: EditProcurementLinesInput): Promise<ProcurementDto> {
  await assertRuns(actorId);
  await assertCategories(prisma, input.lines);
  let changes: string[] = [];
  let affected: string[] = [];
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
    const row = await tx.procurement.findUnique({ where: { id }, include: { lines: true, requests: { include: { purchaseRequest: { select: { lines: { select: { id: true } } } } } } } });
    if (!row) throw new HttpError(404, "Procurement not found");
    if (!linesEditable(row.stage as ProcurementStage)) throw new HttpError(409, `${row.reference} has ${row.stage === "ARRIVED" ? "arrived: correct the counts on Property Administration's import record" : "ended"}.`);
    const covered = new Set(row.requests.flatMap((r) => r.purchaseRequest.lines.map((l) => l.id)));
    if (input.lines.some((l) => l.purchaseLineId && !covered.has(l.purchaseLineId))) throw new HttpError(400, "A line points at a request line this procurement doesn't cover.");
    const existing = new Map(row.lines.map((l) => [l.id, l]));
    if (input.lines.some((l) => l.id && !existing.has(l.id))) throw new HttpError(409, "These lines changed since you opened them. Reload and edit again.");

    const before = row.lines.map((l) => ({ id: l.id, name: l.name, qty: Number(l.qty), unit: l.unit, unitCost: dec(l.unitCost) }));
    const after = input.lines.map((l) => ({ id: l.id, name: l.name, qty: l.qty, unit: l.unit ?? null, unitCost: l.unitCost ?? null }));
    changes = describeLineChanges(before, after);
    if (!changes.length) throw new HttpError(400, "Nothing changed.");
    // Request lines that lost quantity or were dropped: their raisers are told.
    const nextByPurchaseLine = new Map<string, number>();
    for (const l of input.lines) if (l.purchaseLineId) nextByPurchaseLine.set(l.purchaseLineId, (nextByPurchaseLine.get(l.purchaseLineId) ?? 0) + l.qty);
    const reduced = row.lines.filter((l) => l.purchaseLineId && (nextByPurchaseLine.get(l.purchaseLineId) ?? 0) < Number(l.qty)).map((l) => l.purchaseLineId!);
    affected = reduced;

    const keep = new Set(input.lines.filter((l) => l.id).map((l) => l.id!));
    await tx.procurementLine.deleteMany({ where: { procurementId: id, id: { notIn: [...keep] } } });
    for (const [i, l] of input.lines.entries()) {
      if (l.id) await tx.procurementLine.update({ where: { id: l.id }, data: lineData(l, i) });
      else await tx.procurementLine.create({ data: { procurementId: id, ...lineData(l, i) } });
    }
    await tx.procurementEvent.create({ data: { procurementId: id, byId: actorId, stage: row.stage, note: `What is bought changed: ${input.reason}`, lineChanges: changes } });
  });
  const dto = await load(id, actorId);
  if (affected.length) {
    const raisers = await prisma.purchaseLine.findMany({ where: { id: { in: affected } }, select: { purchase: { select: { raisedById: true } } } });
    await notify([...new Set(raisers.map((r) => r.purchase.raisedById))], actorId, {
      subject: `${dto.reference}: less will be bought than you asked for`,
      paragraphs: [`Procurement changed what <strong>${esc(dto.reference)}</strong> buys:`, changes.map((c) => esc(c)).join("<br>"), `Why: ${esc(input.reason)}`],
      path: paths.procurement(dto.id),
      action: "Open the procurement",
      declined: true,
    });
  }
  return dto;
}

/** Move it forward: to the next stage or any later one. Arriving records what came. */
export async function moveProcurement(actorId: string, id: string, input: MoveProcurementInput): Promise<ProcurementDto> {
  await assertRuns(actorId);
  const to = input.stage as ProcurementStage;
  let arrivalNotes: string[] = [];
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
    const row = await tx.procurement.findUnique({ where: { id }, include: { lines: true } });
    if (!row) throw new HttpError(404, "Procurement not found");
    const from = row.stage as ProcurementStage;
    if (!canMove(from, to)) throw new HttpError(409, `${row.reference} can't go from "${PROCUREMENT_LABEL[from]}" to "${PROCUREMENT_LABEL[to]}": it only moves forward, and "${PROCUREMENT_LABEL.CLOSED}" comes from loading the store.`);
    const egp = input.egpReference?.trim() || row.egpReference;
    if (to !== "PREPARING" && !egp) throw new HttpError(400, "Give the EGP number first: everyone following it, and the store, look it up by that.");

    if (to === "ARRIVED") {
      const given = new Map((input.arrived ?? []).map((a) => [a.lineId, a.qty]));
      if ([...given.keys()].some((k) => !row.lines.some((l) => l.id === k))) throw new HttpError(409, "These lines changed since you opened them. Reload and record again.");
      const counts = row.lines.map((l) => ({ line: l, arrived: given.get(l.id) ?? Number(l.qty) }));
      if (counts.every((c) => c.arrived === 0)) throw new HttpError(400, "Nothing came? Record what arrived, or cancel the procurement.");
      for (const c of counts) await tx.procurementLine.update({ where: { id: c.line.id }, data: { arrivedQty: c.arrived } });
      arrivalNotes = describeArrival(counts.map((c) => ({ name: c.line.name, qty: Number(c.line.qty), arrived: c.arrived, unit: c.line.unit })));
    }
    await tx.procurement.update({ where: { id }, data: { stage: to, egpReference: egp, supplier: input.supplier?.trim() || row.supplier } });
    await tx.procurementEvent.create({ data: { procurementId: id, byId: actorId, stage: to, note: input.note || null, lineChanges: arrivalNotes } });
    await mirror(tx, id, actorId, to, row.reference, input.note);
  });
  const dto = await load(id, actorId);
  await tellRaisers(dto, actorId, `${dto.reference}: ${PROCUREMENT_LABEL[to]}`, [
    `<strong>${esc(dto.reference)}</strong>, buying ${requestList(dto) || "your request"}, moved on: <strong>${PROCUREMENT_LABEL[to]}</strong>.${quoted(input.note)}`,
    ...(arrivalNotes.length ? [`Not everything came: ${arrivalNotes.map((n) => esc(n)).join("; ")}.`] : []),
  ]);
  if (to === "ARRIVED") {
    await notify(await usersWithRole("PROPERTY_ADMIN"), actorId, {
      subject: `${dto.reference} has arrived at the main store`,
      paragraphs: [
        `<strong>${esc(dto.reference)}</strong> “${esc(dto.title)}” has arrived (EGP ${esc(dto.egpReference ?? "")}). Check the counts procurement recorded and record the import, so the store keeper can load it.`,
      ],
      path: paths.procurementArrived(dto.id),
      action: "Record what arrived",
    });
  }
  return dto;
}

/** Stop it before it arrives; the requests it covered go back to waiting for procurement. */
export async function cancelProcurement(actorId: string, id: string, input: CancelProcurementInput): Promise<ProcurementDto> {
  await assertRuns(actorId);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
    const row = await tx.procurement.findUnique({ where: { id } });
    if (!row) throw new HttpError(404, "Procurement not found");
    const stage = row.stage as ProcurementStage;
    if (!isLive(stage) || stage === "ARRIVED") throw new HttpError(409, stage === "ARRIVED" ? `${row.reference} has arrived: it can't be cancelled now.` : `${row.reference} has already ended.`);
    await tx.procurement.update({ where: { id }, data: { stage: "CANCELLED" } });
    await tx.procurementEvent.create({ data: { procurementId: id, byId: actorId, stage: "CANCELLED", note: input.note } });
    await mirror(tx, id, actorId, "CANCELLED", row.reference, input.note);
  });
  const dto = await load(id, actorId);
  await tellRaisers(
    dto,
    actorId,
    `${dto.reference} was cancelled`,
    [`Procurement cancelled <strong>${esc(dto.reference)}</strong>. ${requestList(dto)} ${dto.requests.length === 1 ? "is" : "are"} back with procurement, to be bought another way.${quoted(input.note)}`],
    true,
  );
  return dto;
}

/**
 * Called after the store keeper loads from an import record. When everything on the
 * procurement's import is loaded, the procurement is in the store: it closes, and so
 * do the requests it covers (what wasn't bought or didn't come was already told).
 */
export async function closeIfLoaded(procurementId: string, actorId: string): Promise<boolean> {
  const row = await prisma.procurement.findUnique({ where: { id: procurementId }, include: { imports: { where: { status: { not: "CANCELLED" } }, select: { status: true } } } });
  if (!row || row.stage !== "ARRIVED" || !row.imports.length || row.imports.some((i) => i.status !== "LOADED")) return false;
  await prisma.$transaction(async (tx) => {
    await tx.procurement.update({ where: { id: procurementId }, data: { stage: "CLOSED" } });
    await tx.procurementEvent.create({ data: { procurementId, byId: actorId, stage: "CLOSED", note: "Everything that arrived is loaded into the store." } });
    await mirror(tx, procurementId, actorId, "CLOSED", row.reference, null);
  });
  const dto = await load(procurementId, actorId);
  await tellRaisers(dto, actorId, `${dto.reference} is in the store`, [
    `Everything <strong>${esc(dto.reference)}</strong> bought is loaded into the main store. The store keeper sends it on to your labs.`,
  ]);
  return true;
}
