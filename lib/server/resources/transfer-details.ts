import "server-only";
import type { TransferDetailsDto, TransferDetailItemDto } from "@/lib/shared";
import { STATUS_LABEL } from "@/lib/domain/status";
import { prisma } from "../prisma";
import { getRequest, movementOf, MOVEMENT_TITLE } from "./approvals";

/**
 * What an approver reads before deciding a transfer — not the one-line summary, but each
 * resource as the register holds it now: its kind, status, recorded details, what travels
 * inside it, where it sits and who answers for it; and where it is going, to whom.
 *
 * Readable by exactly the people who may read the request (approvals.ts's `getRequest`).
 */
export async function getTransferDetails(actorId: string, requestId: string): Promise<TransferDetailsDto> {
  await getRequest(actorId, requestId);
  const request = await prisma.changeRequest.findUniqueOrThrow({ where: { id: requestId }, select: { payload: true, baseVersions: true } });
  const payload = request.payload as unknown as {
    itemIds: string[];
    transfer: { targetParentId: string; targetOrgNodeId: string; targetCustodianId: string | null; transferOwnership?: boolean; movement?: never };
  };
  const baseVersions = (request.baseVersions ?? {}) as Record<string, number>;

  const rows = await prisma.item.findMany({
    where: { id: { in: payload.itemIds } },
    include: {
      category: { select: { name: true, unit: true, fields: { orderBy: { sortOrder: "asc" }, select: { key: true, label: true, type: true, unit: true } } } },
      ownerOrg: { select: { name: true } },
      currentOrg: { select: { name: true } },
      custodian: { select: { name: true } },
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));

  const items: TransferDetailItemDto[] = [];
  for (const id of payload.itemIds) {
    const r = byId.get(id);
    if (!r || r.deletedAt) {
      items.push({
        id,
        name: r?.name ?? "A resource no longer in the register",
        categoryName: r?.category.name ?? "",
        status: "",
        qty: null,
        unit: null,
        from: [],
        ownerUnitName: "",
        holderUnitName: "",
        custodianName: "",
        details: [],
        parts: [],
        partsTotal: 0,
        changedSinceAsked: false,
        removed: true,
      });
      continue;
    }
    const props = (r.props ?? {}) as Record<string, unknown>;
    const details = r.category.fields
      .filter((f) => props[f.key] !== undefined && props[f.key] !== null && props[f.key] !== "")
      .map((f) => ({ label: f.label, value: readable(props[f.key], f.unit) }));
    for (const [key, entry] of Object.entries((r.customProps ?? {}) as Record<string, { value?: unknown }>)) {
      if (entry?.value !== undefined && entry.value !== null && entry.value !== "") details.push({ label: key, value: readable(entry.value, null) });
    }
    const parts = await partsInside(r.id);
    items.push({
      id: r.id,
      name: r.name,
      categoryName: r.category.name,
      status: STATUS_LABEL[r.status],
      qty: r.countingMode === "BULK" ? Number(r.qty) : null,
      unit: r.countingMode === "BULK" ? r.category.unit : null,
      from: r.parentId ? await placePath(r.parentId) : [],
      ownerUnitName: r.ownerOrg.name,
      holderUnitName: r.currentOrg.name,
      custodianName: r.custodian.name,
      details,
      parts: parts.byKind,
      partsTotal: parts.total,
      changedSinceAsked: baseVersions[r.id] !== undefined && baseVersions[r.id] !== r.version,
      removed: false,
    });
  }

  const [targetUnit, targetCustodian] = await Promise.all([
    prisma.orgNode.findUnique({ where: { id: payload.transfer.targetOrgNodeId }, select: { name: true } }),
    payload.transfer.targetCustodianId ? prisma.user.findUnique({ where: { id: payload.transfer.targetCustodianId }, select: { name: true } }) : null,
  ]);

  return {
    movementTitle: MOVEMENT_TITLE[movementOf(payload)],
    items,
    to: {
      place: await placePath(payload.transfer.targetParentId),
      unitName: targetUnit?.name ?? "a removed unit",
      custodianName: targetCustodian?.name ?? null,
      ownershipMoves: Boolean(payload.transfer.transferOwnership),
    },
  };
}

/** Names from the top-level place (lab or store) down to this one. */
async function placePath(itemId: string): Promise<string[]> {
  const chain = await prisma.$queryRaw<{ name: string }[]>`
    WITH RECURSIVE up AS (
      SELECT id, "parentId", name, 0 AS depth FROM "Item" WHERE id = ${itemId}
      UNION ALL
      SELECT i.id, i."parentId", i.name, u.depth + 1 FROM "Item" i INNER JOIN up u ON i.id = u."parentId"
    )
    SELECT name FROM up ORDER BY depth DESC
  `;
  return chain.map((c) => c.name);
}

/** Everything inside an item (at any depth), counted by kind. */
async function partsInside(itemId: string): Promise<{ byKind: { name: string; count: number }[]; total: number }> {
  const rows = await prisma.$queryRaw<{ name: string; count: bigint }[]>`
    WITH RECURSIVE sub AS (
      SELECT id, "categoryId" FROM "Item" WHERE "parentId" = ${itemId} AND "deletedAt" IS NULL
      UNION ALL
      SELECT i.id, i."categoryId" FROM "Item" i INNER JOIN sub s ON i."parentId" = s.id WHERE i."deletedAt" IS NULL
    )
    SELECT c.name, COUNT(*) AS count FROM sub INNER JOIN "ResourceCategory" c ON c.id = sub."categoryId" GROUP BY c.name ORDER BY COUNT(*) DESC, c.name
  `;
  const byKind = rows.map((r) => ({ name: r.name, count: Number(r.count) }));
  return { byKind, total: byKind.reduce((n, k) => n + k.count, 0) };
}

function readable(value: unknown, unit: string | null): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map((v) => readable(v, null)).join(", ");
  if (value && typeof value === "object") return JSON.stringify(value);
  const text = String(value);
  return unit ? `${text} ${unit}` : text;
}
