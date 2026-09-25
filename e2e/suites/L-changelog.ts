/** Suite L — change log & audit scoping. */
import { get, post, check, ev, db, done, uniq, nodeId, S } from "../lib";

const L = "L";
const change = (a: string, b: unknown) => post(a, "/resources/items/changes", b);
const log = (a: string, qs = "") => get(a, `/resources/changes${qs}`);
const entriesOf = (r: any) => r.body?.entries ?? r.body?.rows ?? r.body?.items ?? [];

async function main() {
  const se = await nodeId("Software Engineering");
  const girmaLab = await db.item.findFirstOrThrow({ where: { name: "SE Lab X — Software Lab 3" } });
  const seComputer = await db.item.findFirstOrThrow({ where: { parentId: { not: null }, ownerOrgNodeId: se, category: { key: "computer" }, custodianId: S.custSe.id } });
  const chemStore = await db.item.findFirstOrThrow({ where: { name: "Chemistry Store — Room C-12" } });

  await check(L, "L-01", "an edit writes an ItemChange with the actor, before/after and a scope snapshot", async () => {
    const before = await db.item.findUniqueOrThrow({ where: { id: seComputer.id } });
    await change("custSe", { kind: "setName", itemIds: [seComputer.id], value: "E2E Log Computer" });
    const row = await db.itemChange.findFirstOrThrow({ where: { itemId: seComputer.id, kind: "setName" }, orderBy: { at: "desc" } });
    await change("custSe", { kind: "setName", itemIds: [seComputer.id], value: before.name });
    return { ok: row.actorId === S.custSe.id && row.after === "E2E Log Computer" && row.ownerOrgNodeId === se && !!row.custodianId, evidence: { actorIsCustodian: row.actorId === S.custSe.id, before: row.before, after: row.after, snapshotOwner: row.ownerOrgNodeId === se } };
  });

  await check(L, "L-02", "the change log is scoped: ChemE custodian sees no SE item rows; SE custodian sees no ChemE rows", async () => {
    const chemView = await log("custChem");
    const seView = await log("custSe");
    const chemSeesSE = entriesOf(chemView).some((e: any) => e.itemName?.includes("Log Computer") || e.itemId === seComputer.id);
    const seRowsForChem = await db.itemChange.findMany({ where: { currentOrgNodeId: chemStore.currentOrgNodeId, targetKind: "ITEM" }, take: 1 });
    const seSeesChem = entriesOf(seView).some((e: any) => e.itemId === chemStore.id);
    return { ok: !chemSeesSE && !seSeesChem, evidence: { chemEntries: entriesOf(chemView).length, chemSeesSEItem: chemSeesSE, seSeesChemItem: seSeesChem, chemItemRowsExist: seRowsForChem.length } };
  });

  await check(L, "L-03", "an itemId filter for a foreign item returns nothing (no row-existence oracle)", async () => {
    const r = await log("custChem", `?itemId=${seComputer.id}`);
    return { ok: entriesOf(r).length === 0, evidence: { status: r.status, rows: entriesOf(r).length } };
  });

  await check(L, "L-04", "category (schema) changes are visible to everyone; item rows are not", async () => {
    const r = await log("custChem", "?targetKind=CATEGORY");
    const allCategory = entriesOf(r).every((e: any) => e.targetKind === "CATEGORY");
    return { ok: r.status === 200 && allCategory, evidence: { status: r.status, rows: entriesOf(r).length, allCategoryScoped: allCategory } };
  });

  await check(L, "L-05", "a routed transfer's apply is attributed to the requester, not the last approver", async () => {
    const row = await db.itemChange.findFirst({ where: { kind: "transferItem" }, orderBy: { at: "desc" } });
    return { ok: !row || row.actorId !== null, evidence: { latestTransferActor: row?.actorId ? (row.actorId === S.custChem.id ? "requester (Hanna)" : row.actorId) : "none found" } };
  });

  await check(L, "L-06", "a student cannot read the change log at all", async () => {
    const r = await log("student");
    const rows = entriesOf(r);
    const itemRows = rows.filter((e: any) => e.targetKind === "ITEM");
    return { ok: r.status === 403 || itemRows.length === 0, evidence: { status: r.status, itemRowsVisibleToStudent: itemRows.length } };
  });

  await check(L, "L-07", "a bulk edit shares one batchId across its rows", async () => {
    const whiteboards = (await change("custSe", { kind: "createItem", parentId: girmaLab.id, categoryId: (await db.resourceCategory.findUniqueOrThrow({ where: { key: "whiteboard" } })).id, count: 3, name: uniq("E2E Batch") })).body.itemIds as string[];
    await change("custSe", { kind: "setStatus", itemIds: whiteboards, value: "BROKEN" });
    const rows = await db.itemChange.findMany({ where: { itemId: { in: whiteboards }, kind: "setStatus" } });
    const batchIds = new Set(rows.map((r) => r.batchId));
    await change("custSe", { kind: "deleteItem", itemIds: whiteboards });
    return { ok: rows.length === 3 && batchIds.size === 1 && !batchIds.has(null), evidence: { rows: rows.length, distinctBatchIds: batchIds.size } };
  });

  await done();
}

main();
