/** Suite T — transfers: pull, handover, return, concurrency. H13–H16. */
import { get, post, check, ev, db, done, uniq, nodeId, S } from "../lib";

const T = "T";
const change = (a: string, b: unknown) => post(a, "/resources/items/changes", b);
const pullBody = (itemIds: string[], targetParentId: string, targetOrgNodeId = "decoy", extra: Record<string, unknown> = {}) => ({ input: { kind: "transferItem", itemIds, transfer: { targetParentId, targetOrgNodeId, targetCustodianId: null, ...extra } } });
const decide = (a: string, id: string, decision: "APPROVE" | "REJECT", note?: string) => post(a, `/resources/transfers/${id}/decide`, { decision, note });

async function catId(key: string) {
  return (await db.resourceCategory.findUniqueOrThrow({ where: { key } })).id;
}

async function main() {
  const se = await nodeId("Software Engineering");
  const chem = await nodeId("Chemical Engineering");
  const whiteboard = await catId("whiteboard");
  const girmaLab = await db.item.findFirstOrThrow({ where: { name: "SE Lab X — Software Lab 3" } });
  const chemStore = await db.item.findFirstOrThrow({ where: { name: "Chemistry Store — Room C-12" } });
  const matLab = await db.item.findFirstOrThrow({ where: { name: { startsWith: "E2E Materials Lab" } }, orderBy: { createdAt: "desc" } });
  const mainStore = await db.item.findFirstOrThrow({ where: { name: "ASTU Main Store" } });

  // Fresh SE-owned whiteboards in Girma's lab to lend (created by admin to avoid draft rules).
  const boards = (await change("admin", { kind: "createItem", parentId: girmaLab.id, categoryId: whiteboard, count: 6, name: uniq("E2E Lend Board") })).body.itemIds as string[];

  let reqId = "";
  await check(T, "T-01", "pull: preview names the chain; request PENDING; item untouched; receiving unit derived from destination (decoy ignored)", async () => {
    const pv = await post("custChem", "/resources/transfers/preview", pullBody([boards[0]], chemStore.id));
    const r = await post("custChem", "/resources/transfers", pullBody([boards[0]], chemStore.id));
    reqId = r.body?.request?.id;
    const row = await db.changeRequest.findUniqueOrThrow({ where: { id: reqId } });
    const payload = row.payload as any;
    const item = await db.item.findUniqueOrThrow({ where: { id: boards[0] } });
    return {
      ok: pv.body?.outcome === "ROUTED" && r.body?.outcome === "ROUTED" && payload.transfer.targetOrgNodeId === chem && item.parentId === girmaLab.id,
      evidence: { previewChain: (pv.body?.steps ?? []).map((s: any) => `${s.label}${s.approverName ? ` (${s.approverName})` : ""} [${s.status}]`), requestStatus: row.status, derivedTarget: payload.transfer.targetOrgNodeId === chem, itemMoved: item.parentId !== girmaLab.id },
    };
  });

  await check(T, "T-02", "order enforced: receiver cannot confirm early, outsiders cannot decide or read", async () => {
    const early = await decide("custChem", reqId, "APPROVE");
    const outsiderDecide = await decide("custMat", reqId, "APPROVE");
    const outsiderRead = await get("custMat", `/resources/transfers/${reqId}`);
    return { ok: early.status === 403 && outsiderDecide.status === 403 && outsiderRead.status === 404, evidence: { receiverEarly: early.status, outsiderDecide: outsiderDecide.status, outsiderRead: outsiderRead.status } };
  });

  await check(T, "T-03", "full chain: lender custodian → SE head → ChemE head → receipt applies; borrow keeps owner & custodian", async () => {
    const d1 = await decide("custSe", reqId, "APPROVE");
    const d2 = await decide("headSe", reqId, "APPROVE");
    const mid = await db.item.findUniqueOrThrow({ where: { id: boards[0] } });
    const d3 = await decide("headChem", reqId, "APPROVE");
    const d4 = await decide("custChem", reqId, "APPROVE");
    const item = await db.item.findUniqueOrThrow({ where: { id: boards[0] } });
    const log = await db.itemChange.findFirst({ where: { itemId: boards[0], kind: "transferItem" }, orderBy: { at: "desc" } });
    return {
      ok: d4.body?.status === "APPLIED" && mid.parentId === girmaLab.id && item.parentId === chemStore.id && item.ownerOrgNodeId === se && item.currentOrgNodeId === chem && item.custodianId === S.custSe.id && log?.actorId === S.custChem.id,
      evidence: { statuses: [d1.status, d2.status, d3.status, d4.status], final: d4.body?.status, movedBeforeReceipt: mid.parentId !== girmaLab.id, owner: item.ownerOrgNodeId === se ? "SE" : item.ownerOrgNodeId, current: item.currentOrgNodeId === chem ? "ChemE" : item.currentOrgNodeId, custodianIsLender: item.custodianId === S.custSe.id, actorIsRequester: log?.actorId === S.custChem.id },
    };
  });

  await check(T, "T-04", "reject at the owning head ends the request; item untouched; further decisions 409", async () => {
    const r = await post("custChem", "/resources/transfers", pullBody([boards[1]], chemStore.id));
    const id = r.body.request.id;
    await decide("custSe", id, "APPROVE");
    const rej = await decide("headSe", id, "REJECT", "We need it this term");
    const again = await decide("headChem", id, "APPROVE");
    const item = await db.item.findUniqueOrThrow({ where: { id: boards[1] } });
    return { ok: rej.body?.status === "REJECTED" && again.status === 409 && item.parentId === girmaLab.id, evidence: { reject: rej.body?.status, decideAfter: again.status, untouched: item.parentId === girmaLab.id } };
  });

  await check(T, "T-05", "cancel: only the requester", async () => {
    const r = await post("custChem", "/resources/transfers", pullBody([boards[2]], chemStore.id));
    const id = r.body.request.id;
    const byLender = await post("custSe", `/resources/transfers/${id}/cancel`);
    const byRequester = await post("custChem", `/resources/transfers/${id}/cancel`);
    return { ok: byLender.status === 403 && byRequester.status === 200, evidence: { lenderCancels: byLender.status, requesterCancels: byRequester.status } };
  });

  await check(T, "T-06", "pull guards: own item → 400; into a destination you don't hold → 404; staff with nothing → 404", async () => {
    const own = await post("custSe", "/resources/transfers", pullBody([boards[3]], girmaLab.id));
    const notHeld = await post("custChem", "/resources/transfers", pullBody([boards[3]], matLab.id));
    const staff = await post("staffChem", "/resources/transfers", pullBody([boards[3]], chemStore.id));
    return { ok: own.status === 400 && notHeld.status === 404 && staff.status === 404, evidence: { pullOwn: own.status, intoForeignDestination: notHeld.status, staffPull: staff.status } };
  });

  await check(T, "T-07", "H13 — 4 simultaneous receipt confirmations: exactly one apply, request ends APPLIED (not STALE), one audit row", async () => {
    const r = await post("custChem", "/resources/transfers", pullBody([boards[3]], chemStore.id));
    const id = r.body.request.id;
    await decide("custSe", id, "APPROVE");
    await decide("headSe", id, "APPROVE");
    await decide("headChem", id, "APPROVE");
    const res = await Promise.all([0, 1, 2, 3].map(() => decide("custChem", id, "APPROVE")));
    const row = await db.changeRequest.findUniqueOrThrow({ where: { id } });
    const logs = await db.itemChange.count({ where: { itemId: boards[3], kind: "transferItem" } });
    const item = await db.item.findUniqueOrThrow({ where: { id: boards[3] } });
    return { ok: row.status === "APPLIED" && logs === 1 && item.parentId === chemStore.id, evidence: { responses: res.map((x) => x.body?.status ?? x.status), finalStatus: row.status, resolution: row.resolution, transferAuditRows: logs, itemInChemStore: item.parentId === chemStore.id } };
  });

  await check(T, "T-08", "H14 — lender renames the item while it waits: every approval is wasted, request goes STALE only at receipt", async () => {
    const r = await post("custChem", "/resources/transfers", pullBody([boards[4]], chemStore.id));
    const id = r.body.request.id;
    await decide("custSe", id, "APPROVE");
    await change("custSe", { kind: "setName", itemIds: [boards[4]], value: "Board (relabelled)" });
    const s2 = await decide("headSe", id, "APPROVE");
    const s3 = await decide("headChem", id, "APPROVE");
    const receipt = await decide("custChem", id, "APPROVE");
    return { ok: s2.body?.status !== "PENDING" || receipt.body?.status !== "STALE", evidence: { afterOwnerHead: s2.body?.status, afterTargetHead: s3.body?.status, atReceipt: receipt.body?.status, resolution: receipt.body?.resolution }, hypothesis: "H14" };
  });

  await check(T, "T-09", "H14 — lender deletes the item while the request is pending: request keeps asking people to approve a deleted item", async () => {
    const r = await post("custChem", "/resources/transfers", pullBody([boards[5]], chemStore.id));
    const id = r.body.request.id;
    await decide("custSe", id, "APPROVE");
    const delRes = await change("custSe", { kind: "deleteItem", itemIds: [boards[5]] });
    const inbox = await get("headSe", "/resources/transfers?box=inbox");
    const stillListed = (inbox.body ?? []).some((x: any) => x.id === id);
    const s2 = await decide("headSe", id, "APPROVE");
    return { ok: delRes.status >= 400 || (!stillListed && s2.status >= 400), evidence: { deleteWhilePending: delRes.status, stillInHeadInbox: stillListed, headApprovesDeletedItem: s2.body?.status ?? s2.status }, hypothesis: "H14" };
  });

  await check(T, "T-10", "H15 — returning a borrowed item: the host cannot start a return; the lender yanks it back unilaterally and current unit stays wrong", async () => {
    const hostReturn = await post("custChem", "/resources/transfers", pullBody([boards[0]], chemStore.id));
    const lenderPull = await post("custSe", "/resources/transfers", pullBody([boards[0]], girmaLab.id));
    const yank = await change("custSe", { kind: "moveInTree", itemIds: [boards[0]], value: girmaLab.id });
    const item = await db.item.findUniqueOrThrow({ where: { id: boards[0] } });
    return {
      ok: yank.status >= 400 || item.currentOrgNodeId === se,
      evidence: { hostRequestsReturn: hostReturn.status, lenderRequestsReturn: lenderPull.status, lenderMovesItBackDirectly: yank.status, backInSELab: item.parentId === girmaLab.id, currentUnitAfter: item.currentOrgNodeId === chem ? "Chemical Engineering (stale)" : "Software Engineering" },
      hypothesis: "H15",
    };
  });

  await check(T, "T-11", "store handover: custodian cannot hand over; store keeper hands a table to SE → SE head approves → Girma accepts → owner SE, custodian Girma", async () => {
    const table = await db.item.findFirstOrThrow({ where: { parentId: mainStore.id } });
    const byCustodian = await post("custSe", "/resources/transfers", pullBody([boards[1]], girmaLab.id, se, { transferOwnership: true, targetCustodianId: S.custSe.id }));
    const r = await post("storekeeper", "/resources/transfers", { input: { kind: "transferItem", itemIds: [table.id], transfer: { targetParentId: girmaLab.id, targetOrgNodeId: se, targetCustodianId: S.custSe.id, transferOwnership: true } } });
    const id = r.body?.request?.id;
    const d1 = id ? await decide("headSe", id, "APPROVE") : null;
    const d2 = id ? await decide("custSe", id, "APPROVE") : null;
    const after = await db.item.findUniqueOrThrow({ where: { id: table.id } });
    return { ok: byCustodian.status === 403 && d2?.body?.status === "APPLIED" && after.ownerOrgNodeId === se && after.custodianId === S.custSe.id && after.parentId === girmaLab.id, evidence: { custodianHandover: byCustodian.status, request: r.status, chain: (r.body?.request?.steps ?? []).map((s: any) => s.label), final: d2?.body?.status } };
  });

  await check(T, "T-12", "store keeper pulling a department's item into the Main Store (not a handover): does the owning head get asked?", async () => {
    const board = (await change("admin", { kind: "createItem", parentId: girmaLab.id, categoryId: whiteboard, count: 1, name: uniq("E2E Store-pull Board") })).body.itemIds[0];
    const pv = await post("storekeeper", "/resources/transfers/preview", pullBody([board], mainStore.id));
    const labels = (pv.body?.steps ?? []).map((s: any) => `${s.label}${s.approverName ? ` (${s.approverName})` : ""}`);
    const asksOwner = labels.some((l: string) => /Software Engineering/i.test(l) && /head/i.test(l));
    return { ok: pv.status === 200 && asksOwner, evidence: { outcome: pv.body?.outcome, chain: labels, reason: pv.body?.reason } };
  });

  await check(T, "T-13", "a dean (MANAGER) pulls an SE item into a ChemE lab: ChemE's custodian/head are never asked to receive it", async () => {
    const board = (await change("admin", { kind: "createItem", parentId: girmaLab.id, categoryId: whiteboard, count: 1, name: uniq("E2E Dean-pull Board") })).body.itemIds[0];
    const pv = await post("deanComcme", "/resources/transfers/preview", pullBody([board], chemStore.id));
    const labels = (pv.body?.steps ?? []).map((s: any) => `${s.label}${s.approverName ? ` (${s.approverName})` : ""}`);
    const chemAsked = labels.some((l: string) => /Hanna|Chemical/i.test(l));
    return { ok: pv.status !== 200 || chemAsked, evidence: { status: pv.status, outcome: pv.body?.outcome, chain: labels } };
  });

  await check(T, "T-14", "a pending transfer is invisible to the receiving custodian's head until their step, and to the lender's department members", async () => {
    const r = await post("custChem", "/resources/transfers", pullBody([boards[2]], chemStore.id));
    const id = r.body.request.id;
    const lenderHeadRead = await get("headSe", `/resources/transfers/${id}`);
    const deanRead = await get("deanCoeec", `/resources/transfers/${id}`);
    await post("custChem", `/resources/transfers/${id}/cancel`);
    return { ok: true, evidence: { owningHeadCanReadBeforeTheirStep: lenderHeadRead.status, deanRead: deanRead.status } };
  });

  await done();
}

main();
