import "server-only";
import { Prisma } from "@prisma/client";
import type { CancelImportInput, CreateImportInput, ImportRecordDto, LoadImportLineInput } from "@/lib/shared";
import { prisma } from "../prisma";
import { HttpError } from "../http-error";
import * as scope from "./scope";
import { applyChange } from "./mutate";
import { closeIfFullyReceived } from "./purchasing";
import { canReceive, canRecordImports } from "@/lib/domain/purchasing";
import { esc, notify, quoted, usersWithRole } from "../mail/notify";
import type { RoleKind } from "@/lib/shared";
import { paths } from "@/lib/paths";

/**
 * Import records (2026-09-28) — the one door bought goods come into the register by.
 *
 *   a purchase lands (an LRMS request at "Arrived at the main store", or an EGP purchase
 *   that never went through LRMS)
 *   ─▶ Property Administration records what actually arrived (`createImport`)
 *   ─▶ the store keeper loads the Main Store from that record, line by line
 *      (`loadImportLine`) — each load an ordinary `createItem` through the write door
 *   ─▶ a line answering a purchase-request line adds to its `receivedQty`, and the
 *      request closes itself once every line is in.
 *
 * From the store, the keeper hands stock over to labs or issues it to people, which
 * Property Administration approves again (lib/server/resources/approvals.ts).
 */

function dec(v: Prisma.Decimal | number | null): number | null {
  if (v === null) return null;
  return typeof v === "number" ? v : v.toNumber();
}

async function personOf(actorId: string) {
  const user = await prisma.user.findUnique({ where: { id: actorId }, select: { id: true, name: true, homeNodeId: true } });
  return user ? { id: user.id, name: user.name, homeOrgNodeId: user.homeNodeId, roles: await scope.rolesOf(actorId) } : undefined;
}

/** Who follows import records: those who make them, load them, or buy what's in them. */
const READS_IMPORTS: RoleKind[] = ["SYS_ADMIN", "PROPERTY_ADMIN", "STORE_KEEPER", "PROCUREMENT"];

async function assertMayRead(actorId: string): Promise<void> {
  const roles = await scope.rolesOf(actorId);
  if (!roles.some((r) => READS_IMPORTS.includes(r))) throw new HttpError(403, "Import records are for Property Administration, the store and procurement.");
}

/** IMP-2026-001: the year's highest number plus one, inside the caller's transaction
 *  (retried on a collision) — the same scheme as purchase and external references. */
async function nextReference(tx: Prisma.TransactionClient): Promise<string> {
  const prefix = "IMP-" + new Date().getFullYear() + "-";
  const [{ max }] = await tx.$queryRaw<[{ max: number | null }]>`
    SELECT MAX(CAST(substring(reference FROM ${prefix.length + 1}::int) AS integer)) AS max
    FROM "ImportRecord" WHERE reference LIKE ${prefix + "%"} AND substring(reference FROM ${prefix.length + 1}::int) ~ '^[0-9]+$'
  `;
  return `${prefix}${String((max ?? 0) + 1).padStart(3, "0")}`;
}

const include = {
  purchaseRequest: { select: { reference: true, orgNode: { select: { name: true } } } },
  createdBy: { select: { name: true } },
  lines: { orderBy: { sortOrder: "asc" }, include: { category: { select: { name: true, countingMode: true } }, loadedBy: { select: { name: true } } } },
} satisfies Prisma.ImportRecordInclude;

type Row = Prisma.ImportRecordGetPayload<{ include: typeof include }>;

