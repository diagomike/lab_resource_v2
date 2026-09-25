/** Suite B — purchasing: needs → compile → ladder with send-backs → pipeline → receiving. H19–H21. */
import { get, post, check, ev, db, done, uniq, nodeId, S } from "../lib";

const B = "B";
const decide = (a: string, id: string, decision: "APPROVE" | "REJECT" | "REVISE", note?: string) => post(a, `/resources/purchase-requests/${id}/decide`, { decision, note });
const advance = (a: string, id: string, note?: string) => post(a, `/resources/purchase-requests/${id}/advance`, { note });
const pr = (id: string) => db.purchaseRequest.findUniqueOrThrow({ where: { id }, include: { lines: true, events: true, steps: { orderBy: { order: "asc" } } } });

async function catId(key: string) {
  return (await db.resourceCategory.findUniqueOrThrow({ where: { key } })).id;
}

async function main() {
  const se = await nodeId("Software Engineering");
  const mat = await nodeId("Materials Science");
  const [computer, chemical, chair] = await Promise.all([catId("computer"), catId("chemical"), catId("chair")]);
  const mainStore = await db.item.findFirstOrThrow({ where: { name: "ASTU Main Store" } });
  const girmaLab = await db.item.findFirstOrThrow({ where: { name: "SE Lab X — Software Lab 3" } });

  let needId = "";
  await check(B, "B-01", "needs: staff raise one; student refused; only the head lists and declines", async () => {
    const n = await post("staffSe", "/resources/needs", { name: "Oscilloscope", qty: 2, reason: "Signals lab" });
    needId = n.body?.id;
    const student = await post("student", "/resources/needs", { name: "Laptop", qty: 1, reason: "please" });
    const listByHead = await get("headSe", `/resources/needs?node=${se}`);
    const listByCust = await get("custSe", `/resources/needs?node=${se}`);
    const n2 = await post("custSe", "/resources/needs", { name: "Spare mice", qty: 10, reason: "broken" });
    const declineByCust = await post("custSe", `/resources/needs/${n2.body.id}/decline`, { note: "no" });
    const declineByHead = await post("headSe", `/resources/needs/${n2.body.id}/decline`, { note: "Use stock" });
    return { ok: n.status === 200 && student.status === 403 && listByHead.status === 200 && listByCust.status === 403 && declineByCust.status === 403 && declineByHead.status === 200, evidence: { raise: n.status, student: student.status, headLists: listByHead.status, custodianLists: listByCust.status, custodianDeclines: declineByCust.status, headDeclines: declineByHead.status } };
  });

  let reqId = "";
  await check(B, "B-02", "head compiles a request carrying the need; chain = head (self-skipped) → dean → AVP → Procurement", async () => {
    const r = await post("headSe", "/resources/purchase-requests", { orgNodeId: se, title: uniq("E2E PR"), lines: [{ name: "Oscilloscope", qty: 2, categoryId: computer, estimatedUnitCost: 45000, justification: "Signals lab", fromNeedIds: [needId] }, { name: "Ethanol", qty: 20, unit: "L", categoryId: chemical, estimatedUnitCost: 300 }] });
    reqId = r.body?.id;
    const row = await pr(reqId);
    const need = await db.needLine.findUniqueOrThrow({ where: { id: needId } });
    return { ok: r.status === 200 && row.stage === "APPROVING" && need.status === "CARRIED", evidence: { status: r.status, reference: row.reference, chain: row.steps.map((s) => `${s.label} [${s.status}]`), needStatus: need.status } };
  });

  await check(B, "B-03", "custodian cannot compile; head of another unit cannot compile for SE", async () => {
    const cust = await post("custSe", "/resources/purchase-requests", { orgNodeId: se, title: "x", lines: [{ name: "x", qty: 1 }] });
    const other = await post("headChem", "/resources/purchase-requests", { orgNodeId: se, title: "x", lines: [{ name: "x", qty: 1 }] });
    return { ok: cust.status === 403 && other.status === 403, evidence: { custodian: cust.status, otherHead: other.status } };
  });

  await check(B, "B-04", "out-of-turn deciders refused; dean sends back (REVISE); head revises and resubmits; chain restarts", async () => {
    const avpEarly = await decide("avp", reqId, "APPROVE");
    const procEarly = await decide("procurement", reqId, "APPROVE");
    const rev = await decide("deanCoeec", reqId, "REVISE", "Reduce ethanol to 10 L");
    const mid = await pr(reqId);


    const rr = await fetch(`http://localhost:3100/api/resources/purchase-requests/${reqId}`, { method: "PUT", headers: { cookie: `lrms_session=${S.headSe.token}`, "content-type": "application/json" }, body: JSON.stringify({ orgNodeId: se, title: mid.title, lines: [{ name: "Oscilloscope", qty: 2, categoryId: computer, estimatedUnitCost: 45000, fromNeedIds: [needId] }, { name: "Ethanol", qty: 10, unit: "L", categoryId: chemical, estimatedUnitCost: 300 }] }) });
    const firstBody = rr.status >= 300 ? await rr.text() : "";
    // Workaround so later cases can run: resubmit without the carried need link (what the UI cannot do).
    const retry = rr.status >= 300 ? await fetch(`http://localhost:3100/api/resources/purchase-requests/${reqId}`, { method: "PUT", headers: { cookie: `lrms_session=${S.headSe.token}`, "content-type": "application/json" }, body: JSON.stringify({ orgNodeId: se, title: mid.title, lines: [{ name: "Oscilloscope", qty: 2, categoryId: computer, estimatedUnitCost: 45000, fromNeedIds: [] }, { name: "Ethanol", qty: 10, unit: "L", categoryId: chemical, estimatedUnitCost: 300 }] }) }) : null;
    const after = await pr(reqId);
    return { ok: avpEarly.status === 403 && procEarly.status === 403 && rev.status === 200 && mid.stage === "REVISING" && rr.status < 300 && after.stage === "APPROVING", evidence: { avpEarly: avpEarly.status, procurementEarly: procEarly.status, afterRevise: mid.stage, resubmitKeepingCarriedNeed: rr.status, body: firstBody.slice(0, 160), workaroundWithoutNeedLink: retry?.status, afterResubmit: after.stage } };
  });

  await check(B, "B-05", "dean → AVP → procurement approve → ORDER_PLACED; history kept across the send-back", async () => {
    const d1 = await decide("deanCoeec", reqId, "APPROVE");
    const d2 = await decide("avp", reqId, "APPROVE");
    const d3 = await decide("procurement", reqId, "APPROVE", "Order via EGP");
    const row = await pr(reqId);
    return { ok: row.stage === "ORDER_PLACED" && row.events.length >= 5, evidence: { statuses: [d1.status, d2.status, d3.status], stage: row.stage, history: row.events.map((e) => `${e.stage}: ${e.note ?? ""}`) } };
  });

  await check(B, "B-06", "pipeline: only procurement advances; stops at IN_STORE", async () => {
    const byHead = await advance("headSe", reqId);
    const a1 = await advance("procurement", reqId, "Buyer found");
    const a2 = await advance("procurement", reqId, "Shipped");
    const a3 = await advance("procurement", reqId, "Arrived");
    const a4 = await advance("procurement", reqId, "again");
    const row = await pr(reqId);
    return { ok: byHead.status === 403 && [a1, a2, a3].every((x) => x.status === 200) && a4.status === 400 && row.stage === "IN_STORE", evidence: { head: byHead.status, advances: [a1.status, a2.status, a3.status], beyondInStore: a4.status, stage: row.stage } };
  });

  await check(B, "B-07", "visibility and cost: ChemE head 404; SE staff/custodian can read and see estimated unit costs (canSeeCost=false)", async () => {
    const chemHead = await get("headChem", `/resources/purchase-requests/${reqId}`);
    const staff = await get("staffSe", `/resources/purchase-requests/${reqId}`);
    const cust = await get("custSe", `/resources/purchase-requests/${reqId}`);
    const me = await get("custSe", "/auth/me");
    const leaksCost = JSON.stringify(cust.body).includes("45000");
    return { ok: chemHead.status === 404 && !(me.body?.canSeeCost === false && leaksCost), evidence: { chemHead: chemHead.status, staffRead: staff.status, custodianRead: cust.status, custodianCanSeeCost: me.body?.canSeeCost, custodianSeesUnitCost45000: leaksCost } };
  });

  const lines = (await pr(reqId)).lines;
  const scope = lines.find((l) => l.name === "Oscilloscope")!;
  const eth = lines.find((l) => l.name === "Ethanol")!;

  await check(B, "B-08", "receiving guards: custodian refused; into a container the store keeper doesn't hold → 404", async () => {
    const byCust = await post("custSe", `/resources/purchase-requests/${reqId}/receive`, { lineId: scope.id, qty: 1, categoryId: computer, storeParentId: girmaLab.id });
    const foreign = await post("storekeeper", `/resources/purchase-requests/${reqId}/receive`, { lineId: scope.id, qty: 1, categoryId: computer, storeParentId: girmaLab.id });
    return { ok: byCust.status === 403 && foreign.status === 404, evidence: { custodian: byCust.status, storeKeeperIntoForeignLab: foreign.status } };
  });

  await check(B, "B-09", "H21 — receipt category can differ from the line (line: Computer → received as Chair)", async () => {
    const r = await post("storekeeper", `/resources/purchase-requests/${reqId}/receive`, { lineId: scope.id, qty: 1, categoryId: chair, storeParentId: mainStore.id });
    const made = await db.item.findFirst({ where: { parentId: mainStore.id, name: "Oscilloscope", categoryId: chair } });
    return { ok: r.status === 400, evidence: { status: r.status, createdAsChair: !!made }, hypothesis: "H21" };
  });

  await check(B, "B-10", "H21 — concurrent receipts of the same line lose updates (2 × qty 1 in parallel)", async () => {
    const before = Number((await db.purchaseLine.findUniqueOrThrow({ where: { id: eth.id } })).receivedQty ?? 0);
    const [a, b] = await Promise.all([
      post("storekeeper", `/resources/purchase-requests/${reqId}/receive`, { lineId: eth.id, qty: 1, categoryId: chemical, storeParentId: mainStore.id }),
      post("storekeeper", `/resources/purchase-requests/${reqId}/receive`, { lineId: eth.id, qty: 1, categoryId: chemical, storeParentId: mainStore.id }),
    ]);
    const after = Number((await db.purchaseLine.findUniqueOrThrow({ where: { id: eth.id } })).receivedQty ?? 0);
    const items = await db.item.count({ where: { parentId: mainStore.id, name: "Ethanol" } });
    return { ok: after - before === 2, evidence: { statuses: [a.status, b.status], receivedQtyDelta: after - before, ethanolItemsCreated: items }, hypothesis: "H21" };
  });

  await check(B, "B-11", "H21 — over-receipt: ordered 10 L, receive 500 L", async () => {
    const r = await post("storekeeper", `/resources/purchase-requests/${reqId}/receive`, { lineId: eth.id, qty: 500, categoryId: chemical, storeParentId: mainStore.id });
    const line = await db.purchaseLine.findUniqueOrThrow({ where: { id: eth.id } });
    return { ok: r.status === 400 || r.status === 409, evidence: { status: r.status, receivedQty: String(line.receivedQty), orderedQty: String(line.qty) }, hypothesis: "H21" };
  });

  await check(B, "B-12", "finishing the lines closes the request; receiving after CLOSED is refused", async () => {
    const ethRemaining = Number(eth.qty) - Number((await db.purchaseLine.findUniqueOrThrow({ where: { id: eth.id } })).receivedQty ?? 0);
    if (ethRemaining > 0) await post("storekeeper", `/resources/purchase-requests/${reqId}/receive`, { lineId: eth.id, qty: ethRemaining, categoryId: chemical, storeParentId: mainStore.id });
    const remaining = Number(scope.qty) - Number((await db.purchaseLine.findUniqueOrThrow({ where: { id: scope.id } })).receivedQty ?? 0);
    const r = remaining > 0 ? await post("storekeeper", `/resources/purchase-requests/${reqId}/receive`, { lineId: scope.id, qty: remaining, categoryId: computer, storeParentId: mainStore.id }) : null;
    const row = await pr(reqId);
    const again = await post("storekeeper", `/resources/purchase-requests/${reqId}/receive`, { lineId: scope.id, qty: 1, categoryId: computer, storeParentId: mainStore.id });
    const oscs = await db.item.count({ where: { parentId: mainStore.id, name: { startsWith: "Oscilloscope" } } });
    return { ok: row.stage === "CLOSED" && again.status === 409, evidence: { finalReceive: r?.status, stage: row.stage, receiveAfterClose: again.status, oscilloscopeItemsInStore: oscs } };
  });

  await check(B, "B-13", "H21 — a SERIALIZED line may be ordered in fractions (2.5 computers)", async () => {
    const r = await post("headSe", "/resources/purchase-requests", { orgNodeId: se, title: uniq("E2E fraction"), lines: [{ name: "Computer", qty: 2.5, categoryId: computer }] });
    if (r.status === 200) await post("headSe", `/resources/purchase-requests/${r.body.id}/cancel`);
    return { ok: r.status === 400, evidence: { status: r.status }, hypothesis: "H21" };
  });

  await check(B, "B-14", "H19 — a rejected request leaves the needs it carried stuck as CARRIED", async () => {
    const n = await post("custSe", "/resources/needs", { name: "Projector", qty: 1, reason: "Room B509" });
    const r = await post("headSe", "/resources/purchase-requests", { orgNodeId: se, title: uniq("E2E reject"), lines: [{ name: "Projector", qty: 1, fromNeedIds: [n.body.id] }] });
    await decide("deanCoeec", r.body.id, "REJECT", "Not this year");
    const need = await db.needLine.findUniqueOrThrow({ where: { id: n.body.id } });
    const open = await get("headSe", `/resources/needs?node=${se}`);
    const reusable = (open.body ?? []).some((x: any) => x.id === n.body.id);
    return { ok: need.status !== "CARRIED" || reusable, evidence: { needStatusAfterReject: need.status, visibleAsOpenNeed: reusable }, hypothesis: "H19" };
  });

  await check(B, "B-15", "H19 — the raiser can cancel an order that is already ON_DELIVERY", async () => {
    const r = await post("headSe", "/resources/purchase-requests", { orgNodeId: se, title: uniq("E2E cancel late"), lines: [{ name: "Router", qty: 1 }] });
    const id = r.body.id;
    await decide("deanCoeec", id, "APPROVE");
    await decide("avp", id, "APPROVE");
    await decide("procurement", id, "APPROVE");
    await advance("procurement", id);
    await advance("procurement", id);
    const cancel = await post("headSe", `/resources/purchase-requests/${id}/cancel`);
    const row = await pr(id);
    return { ok: cancel.status === 409, evidence: { stageAtCancel: "ON_DELIVERY", cancel: cancel.status, stageAfter: row.stage }, hypothesis: "H19" };
  });

  await check(B, "B-16", "H20 — 4 heads/requests compiled at the same instant: all succeed with unique references", async () => {
    const res = await Promise.all([0, 1, 2, 3].map((i) => post("headSe", "/resources/purchase-requests", { orgNodeId: se, title: uniq(`E2E par ${i}`), lines: [{ name: "Cable", qty: 1 }] })));
    for (const r of res) if (r.status === 200) await post("headSe", `/resources/purchase-requests/${r.body.id}/cancel`);
    return { ok: res.every((r) => r.status === 200), evidence: { statuses: res.map((r) => r.status), errors: res.filter((r) => r.status >= 400).map((r) => r.body?.message) }, hypothesis: "H20" };
  });

  await check(B, "B-17", "H20 — reference numbering after a request row is removed collides", async () => {
    const r1 = await post("headSe", "/resources/purchase-requests", { orgNodeId: se, title: uniq("E2E ref a"), lines: [{ name: "Cable", qty: 1 }] });
    // Simulates any cleanup of an old row (admin DB fix, retention job).
    const oldest = await db.purchaseRequest.findFirstOrThrow({ where: { stage: "CANCELLED" }, orderBy: { createdAt: "asc" } });
    await db.purchaseRequest.delete({ where: { id: oldest.id } });
    const r2 = await post("headSe", "/resources/purchase-requests", { orgNodeId: se, title: uniq("E2E ref b"), lines: [{ name: "Cable", qty: 1 }] });
    return { ok: r2.status === 200, evidence: { first: r1.status, afterDeletingOne: ev(r2) }, hypothesis: "H20" };
  });

  await check(B, "B-18", "concurrent APPROVE + REVISE by the same dean on the same step", async () => {
    const r = await post("headSe", "/resources/purchase-requests", { orgNodeId: se, title: uniq("E2E race decide"), lines: [{ name: "Cable", qty: 1 }] });
    const id = r.body.id;
    const [a, b] = await Promise.all([decide("deanCoeec", id, "APPROVE"), decide("deanCoeec", id, "REVISE", "wait")]);
    const row = await pr(id);
    const deanEvents = row.events.filter((e) => e.byId === S.deanCoeec.id).map((e) => e.stage);
    return { ok: [a.status, b.status].filter((s) => s === 200).length === 1, evidence: { statuses: [a.status, b.status], stage: row.stage, deanEvents, steps: row.steps.map((s) => s.status) } };
  });

  await check(B, "B-19", "multi-parent department: Materials request needs BOTH deans", async () => {
    const r = await post("headMat", "/resources/purchase-requests", { orgNodeId: mat, title: uniq("E2E mat"), lines: [{ name: "Furnace", qty: 1 }] });
    const row = await pr(r.body.id);
    const labels = row.steps.map((s) => s.label);
    await post("headMat", `/resources/purchase-requests/${r.body.id}/cancel`);
    return { ok: r.status === 200 && row.steps.some((s) => s.approverId === S.deanCoeec.id) && row.steps.some((s) => s.approverId === S.deanComcme.id), evidence: { chain: labels } };
  });

  await done();
}

main();
