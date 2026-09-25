/** Suite D — lab Drafts and Ideals as whole trees (2026-09-22 rework; Materials Science, a
 *  clean department). Same check ids as before, restated for the new model: register edits
 *  are STAGED into the lab's Draft when the department uses drafts; a head only decides. */
import { get, post, check, ev, db, done, uniq, nodeId, S } from "../lib";

const D = "D";
const change = (a: string, b: unknown) => post(a, "/resources/items/changes", b);
const op = (a: string, lab: string, kind: "draft" | "ideal", b: unknown) => post(a, `/resources/labs/${lab}/versions/${kind}/ops`, b);
const act = (a: string, lab: string, kind: "draft" | "ideal", action: string) => post(a, `/resources/labs/${lab}/versions/${kind}/${action}`);
const decide = (a: string, id: string, decision: "APPROVE" | "REJECT", note?: string) => post(a, `/resources/lab-commits/${id}/decide`, { decision, note });

async function catId(key: string) {
  return (await db.resourceCategory.findUniqueOrThrow({ where: { key } })).id;
}

async function main() {
  const mat = await nodeId("Materials Science");
  const se = await nodeId("Software Engineering");
  const [labCat, computer, chair, whiteboard] = await Promise.all([catId("lab"), catId("computer"), catId("chair"), catId("whiteboard")]);

  // Setup (direct, before draft mode): a Materials lab with 2 chairs and a whiteboard.
  const labRes = await change("custMat", { kind: "createItem", parentId: null, categoryId: labCat, count: 1, ownerOrgNodeId: mat, custodianId: S.custMat.id, name: uniq("E2E Materials Lab") });
  const lab = labRes.body.itemIds[0];
  const chairs = (await change("custMat", { kind: "createItem", parentId: lab, categoryId: chair, count: 2 })).body.itemIds as string[];
  const wb = (await change("custMat", { kind: "createItem", parentId: lab, categoryId: whiteboard, count: 1 })).body.itemIds[0] as string;

  await check(D, "D-01", "H18 — an ideal can be proposed for a department that is not in draft mode", async () => {
    const r = await act("custMat", lab, "ideal", "start");
    return { ok: r.status === 200, evidence: ev(r), hypothesis: "H18" };
  });

  await check(D, "D-02", "enable draft mode (admin only); custodian's direct write is STAGED; head cannot write; SYS_ADMIN still writes", async () => {
    const byHead = await post("headMat", `/org/nodes/${mat}/draft-workflow`, { enabled: true });
    const on = await post("admin", `/org/nodes/${mat}/draft-workflow`, { enabled: true });
    const cust = await change("custMat", { kind: "setName", itemIds: [wb], value: "WB staged" });
    const head = await change("headMat", { kind: "setName", itemIds: [wb], value: "WB head direct" });
    // The admin edits a DIFFERENT item — editing the staged whiteboard would (rightly)
    // make the custodian's draft stale for D-05.
    const admin = await change("admin", { kind: "setName", itemIds: [chairs[1]], value: "Chair 02b" });
    const live = await db.item.findUniqueOrThrow({ where: { id: wb } });
    const adminRow = await db.item.findUniqueOrThrow({ where: { id: chairs[1] } });
    const ok = byHead.status === 403 && on.status === 200 && cust.status === 200 && Boolean(cust.body?.staged) && head.status >= 403 && admin.status === 200 && live.name !== "WB staged" && adminRow.name === "Chair 02b";
    return { ok, evidence: { headToggles: byHead.status, adminToggles: on.status, custodianDirect: [cust.status, cust.body?.staged ? "staged" : "applied"], headDirect: head.status, adminDirect: admin.status, liveWhiteboard: live.name, adminRenamed: adminRow.name } };
  });

  await check(D, "D-03", "custody/ownership never staged; a change outside the lab refused; an outsider cannot edit the lab's draft", async () => {
    const outside = await db.item.findFirst({ where: { parentId: null, ownerOrgNodeId: se, deletedAt: null } });
    const r = {
      setOwnerOrg: (await change("custMat", { kind: "setOwnerOrg", itemIds: [wb], value: se })).status,
      setCustodian: (await change("custMat", { kind: "setCustodian", itemIds: [wb], value: S.headMat.id })).status,
      outsideLab: outside ? (await op("custMat", lab, "draft", { kind: "setName", itemIds: [outside.id], value: "x" })).status : 400,
      outsiderEdits: (await op("custChem", lab, "draft", { kind: "setName", itemIds: [wb], value: "x" })).status,
      outsiderIdeal: (await act("custChem", lab, "ideal", "start")).status,
    };
    return { ok: r.setOwnerOrg === 403 && r.setCustodian === 403 && r.outsideLab === 400 && r.outsiderEdits === 403 && r.outsiderIdeal === 403, evidence: r };
  });

  let commitId = "";
  await check(D, "D-04", "stage create/status/remove, submit, head rejects → draft back to editing with the reason, nothing applied", async () => {
    const s1 = await change("custMat", { kind: "createItem", parentId: lab, categoryId: computer, count: 2 });
    const s2 = await change("custMat", { kind: "setStatus", itemIds: [chairs[0]], value: "BROKEN" });
    const sub = await act("custMat", lab, "draft", "submit");
    commitId = sub.body?.id;
    const inbox = await get("headMat", "/resources/lab-commits?box=inbox");
    const inInbox = (inbox.body ?? []).some((c: any) => c.id === commitId);
    const wrongHead = await decide("headSe", commitId, "APPROVE");
    const rej = await decide("headMat", commitId, "REJECT", "Count again");
    const draft = await db.labVersion.findUnique({ where: { labItemId_kind: { labItemId: lab, kind: "DRAFT" } } });
    const computers = await db.item.count({ where: { parentId: lab, categoryId: computer, deletedAt: null } });
    const ok = Boolean(s1.body?.staged) && Boolean(s2.body?.staged) && sub.status === 201 && inInbox && wrongHead.status === 403 && rej.status === 200 && draft?.status === "EDITING" && draft?.rejectionNote === "Count again" && computers === 0;
    return { ok, evidence: { staged: [s1.status, s2.status], submit: sub.status, summary: sub.body?.summary, inHeadInbox: inInbox, otherHeadDecides: wrongHead.status, reject: rej.status, draftAfterReject: draft?.status, computersCreated: computers } };
  });

  await check(D, "D-05", "resubmit and approve → merged into the register, attributed to the custodian, not the head", async () => {
    const sub = await act("custMat", lab, "draft", "submit");
    const ok = await decide("headMat", sub.body.id, "APPROVE");
    const computers = await db.item.count({ where: { parentId: lab, categoryId: computer, deletedAt: null } });
    const wbRow = await db.item.findUniqueOrThrow({ where: { id: wb } });
    const chairRow = await db.item.findUniqueOrThrow({ where: { id: chairs[0] } });
    const log = await db.itemChange.findFirst({ where: { itemId: chairs[0], kind: "setStatus" }, orderBy: { at: "desc" } });
    return {
      ok: ok.body?.status === "APPLIED" && computers === 2 && wbRow.name === "WB staged" && chairRow.status === "BROKEN" && log?.actorId === S.custMat.id,
      evidence: { status: ok.body?.status, resolution: ok.body?.resolution, computers, whiteboardName: wbRow.name, chairStatus: chairRow.status, actorIsCustodian: log?.actorId === S.custMat.id },
    };
  });

  await check(D, "D-06", "H17 — two edits of the same item in one draft: approval applies both, all-or-nothing", async () => {
    await change("custMat", { kind: "setName", itemIds: [chairs[1]], value: "Chair renamed" });
    await change("custMat", { kind: "setStatus", itemIds: [chairs[1]], value: "BROKEN" });
    const sub = await act("custMat", lab, "draft", "submit");
    const res = await decide("headMat", sub.body.id, "APPROVE");
    const after = await db.item.findUniqueOrThrow({ where: { id: chairs[1] } });
    const both = after.name === "Chair renamed" && after.status === "BROKEN";
    return { ok: both && res.body?.status === "APPLIED", evidence: { decide: res.body?.status, name: after.name, status: after.status }, hypothesis: "H17" };
  });

  await check(D, "D-07", "a staged rename approved after an admin changed the item is refused as STALE — never a lost update", async () => {
    await change("custMat", { kind: "setName", itemIds: [wb], value: "WB from stale draft" });
    const sub = await act("custMat", lab, "draft", "submit");
    await change("admin", { kind: "setName", itemIds: [wb], value: "WB corrected by admin" });
    const res = await decide("headMat", sub.body.id, "APPROVE");
    const row = await db.item.findUniqueOrThrow({ where: { id: wb } });
    await act("custMat", lab, "draft", "discard");
    return { ok: res.body?.status === "STALE" && row.name === "WB corrected by admin", evidence: { commitStatus: res.body?.status, resolution: res.body?.resolution, finalName: row.name } };
  });

  await check(D, "D-08", "ideal: add to the proposal, submit, approve; ideal-vs-actual and department purchasables agree", async () => {
    await op("custMat", lab, "ideal", { kind: "createItem", parentId: lab, categoryId: chair, count: 4 });
    await op("custMat", lab, "ideal", { kind: "createItem", parentId: lab, categoryId: computer, count: 2 });
    const sub = await act("custMat", lab, "ideal", "submit");
    const ok = await decide("headMat", sub.body.id, "APPROVE");
    const iva = await get("custMat", `/resources/labs/${lab}/ideal-vs-actual`);
    const pur = await get("headMat", `/resources/departments/${mat}/purchasables`);
    const chairRow = (iva.body ?? []).find((r: any) => r.categoryId === chair);
    return { ok: ok.body?.status === "APPLIED" && chairRow?.idealQty === 6 && chairRow?.actualCount === 2 && pur.status === 200, evidence: { commit: ok.body?.status, chairIdealActual: chairRow ? [chairRow.idealQty, chairRow.actualCount] : null, purchasables: ev(pur) } };
  });

  await check(D, "D-09", "vacant headship blocks decisions for everyone (incl. admin); appointing a head unblocks", async () => {
    await op("custMat", lab, "ideal", { kind: "createItem", parentId: lab, categoryId: whiteboard, count: 1 });
    const sub = await act("custMat", lab, "ideal", "submit");
    await post("admin", `/people/${S.headMat.id}/assign-node`, { nodeId: null });
    const adminTry = await decide("admin", sub.body.id, "APPROVE");
    const exHead = await decide("headMat", sub.body.id, "APPROVE");
    await post("admin", `/people/${S.headMat.id}/assign-node`, { nodeId: mat });
    const back = await decide("headMat", sub.body.id, "APPROVE");
    return { ok: adminTry.status === 403 && exHead.status === 403 && back.status === 200, evidence: { adminWhileVacant: adminTry.status, formerHeadWhileVacant: exHead.status, afterReappointment: back.status } };
  });

  await check(D, "D-10", "the custodian cannot approve their own commit; withdraw works only while submitted; a stranger cannot withdraw", async () => {
    await change("custMat", { kind: "setName", itemIds: [chairs[0]], value: "self-approve" });
    const sub = await act("custMat", lab, "draft", "submit");
    const self = await decide("custMat", sub.body.id, "APPROVE");
    const stranger = await act("custChem", lab, "draft", "withdraw");
    const withdraw = await act("custMat", lab, "draft", "withdraw");
    const again = await act("custMat", lab, "draft", "withdraw");
    const req = await db.labCommitRequest.findUniqueOrThrow({ where: { id: sub.body.id } });
    await act("custMat", lab, "draft", "discard");
    return { ok: self.status === 403 && stranger.status === 403 && withdraw.status === 200 && again.status === 409 && req.status === "CANCELLED", evidence: { selfApprove: self.status, strangerWithdraws: stranger.status, withdraw: withdraw.status, withdrawAgain: again.status, requestAfter: req.status } };
  });

  await check(D, "D-11", "turning draft mode OFF while a commit is pending: the pending commit can still be decided", async () => {
    const s = await change("custMat", { kind: "setStatus", itemIds: [chairs[0]], value: "WORKING" });
    const sub = await act("custMat", lab, "draft", "submit");
    const off = await post("admin", `/org/nodes/${mat}/draft-workflow`, { enabled: false });
    const res = await decide("headMat", sub.body.id, "APPROVE");
    const states = await get("custMat", `/resources/labs/${lab}/states`);
    return { ok: res.body?.status === "APPLIED", evidence: { staged: Boolean(s.body?.staged), toggleOff: off.status, approveAfterOff: res.body?.status ?? res.status, statesAfterOff: states.status } };
  });

  await done();
}

main();