function toDto(row: Row): ImportRecordDto {
  return {
    id: row.id,
    reference: row.reference,
    source: row.source,
    purchaseRequestId: row.purchaseRequestId,
    purchaseReference: row.purchaseRequest?.reference ?? null,
    purchaseOrgNodeName: row.purchaseRequest?.orgNode.name ?? null,
    egpReference: row.egpReference,
    supplier: row.supplier,
    note: row.note,
    status: row.status,
    createdByName: row.createdBy.name,
    createdAt: row.createdAt.toISOString(),
    lines: row.lines.map((l) => ({
      id: l.id,
      name: l.name,
      categoryId: l.categoryId,
      categoryName: l.category.name,
      countingMode: l.category.countingMode,
      qty: dec(l.qty)!,
      unit: l.unit,
      spec: l.spec,
      purchaseLineId: l.purchaseLineId,
      loadedQty: dec(l.loadedQty) ?? 0,
      loadedAt: l.loadedAt?.toISOString() ?? null,
      loadedByName: l.loadedBy?.name ?? null,
    })),
  };
}

async function load(id: string): Promise<ImportRecordDto> {
  const row = await prisma.importRecord.findUnique({ where: { id }, include });
  if (!row) throw new HttpError(404, "Import record not found");
  return toDto(row);
}

// ── Recording what arrived ───────────────────────────────────────────────────────

export async function createImport(actorId: string, input: CreateImportInput): Promise<ImportRecordDto> {
  if (!canRecordImports(await personOf(actorId))) throw new HttpError(403, "Only Property Administration records what arrived.");
  if (input.source === "PURCHASE_REQUEST" && !input.purchaseRequestId) throw new HttpError(400, "Choose the purchase request these goods arrived for.");
  if (input.source === "EGP" && !input.egpReference?.trim()) throw new HttpError(400, "Give the EGP purchase or contract number.");

  const categoryIds = [...new Set(input.lines.map((l) => l.categoryId))];
  const categories = await prisma.resourceCategory.findMany({ where: { id: { in: categoryIds }, active: true }, select: { id: true, name: true, countingMode: true } });
  if (categories.length !== categoryIds.length) throw new HttpError(400, "Choose an existing category for every line.");
  const serialized = new Set(categories.filter((c) => c.countingMode === "SERIALIZED").map((c) => c.id));
  const fractional = input.lines.find((l) => serialized.has(l.categoryId) && !Number.isInteger(l.qty));
  if (fractional) throw new HttpError(400, `"${fractional.name}" is a serialized category: record whole units, not ${fractional.qty}.`);

  if (input.source === "PURCHASE_REQUEST") {
    const request = await prisma.purchaseRequest.findUnique({ where: { id: input.purchaseRequestId! }, include: { lines: true } });
    if (!request) throw new HttpError(404, "Purchase request not found");
    if (request.stage !== "IN_STORE") throw new HttpError(409, `${request.reference} hasn't arrived at the main store yet: procurement marks it "Arrived" first.`);
    const byId = new Map(request.lines.map((l) => [l.id, l]));
    // Already recorded on another (not cancelled) import, per purchase line.
    const earlier = await prisma.importLine.groupBy({
      by: ["purchaseLineId"],
      where: { purchaseLineId: { in: [...byId.keys()] }, record: { status: { not: "CANCELLED" } } },
      _sum: { qty: true },
    });
    const recorded = new Map(earlier.map((e) => [e.purchaseLineId!, dec(e._sum.qty) ?? 0]));
    for (const line of input.lines) {
      if (!line.purchaseLineId) continue;
      const ordered = byId.get(line.purchaseLineId);
      if (!ordered) throw new HttpError(400, `"${line.name}" is linked to a line that isn't on ${request.reference}.`);
      if (ordered.categoryId && ordered.categoryId !== line.categoryId) throw new HttpError(400, `"${line.name}" was ordered as a different category.`);
      const next = (recorded.get(ordered.id) ?? 0) + line.qty;
      if (next > dec(ordered.qty)!) {
        const left = dec(ordered.qty)! - (recorded.get(ordered.id) ?? 0);
        throw new HttpError(409, `Only ${left} of "${ordered.name}" are left to record on ${request.reference}: refusing ${line.qty}.`);
      }
      recorded.set(ordered.id, next);
    }
  } else if (input.lines.some((l) => l.purchaseLineId)) {
    throw new HttpError(400, "A standalone EGP record isn't linked to purchase-request lines.");
  }

  let id = "";
  for (let attempt = 0; ; attempt++) {
    try {
      id = await prisma.$transaction(async (tx) => {
        const record = await tx.importRecord.create({
          data: {
            reference: await nextReference(tx),
            source: input.source,
            purchaseRequestId: input.source === "PURCHASE_REQUEST" ? input.purchaseRequestId! : null,
            egpReference: input.egpReference || null,
            supplier: input.supplier || null,
            note: input.note || null,
            createdById: actorId,
            lines: {
              create: input.lines.map((l, i) => ({
                name: l.name,
                categoryId: l.categoryId,
                qty: l.qty,
                unit: l.unit || null,
                spec: l.spec || null,
                purchaseLineId: l.purchaseLineId ?? null,
                sortOrder: i,
              })),
            },
          },
        });
        return record.id;
      });
      break;
    } catch (err) {
      const collided = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && String(err.meta?.target).includes("reference");
      if (!collided || attempt >= 4) throw err;
    }
  }

  const dto = await load(id);
  await notify(await usersWithRole("STORE_KEEPER"), actorId, {
    subject: `${dto.reference} is ready to load into the store`,
    paragraphs: [
      `${esc(dto.createdByName)} recorded what arrived${dto.purchaseReference ? ` for <strong>${esc(dto.purchaseReference)}</strong>` : dto.egpReference ? ` (EGP ${esc(dto.egpReference)})` : ""}: ${dto.lines.length} line${dto.lines.length === 1 ? "" : "s"}.${quoted(dto.note)}`,
      "Load it into the store under <strong>Purchasing → Arrivals</strong>.",
    ],
    path: paths.importRecord(dto.id),
    action: "Open Arrivals",
  });
  return dto;
}

