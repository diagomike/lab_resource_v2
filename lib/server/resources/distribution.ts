import "server-only";
import type { DistributeInput, DistributeResultDto, DistributionDto, DistributionLabDto } from "@/lib/shared";
import { prisma } from "../prisma";
import { HttpError } from "../http-error";
import * as scope from "./scope";
import { requestTransfer } from "./approvals";

/**
 * Distribute from the store (2026-10-02): the store keeper sends what is in the stores
 * they keep to the labs. Suggestions come from the lab needs a purchase answered (each
 * need names its lab; the purchase line its kind), matched to free stock of that kind;
 * anything else is picked by hand. Every send is an ordinary store handover
 * (approvals.ts, STORE_OUT: Property Administration approves, the lab's custodian
 * accepts), so the register, history and approvals stay the single path.
 */

async function assertKeeper(actorId: string): Promise<void> {
  const roles = await scope.rolesOf(actorId);
  if (!roles.includes("STORE_KEEPER") && !roles.includes("SYS_ADMIN")) throw new HttpError(403, "Only the store keeper sends stock from the store.");
}

/** Items named in a pending transfer — promised already, so not offered again. */
async function promisedItemIds(): Promise<Set<string>> {
  const pending = await prisma.changeRequest.findMany({ where: { status: "PENDING" }, select: { baseVersions: true } });
  return new Set(pending.flatMap((r) => Object.keys((r.baseVersions ?? {}) as Record<string, number>)));
}

/** Needs a store send has delivered or is delivering (`transfer.forNeedIds`). */
async function sentNeedIds(): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT DISTINCT jsonb_array_elements_text(payload->'transfer'->'forNeedIds') AS id
    FROM "ChangeRequest" WHERE status IN ('PENDING', 'APPLIED') AND jsonb_typeof(payload->'transfer'->'forNeedIds') = 'array'
  `;
  return new Set(rows.map((r) => r.id));
}

export async function distributionFor(actorId: string): Promise<DistributionDto> {
  await assertKeeper(actorId);
  const stores = await prisma.item.findMany({
    where: { custodianId: actorId, parentId: null, deletedAt: null, category: { key: "store" } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const promised = await promisedItemIds();
  // Free stock: what sits directly in the keeper's stores, working, held by them, not promised.
  const stockRows = stores.length
    ? await prisma.item.findMany({
        where: { parentId: { in: stores.map((s) => s.id) }, deletedAt: null, custodianId: actorId, status: "WORKING" },
        select: { id: true, name: true, categoryId: true, category: { select: { name: true, countingMode: true } } },
        orderBy: { name: "asc" },
      })
    : [];
  const free = stockRows.filter((i) => !promised.has(i.id));
  const byCategory = new Map<string, typeof free>();
  for (const i of free) byCategory.set(i.categoryId, [...(byCategory.get(i.categoryId) ?? []), i]);

  // Needs a purchase answered that has reached the store, for a lab, not sent yet.
  const sent = await sentNeedIds();
  const needs = await prisma.needLine.findMany({
    where: {
      status: "CARRIED",
      labItemId: { not: null },
      purchaseLine: { purchase: { stage: { in: ["IN_STORE", "CLOSED"] } } },
    },
    include: {
      lab: { select: { id: true, name: true, deletedAt: true, ownerOrg: { select: { name: true } }, custodian: { select: { name: true } } } },
      purchaseLine: { select: { categoryId: true, category: { select: { name: true, countingMode: true } }, purchase: { select: { reference: true } } } },
      category: { select: { id: true, name: true, countingMode: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const taken = new Set<string>();
  const groups = new Map<string, DistributionDto["suggestions"][number]>();
  for (const n of needs) {
    if (sent.has(n.id) || !n.lab || n.lab.deletedAt) continue;
    const categoryId = n.purchaseLine?.categoryId ?? n.categoryId;
    const category = n.purchaseLine?.category ?? n.category;
    const bulk = category?.countingMode === "BULK";
    const qty = Number(n.qty);
    const pool = (categoryId ? (byCategory.get(categoryId) ?? []) : []).filter((i) => !taken.has(i.id));
    const proposed = bulk ? [] : pool.slice(0, Math.max(0, Math.round(qty)));
    for (const i of proposed) taken.add(i.id);
    const lab: DistributionLabDto = { id: n.lab.id, name: n.lab.name, unitName: n.lab.ownerOrg.name, custodianName: n.lab.custodian.name };
    const group = groups.get(lab.id) ?? { lab, lines: [] };
    group.lines.push({
      needId: n.id,
      name: n.name,
      qty,
      categoryId: categoryId ?? null,
      categoryName: category?.name ?? null,
      purchaseReference: n.purchaseLine?.purchase.reference ?? null,
      items: [...proposed, ...pool.filter((i) => !proposed.includes(i)).slice(0, 50)].map((i) => ({ id: i.id, name: i.name })),
      bulk,
    });
    groups.set(lab.id, group);
  }

  const labs = await prisma.item.findMany({
    where: { parentId: null, deletedAt: null, category: { isPlace: true, key: { not: "store" } } },
    select: { id: true, name: true, ownerOrg: { select: { name: true } }, custodian: { select: { name: true } } },
    orderBy: { name: "asc" },
  });

  return {
    stores,
    suggestions: [...groups.values()],
    stock: [...byCategory.entries()]
      .map(([categoryId, items]) => ({ categoryId, categoryName: items[0].category.name, items: items.map((i) => ({ id: i.id, name: i.name })) }))
      .sort((a, b) => a.categoryName.localeCompare(b.categoryName)),
    labs: labs.map((l) => ({ id: l.id, name: l.name, unitName: l.ownerOrg.name, custodianName: l.custodian.name })),
  };
}

/** One store handover per lab, each through the ordinary transfer path. A send that is
 *  refused (an item promised meanwhile, a lab whose custodian can't hold it) is
 *  reported and the others go ahead. */
export async function distribute(actorId: string, input: DistributeInput): Promise<DistributeResultDto> {
  await assertKeeper(actorId);
  const results: DistributeResultDto["results"] = [];
  for (const send of input.sends) {
    const lab = await prisma.item.findUnique({ where: { id: send.labId }, select: { id: true, parentId: true, deletedAt: true, currentOrgNodeId: true, custodianId: true, category: { select: { isPlace: true } } } });
    if (!lab || lab.deletedAt || lab.parentId || !lab.category.isPlace) {
      results.push({ labId: send.labId, ok: false, summary: null, error: "That lab no longer exists." });
      continue;
    }
    try {
      const r = await requestTransfer(actorId, {
        kind: "transferItem",
        itemIds: send.itemIds,
        note: send.note,
        transfer: {
          targetParentId: lab.id,
          targetOrgNodeId: lab.currentOrgNodeId,
          targetCustodianId: lab.custodianId,
          transferOwnership: true,
          ...(send.renameAs ? { renameAs: send.renameAs } : {}),
          ...(send.needIds?.length ? { forNeedIds: send.needIds } : {}),
        },
      });
      results.push({ labId: lab.id, ok: true, summary: r.outcome === "ROUTED" ? r.request.summary : "Sent and applied at once.", error: null });
    } catch (err) {
      results.push({ labId: lab.id, ok: false, summary: null, error: err instanceof HttpError ? err.message : "This send could not be made." });
    }
  }
  return { results };
}
