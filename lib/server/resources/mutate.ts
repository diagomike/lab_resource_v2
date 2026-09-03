import "server-only";
import { Prisma, type Item as PrismaItem, type PrismaClient } from "@prisma/client";
import type { ItemChangeInput, ItemChangeResultDto } from "@/lib/shared";
import { prisma } from "../prisma";
import { HttpError } from "../http-error";
import { instantiateMany, newId } from "@/lib/domain/instantiate";
import type { Category } from "@/lib/domain/types";
import * as scope from "./scope";
import { validatePropWrite } from "./category-props";
import { toDomainCategoryMap } from "./adapt";

type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

/**
 * The one write door. Ported from temp_works/src/lib/store.ts's `validate` → `apply`
 * → log → bump `version`, inside one transaction — see that file's header comment for
 * why there is exactly one path (an earlier version of it carried two, and roughly
 * two hundred lines of the older one had gone unreachable without anyone noticing).
 *
 * `editCategory` is deliberately NOT handled here — see lib/shared/resources/item.ts's
 * own note: a category edit is categories.ts's `update()`, its own endpoint, not
 * funnelled through this one. It still appears as an ItemChangeKind because the audit
 * log tags a category-edit entry with it (categories.ts writes those rows directly).
 *
 * `requestChange`/`applyOnFinalApproval` (the approval-routed callers, Phase 12 of
 * ~/.claude/plans/wait-i-want-gentle-haven.md) do not exist yet — every call here is a
 * direct edit for now. When they land, they call this exact function with the exact
 * same input, which is the property that makes "a routed-and-approved change produces
 * a record identical to applying it directly" provable.
 */

const DRY_RUN_ABORT = Symbol("dry-run-abort");

/** ItemChange.before/after are nullable Json columns — Prisma represents an actual
 *  JSON `null` write as `Prisma.DbNull`, not the bare TS value `null`. */
function jsonOrNull(v: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return v === null || v === undefined ? Prisma.DbNull : (v as Prisma.InputJsonValue);
}

export async function applyChange(actorId: string, input: ItemChangeInput, opts?: { dryRun?: boolean }): Promise<ItemChangeResultDto> {
  await assertAuthorized(actorId, input);

  let captured: ItemChangeResultDto | undefined;
  try {
    await prisma.$transaction(async (tx) => {
      captured = await performChange(tx, actorId, input);
      if (opts?.dryRun) throw DRY_RUN_ABORT;
    });
  } catch (err) {
    if (err !== DRY_RUN_ABORT) throw err;
  }
  return captured!;
}

/** The preview variant — the same validate→apply path, nothing committed. What
 *  edit-impact previews and a pending request's "what would this do?" both use. */
export function previewChange(actorId: string, input: ItemChangeInput): Promise<ItemChangeResultDto> {
  return applyChange(actorId, input, { dryRun: true });
}

// ── Authorization — WHO may do this. Scope is never re-derived at a call site; see
//    scope.ts's own header. Runs before the transaction opens, against committed
//    state, so a request that fails authorization never pays for one. ──────────────

async function assertAuthorized(actorId: string, input: ItemChangeInput): Promise<void> {
  if (input.kind === "createItem") {
    if (input.parentId) {
      // Direct scope only, not read-only context — seeing a lab because it holds a
      // borrowed item of yours is not permission to file new equipment into it.
      await scope.assertCanWriteItem(actorId, input.parentId);
      return;
    }
    // A root has no existing item to scope-check against — check the chosen owning
    // unit directly against the caller's resolved reach instead. MY_CUSTODY has no
    // node-level reach to check against, so it cannot place a new root at all —
    // adding to an existing lab (parentId given) is the path open to a custodian.
    if (!input.ownerOrgNodeId) throw new HttpError(400, "An owning unit is required for a root resource.");
    const resolved = await scope.resolveScope(actorId);
    const inScope = resolved.mode === "UNIVERSITY" || (resolved.mode === "ORG_SUBTREE" && resolved.visibleNodeIds.includes(input.ownerOrgNodeId));
    if (!inScope) throw new HttpError(404, "Resource not found");
    return;
  }

  const outOfScope = await scope.outOfScopeCount(actorId, input.itemIds);
  // Out-of-scope, not merely unauthorized, gets the same 404 a direct read would —
  // a 403 here would confirm the row exists to someone who cannot otherwise see it.
  if (outOfScope > 0) throw new HttpError(404, "Resource not found");

  // The destination of a move/transfer is a write target too, checked the same
  // direct way as itemIds above — moving your own item somewhere does not require
  // seeing what else is in that container, but it does require more than merely
  // being able to see the container as someone else's read-only context.
  if (input.kind === "moveInTree" && input.value !== null) {
    await scope.assertCanWriteItem(actorId, input.value);
  }
  if (input.kind === "transferItem") {
    await scope.assertCanWriteItem(actorId, input.transfer.targetParentId);
  }
}