/** Only before anything has been loaded from it — loaded stock is already in the register. */
export async function cancelImport(actorId: string, id: string, input: CancelImportInput): Promise<ImportRecordDto> {
  if (!canRecordImports(await personOf(actorId))) throw new HttpError(403, "Only Property Administration cancels an import record.");
  const row = await prisma.importRecord.findUnique({ where: { id }, include: { lines: true } });
  if (!row) throw new HttpError(404, "Import record not found");
  if (row.status !== "OPEN") throw new HttpError(409, "This import record is already closed.");
  if (row.lines.some((l) => (dec(l.loadedQty) ?? 0) > 0)) throw new HttpError(409, "Some of it is already loaded into the store. It can't be cancelled now.");
  await prisma.importRecord.update({ where: { id }, data: { status: "CANCELLED", note: [row.note, `Cancelled: ${input.note}`].filter(Boolean).join("\n") } });
  return load(id);
}

// ── Loading the store ────────────────────────────────────────────────────────────

/**
 * The store keeper loads (part of) one line into the store — the seam with the register:
 * from this moment the goods are ordinary Items, created through `applyChange`, whose
 * own custody check on `storeParentId` applies unchanged. A SERIALIZED line becomes one
 * item per unit; a BULK line one item holding the quantity. Several loads add up, never
 * past what the record says arrived.
 */