// ── The write itself — WHAT happens. ────────────────────────────────────────────────

async function performChange(tx: Tx, actorId: string, input: ItemChangeInput): Promise<ItemChangeResultDto> {
  const at = new Date();
  switch (input.kind) {
    case "createItem":
      return applyCreateItem(tx, actorId, at, input);
    case "deleteItem":
      return applyDeleteItem(tx, actorId, at, input);
    case "transferItem":
      return applyTransferItem(tx, actorId, at, input);
    case "moveInTree":
      return applyMoveInTree(tx, actorId, at, input);
    case "setProperty":
      return applySetProperty(tx, actorId, at, input);
    case "addImage":
      return applyAddImage(tx, actorId, at, input);
    case "removeImage":
      return applyRemoveImage(tx, actorId, at, input);
    default:
      return applyFieldChange(tx, actorId, at, input);
  }
}

async function loadAllCategoriesDomain(tx: Tx): Promise<Record<string, Category>> {
  const rows = await tx.resourceCategory.findMany({
    include: { group: { select: { name: true } }, fields: true, templateAsParent: true },
  });
  return toDomainCategoryMap(rows);
}

function itemCreateData(item: ReturnType<typeof instantiateMany>[number], categories: Record<string, Category>): Prisma.ItemCreateManyInput {
  return {
    id: item.id,
    parentId: item.parentId,
    categoryId: item.categoryId,
    name: item.name,
    countingMode: categories[item.categoryId]?.countingMode ?? "SERIALIZED",
    qty: item.qty,
    status: item.status,
    critical: item.critical,
    props: item.props as Prisma.InputJsonValue,
    ownerOrgNodeId: item.ownerOrgNodeId,
    currentOrgNodeId: item.currentOrgNodeId,
    custodianId: item.custodianId,
    version: item.version,
  };
}