export async function loadImportLine(actorId: string, recordId: string, input: LoadImportLineInput): Promise<ImportRecordDto> {
  if (!canReceive(await personOf(actorId))) throw new HttpError(403, "Only the store keeper loads stock into the store.");

  const record = await prisma.importRecord.findUnique({ where: { id: recordId }, include: { lines: { include: { category: true } } } });
  if (!record) throw new HttpError(404, "Import record not found");
  if (record.status !== "OPEN") throw new HttpError(409, "This import record is closed.");
  const line = record.lines.find((l) => l.id === input.lineId);
  if (!line) throw new HttpError(404, "Line not found on this import record");

  const isSerialized = line.category.countingMode === "SERIALIZED";
  if (isSerialized && !Number.isInteger(input.qty)) throw new HttpError(400, "A serialized category is loaded in whole units.");

  // Atomic cap, not read-then-check (F-045 of the 2026-09-15 campaign, carried over
  // from receiving): the threshold is fixed before the query runs, so two loads at once
  // can't both pass against the same stale reading, and nothing is loaded past what
  // arrived.
  const arrived = dec(line.qty)!;
  const threshold = arrived - input.qty;
  const remaining = async () => arrived - (dec((await prisma.importLine.findUniqueOrThrow({ where: { id: line.id } })).loadedQty) ?? 0);
  if (threshold < 0) throw new HttpError(409, `Only ${await remaining()} ${line.unit ?? "unit(s)"} of "${line.name}" are left to load: refusing ${input.qty}.`);
  const now = new Date();
  const fromZero = await prisma.importLine.updateMany({ where: { id: line.id, loadedQty: null }, data: { loadedQty: input.qty, loadedAt: now, loadedById: actorId } });
  if (fromZero.count === 0) {
    const claimed = await prisma.importLine.updateMany({ where: { id: line.id, loadedQty: { lte: threshold } }, data: { loadedQty: { increment: input.qty }, loadedAt: now, loadedById: actorId } });
    if (claimed.count === 0) throw new HttpError(409, `Only ${await remaining()} ${line.unit ?? "unit(s)"} of "${line.name}" are left to load: refusing ${input.qty}.`);
  }

  const note = `Loaded from import ${record.reference}${line.spec ? `: ${line.spec}` : ""}`;
  try {
    const result = await applyChange(actorId, { kind: "createItem", parentId: input.storeParentId, categoryId: line.categoryId, count: isSerialized ? input.qty : 1, name: line.name, note }, { systemCreate: true, bypassDraftWorkflowBlock: true });
    if (!isSerialized && result.itemIds[0]) await applyChange(actorId, { kind: "setQuantity", itemIds: [result.itemIds[0]], value: input.qty }, { bypassDraftWorkflowBlock: true });
  } catch (err) {
    // Give the claim back, so a failed creation doesn't count as loaded.
    await prisma.importLine.update({ where: { id: line.id }, data: { loadedQty: { decrement: input.qty } } });
    throw err;
  }

  if (line.purchaseLineId) {
    // NULL + n is NULL in SQL: the first receipt sets it, later ones add to it.
    const first = await prisma.purchaseLine.updateMany({ where: { id: line.purchaseLineId, receivedQty: null }, data: { receivedQty: input.qty, receivedAt: now, receivedById: actorId } });
    if (first.count === 0) {
      await prisma.purchaseLine.update({ where: { id: line.purchaseLineId }, data: { receivedQty: { increment: input.qty }, receivedAt: now, receivedById: actorId } });
    }
  }

  const lines = await prisma.importLine.findMany({ where: { recordId } });
  if (lines.every((l) => (dec(l.loadedQty) ?? 0) >= dec(l.qty)!)) await prisma.importRecord.update({ where: { id: recordId }, data: { status: "LOADED" } });
  if (record.purchaseRequestId) await closeIfFullyReceived(record.purchaseRequestId, actorId);

  return load(recordId);
}

// ── Reading ──────────────────────────────────────────────────────────────────────

/** Open records first (what is waiting to be loaded), then the rest, newest first. */
export async function listImports(actorId: string): Promise<ImportRecordDto[]> {
  await assertMayRead(actorId);
  const rows = await prisma.importRecord.findMany({ include, orderBy: { createdAt: "desc" }, take: 200 });
  return rows.map(toDto).sort((a, b) => Number(b.status === "OPEN") - Number(a.status === "OPEN"));
}

export async function getImport(actorId: string, id: string): Promise<ImportRecordDto> {
  await assertMayRead(actorId);
  return load(id);
}