async function applyCreateItem(
  tx: Tx,
  actorId: string,
  at: Date,
  input: Extract<ItemChangeInput, { kind: "createItem" }>,
): Promise<ItemChangeResultDto> {
  const category = await tx.resourceCategory.findUnique({ where: { id: input.categoryId } });
  if (!category) throw new HttpError(400, "Choose an existing category.");
  if (!category.active) throw new HttpError(400, "This category is disabled.");
  if (!Number.isInteger(input.count) || input.count < 1) throw new HttpError(400, "Item count must be a positive whole number.");

  const parent = input.parentId ? await tx.item.findUnique({ where: { id: input.parentId } }) : null;
  if (input.parentId && (!parent || parent.deletedAt)) throw new HttpError(400, "The selected parent no longer exists.");

  const ownerOrgNodeId = input.ownerOrgNodeId ?? parent?.ownerOrgNodeId;
  if (!ownerOrgNodeId) throw new HttpError(400, "A resource must have an owning unit.");
  const currentOrgNodeId = input.currentOrgNodeId ?? parent?.currentOrgNodeId ?? ownerOrgNodeId;
  // A resource must have a custodian; never deferred to after creation.
  const custodianId = input.custodianId ?? parent?.custodianId;
  if (!custodianId) throw new HttpError(400, "A resource must have a custodian.");

  const [ownerNode, currentNode, custodian] = await Promise.all([
    tx.orgNode.findUnique({ where: { id: ownerOrgNodeId } }),
    tx.orgNode.findUnique({ where: { id: currentOrgNodeId } }),
    tx.user.findUnique({ where: { id: custodianId } }),
  ]);
  if (!ownerNode?.active) throw new HttpError(400, "Choose an active owning unit.");
  if (!currentNode?.active) throw new HttpError(400, "Choose an active current unit.");
  if (!custodian) throw new HttpError(400, "Choose an existing custodian.");

  const categories = await loadAllCategoriesDomain(tx);
  const created = instantiateMany(categories, input.categoryId, input.parentId, input.count, {
    ownerOrgNodeId,
    currentOrgNodeId,
    custodianId,
    now: at.toISOString(),
  });
  if (!created.length) throw new HttpError(400, "Nothing to create.");

  await tx.item.createMany({ data: created.map((i) => itemCreateData(i, categories)) });

  const batchId = newId("b");
  const roots = created.filter((i) => i.parentId === input.parentId);
  await tx.itemChange.createMany({
    data: roots.map((item) => ({
      at,
      actorId,
      kind: "createItem" as const,
      targetKind: "ITEM" as const,
      itemId: item.id,
      itemName: item.name,
      categoryId: item.categoryId,
      batchId,
      note: input.note,
    })),
  });

  return { applied: roots.length, itemIds: roots.map((r) => r.id) };
}

/** Every descendant of the given ids, self included, deepest-first — the order a
 *  cascading delete must run in against `Item.parent`'s `onDelete: Restrict`, and
 *  what a subtree move/transfer needs to re-point in one pass. */
async function subtreeDeepestFirst(tx: Tx, rootIds: string[]): Promise<PrismaItem[]> {
  if (!rootIds.length) return [];
  const rows = await tx.$queryRaw<{ id: string; depth: number }[]>`
    WITH RECURSIVE subtree AS (
      SELECT id, 0 AS depth FROM "Item" WHERE id = ANY(${rootIds}) AND "deletedAt" IS NULL
      UNION ALL
      SELECT i.id, s.depth + 1 FROM "Item" i INNER JOIN subtree s ON i."parentId" = s.id WHERE i."deletedAt" IS NULL
    )
    SELECT id, MAX(depth) AS depth FROM subtree GROUP BY id
  `;
  const ids = rows.sort((a, b) => b.depth - a.depth).map((r) => r.id);
  const items = await tx.item.findMany({ where: { id: { in: ids } } });
  const byId = new Map(items.map((i) => [i.id, i]));
  return ids.map((id) => byId.get(id)).filter((i): i is PrismaItem => Boolean(i));
}

async function isWithinSubtree(tx: Tx, ancestorId: string, candidateId: string): Promise<boolean> {
  if (ancestorId === candidateId) return true;
  const subtree = await tx.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE subtree AS (
      SELECT id FROM "Item" WHERE id = ${ancestorId} AND "deletedAt" IS NULL
      UNION ALL
      SELECT i.id FROM "Item" i INNER JOIN subtree s ON i."parentId" = s.id WHERE i."deletedAt" IS NULL
    )
    SELECT id FROM subtree
  `;
  return subtree.some((r) => r.id === candidateId);
}

/**
 * A subtree can contain a descendant outside the actor's own scope — nothing stops
 * one department's item from ending up physically nested inside another's container
 * through ordinary loan/transfer activity (moveInTree only re-points the root being
 * moved; a foreign item already inside it comes along structurally, not by a write
 * to its own row). `deleteItem` and `transferItem` both act on a whole subtree at
 * once, so both must refuse rather than silently sweep up something the actor could
 * never have touched directly. Whole-refusal, not partial — same as a stale category
 * version.
 */
async function assertSubtreeInScope(actorId: string, subtree: PrismaItem[]): Promise<void> {
  if (await scope.outOfScopeCount(actorId, subtree.map((i) => i.id))) {
    throw new HttpError(404, "Resource not found");
  }
}

async function applyDeleteItem(tx: Tx, actorId: string, at: Date, input: Extract<ItemChangeInput, { kind: "deleteItem" }>): Promise<ItemChangeResultDto> {
  const roots = await tx.item.findMany({ where: { id: { in: input.itemIds }, deletedAt: null } });
  if (!roots.length) return { applied: 0, itemIds: [] };

  const doomed = await subtreeDeepestFirst(tx, roots.map((r) => r.id));
  await assertSubtreeInScope(actorId, doomed);
  for (const row of doomed) await tx.item.delete({ where: { id: row.id } });

  const batchId = roots.length > 1 ? newId("b") : undefined;
  await tx.itemChange.createMany({
    data: roots.map((r) => ({
      at,
      actorId,
      kind: "deleteItem" as const,
      targetKind: "ITEM" as const,
      itemId: r.id,
      itemName: r.name,
      categoryId: r.categoryId,
      batchId,
      note: input.note,
    })),
  });
  return { applied: roots.length, itemIds: roots.map((r) => r.id) };
}

async function applyTransferItem(
  tx: Tx,
  actorId: string,
  at: Date,
  input: Extract<ItemChangeInput, { kind: "transferItem" }>,
): Promise<ItemChangeResultDto> {
  const { targetParentId, targetOrgNodeId, targetCustodianId } = input.transfer;
  const [destination, targetNode] = await Promise.all([
    tx.item.findUnique({ where: { id: targetParentId } }),
    tx.orgNode.findUnique({ where: { id: targetOrgNodeId } }),
  ]);
  if (!destination || destination.deletedAt) throw new HttpError(400, "The destination no longer exists.");
  if (!targetNode?.active) throw new HttpError(400, "Choose a receiving unit.");
  if (targetCustodianId) {
    const custodian = await tx.user.findUnique({ where: { id: targetCustodianId } });
    if (!custodian) throw new HttpError(400, "Choose an existing custodian.");
  }

  const roots = await tx.item.findMany({ where: { id: { in: input.itemIds }, deletedAt: null } });
  const applied: string[] = [];
  const batchId = roots.length > 1 ? newId("b") : undefined;

  for (const root of roots) {
    if (root.id === targetParentId || (await isWithinSubtree(tx, root.id, targetParentId))) {
      continue; // a resource cannot be moved inside itself — skipped, not an abort
    }
    const subtree = await subtreeDeepestFirst(tx, [root.id]);
    await assertSubtreeInScope(actorId, subtree);
    for (const node of subtree) {
      await tx.item.update({
        where: { id: node.id },
        data: {
          parentId: node.id === root.id ? targetParentId : node.parentId,
          currentOrgNodeId: targetOrgNodeId,
          custodianId: targetCustodianId ?? node.custodianId,
          version: { increment: 1 },
        },
      });
    }
    const fromName = root.parentId ? ((await tx.item.findUnique({ where: { id: root.parentId } }))?.name ?? "top level") : "top level";
    await tx.itemChange.create({
      data: {
        at,
        actorId,
        kind: "transferItem",
        targetKind: "ITEM",
        itemId: root.id,
        itemName: root.name,
        categoryId: root.categoryId,
        field: "parentId",
        before: fromName,
        after: destination.name,
        batchId,
        note: input.note,
      },
    });
    applied.push(root.id);
  }

  return { applied: applied.length, itemIds: applied };
}

async function applyMoveInTree(tx: Tx, actorId: string, at: Date, input: Extract<ItemChangeInput, { kind: "moveInTree" }>): Promise<ItemChangeResultDto> {
  let target: PrismaItem | null = null;
  if (input.value !== null) {
    target = await tx.item.findUnique({ where: { id: input.value } });
    if (!target || target.deletedAt) throw new HttpError(400, "Choose an existing destination.");
  }

  const roots = await tx.item.findMany({ where: { id: { in: input.itemIds }, deletedAt: null } });
  const applied: string[] = [];
  const batchId = roots.length > 1 ? newId("b") : undefined;

  for (const root of roots) {
    if (target) {
      if (target.id === root.id || (await isWithinSubtree(tx, root.id, target.id))) continue; // skipped, not an abort
    }
    if (root.parentId === (target?.id ?? null)) continue; // no-op

    await tx.item.update({ where: { id: root.id }, data: { parentId: target?.id ?? null, version: { increment: 1 } } });
    await tx.itemChange.create({
      data: {
        at,
        actorId,
        kind: "moveInTree",
        targetKind: "ITEM",
        itemId: root.id,
        itemName: root.name,
        categoryId: root.categoryId,
        field: "parentId",
        before: jsonOrNull(root.parentId),
        after: jsonOrNull(target?.id ?? null),
        batchId,
        note: input.note,
      },
    });
    applied.push(root.id);
  }

  return { applied: applied.length, itemIds: applied };
}

async function applySetProperty(tx: Tx, actorId: string, at: Date, input: Extract<ItemChangeInput, { kind: "setProperty" }>): Promise<ItemChangeResultDto> {
  const items = await tx.item.findMany({ where: { id: { in: input.itemIds }, deletedAt: null } });
  const categoryIds = [...new Set(items.map((i) => i.categoryId))];
  const fields = await tx.categoryField.findMany({ where: { categoryId: { in: categoryIds } } });
  const fieldsByCategory = new Map<string, Map<string, (typeof fields)[number]>>();
  for (const f of fields) {
    if (!fieldsByCategory.has(f.categoryId)) fieldsByCategory.set(f.categoryId, new Map());
    fieldsByCategory.get(f.categoryId)!.set(f.key, f);
  }

  const applied: string[] = [];
  const batchId = items.length > 1 ? newId("b") : undefined;
  for (const item of items) {
    // Every selected item must actually define the property — a bulk edit spanning
    // two categories that happen to share a key must not silently write a value one
    // of them cannot hold. A thrown HttpError here aborts the whole transaction, so
    // no partial bulk write survives a bad item.
    const field = fieldsByCategory.get(item.categoryId)?.get(input.propKey);
    const validated = validatePropWrite(field, input.value);
    const before = (item.props as Record<string, unknown>)?.[input.propKey] ?? null;
    if (before === validated) continue; // no-op
    const nextProps = { ...(item.props as Record<string, unknown>), [input.propKey]: validated };
    await tx.item.update({ where: { id: item.id }, data: { props: nextProps as Prisma.InputJsonValue, version: { increment: 1 } } });
    await tx.itemChange.create({
      data: {
        at,
        actorId,
        kind: "setProperty",
        targetKind: "ITEM",
        itemId: item.id,
        itemName: item.name,
        categoryId: item.categoryId,
        field: input.propKey,
        before: jsonOrNull(before),
        after: jsonOrNull(validated),
        batchId,
        note: input.note,
      },
    });
    applied.push(item.id);
  }
  return { applied: applied.length, itemIds: applied };
}

async function applyAddImage(tx: Tx, actorId: string, at: Date, input: Extract<ItemChangeInput, { kind: "addImage" }>): Promise<ItemChangeResultDto> {
  const item = await tx.item.findUnique({ where: { id: input.itemIds[0] } });
  if (!item || item.deletedAt) throw new HttpError(400, "That resource no longer exists.");

  const image = await tx.itemImage.create({
    data: {
      itemId: item.id,
      storageKey: input.storageKey,
      contentType: input.contentType,
      byteSize: input.byteSize,
      width: input.width,
      height: input.height,
      caption: input.caption,
      uploadedById: actorId,
    },
  });
  await tx.item.update({ where: { id: item.id }, data: { version: { increment: 1 } } });
  await tx.itemChange.create({
    data: {
      at,
      actorId,
      kind: "addImage",
      targetKind: "ITEM",
      itemId: item.id,
      itemName: item.name,
      categoryId: item.categoryId,
      after: image.caption ?? "photo",
      note: input.note,
    },
  });
  return { applied: 1, itemIds: [item.id] };
}

async function applyRemoveImage(tx: Tx, actorId: string, at: Date, input: Extract<ItemChangeInput, { kind: "removeImage" }>): Promise<ItemChangeResultDto> {
  const item = await tx.item.findUnique({ where: { id: input.itemIds[0] } });
  if (!item || item.deletedAt) throw new HttpError(400, "That resource no longer exists.");
  const image = await tx.itemImage.findUnique({ where: { id: input.imageId } });
  if (!image || image.itemId !== item.id) throw new HttpError(400, "That photo is not on this resource.");

  await tx.itemImage.delete({ where: { id: image.id } });
  await tx.item.update({ where: { id: item.id }, data: { version: { increment: 1 } } });
  await tx.itemChange.create({
    data: {
      at,
      actorId,
      kind: "removeImage",
      targetKind: "ITEM",
      itemId: item.id,
      itemName: item.name,
      categoryId: item.categoryId,
      before: image.caption ?? "photo",
      note: input.note,
    },
  });
  return { applied: 1, itemIds: [item.id] };
}

/** setName / setStatus / setQuantity / setCustodian / setOwnerOrg / setCurrentOrg —
 *  the same "one field, one value, applied to every id" shape temp_works' `apply()`
 *  handles through `fieldForKind`. */
async function applyFieldChange(
  tx: Tx,
  actorId: string,
  at: Date,
  input: Extract<ItemChangeInput, { kind: "setName" | "setStatus" | "setQuantity" | "setCustodian" | "setOwnerOrg" | "setCurrentOrg" }>,
): Promise<ItemChangeResultDto> {
  const field = FIELD_FOR_KIND[input.kind];
  const items = await tx.item.findMany({ where: { id: { in: input.itemIds }, deletedAt: null } });

  if (input.kind === "setCustodian") {
    const custodian = await tx.user.findUnique({ where: { id: input.value } });
    if (!custodian) throw new HttpError(400, "Choose an existing custodian.");
  }
  if (input.kind === "setOwnerOrg" || input.kind === "setCurrentOrg") {
    const node = await tx.orgNode.findUnique({ where: { id: input.value } });
    if (!node?.active) throw new HttpError(400, "Choose an organization unit.");
  }

  const applied: string[] = [];
  const batchId = items.length > 1 ? newId("b") : undefined;
  for (const item of items) {
    if (input.kind === "setQuantity" && item.countingMode === "SERIALIZED" && input.value !== 1) {
      throw new HttpError(400, "Serialized items always have a quantity of 1.");
    }
    // qty is a Prisma.Decimal, never === the plain number the wire input carries —
    // normalise both sides to a number before comparing, or a setQuantity to the
    // already-current value would never be recognised as a no-op.
    const before: unknown = input.kind === "setQuantity" ? item.qty.toNumber() : (item as unknown as Record<string, unknown>)[field];
    if (before === input.value) continue; // no-op
    const value = input.kind === "setQuantity" ? new Prisma.Decimal(input.value) : input.value;

    await tx.item.update({ where: { id: item.id }, data: { [field]: value, version: { increment: 1 } } });
    await tx.itemChange.create({
      data: {
        at,
        actorId,
        kind: input.kind,
        targetKind: "ITEM",
        itemId: item.id,
        itemName: item.name,
        categoryId: item.categoryId,
        field,
        before: jsonOrNull(before),
        after: jsonOrNull(input.value),
        batchId,
        note: input.note,
      },
    });
    applied.push(item.id);
  }
  return { applied: applied.length, itemIds: applied };
}

const FIELD_FOR_KIND: Record<"setName" | "setStatus" | "setQuantity" | "setCustodian" | "setOwnerOrg" | "setCurrentOrg", string> = {
  setName: "name",
  setStatus: "status",
  setQuantity: "qty",
  setCustodian: "custodianId",
  setOwnerOrg: "ownerOrgNodeId",
  setCurrentOrg: "currentOrgNodeId",
};
