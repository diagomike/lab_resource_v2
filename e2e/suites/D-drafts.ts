/** Suite D — a lab's changes (2026-10-02, the UX-flow round; Materials Science and Engineering,
 *  a clean department). Drafts are always on: a custodian's register edits are STAGED into the
 *  lab's changes and the head decides; ideals are gone (needs replace them); the head adds
 *  the lab and assigns its custodian. Same check ids where the intent survives. */
import { get, post, api, check, ev, db, done, uniq, nodeId, S } from "../lib";

const D = "D";
const change = (a: string, b: unknown) => post(a, "/resources/items/changes", b);
const op = (a: string, lab: string, b: unknown) => post(a, `/resources/labs/${lab}/versions/draft/ops`, b);
const act = (a: string, lab: string, action: string) => post(a, `/resources/labs/${lab}/versions/draft/${action}`);
const decide = (a: string, id: string, decision: "APPROVE" | "REJECT", note?: string) => post(a, `/resources/lab-commits/${id}/decide`, { decision, note });

async function catId(key: string) {
  return (await db.resourceCategory.findUniqueOrThrow({ where: { key } })).id;
}

async function main() {
  const mat = await nodeId("Materials Science and Engineering");
  const se = await nodeId("Software Engineering");
  const [labCat, computer, chair, whiteboard] = await Promise.all([catId("lab"), catId("computer"), catId("chair"), catId("whiteboard")]);

  // Setup: the head adds a Materials lab for the custodian; the admin (whose edits apply at
  // once) puts 2 chairs and a whiteboard in it.
  const labRes = await post("headMat", "/places", { categoryId: labCat, name: uniq("E2E Materials Lab"), ownerOrgNodeId: mat, custodianId: S.custMat.id, props: { block: "601", room: "2" } });
  const lab = labRes.body.id as string;
  const chairs = (await change("admin", { kind: "createItem", parentId: lab, categoryId: chair, count: 2 })).body.itemIds as string[];
  const wb = (await change("admin", { kind: "createItem", parentId: lab, categoryId: whiteboard, count: 1 })).body.itemIds[0] as string;

  await check(D, "D-01", "drafts are always on: there is no switch, and ideals are gone", async () => {
    const toggle = await post("admin", `/org/nodes/${mat}/draft-workflow`, { enabled: false });
    const ideal = await post("custMat", `/resources/labs/${lab}/versions/ideal/start`);
    return { ok: toggle.status === 404 && ideal.status >= 400 && ideal.status < 500, evidence: { draftSwitch: toggle.status, idealStart: ideal.status } };
  });

  await check(D, "D-02", "custodian's direct write is STAGED; head cannot write; SYS_ADMIN still writes", async () => {
    const cust = await change("custMat", { kind: "setName", itemIds: [wb], value: "WB staged" });
    const head = await change("headMat", { kind: "setName", itemIds: [wb], value: "WB head direct" });
    // The admin edits a DIFFERENT item — editing the staged whiteboard would (rightly)
    // make the custodian's draft stale for D-05.
    const admin = await change("admin", { kind: "setName", itemIds: [chairs[1]], value: "Chair 02b" });
    const live = await db.item.findUniqueOrThrow({ where: { id: wb } });
    const adminRow = await db.item.findUniqueOrThrow({ where: { id: chairs[1] } });
    const ok = cust.status === 200 && Boolean(cust.body?.staged) && head.status >= 403 && admin.status === 200 && live.name !== "WB staged" && adminRow.name === "Chair 02b";
    return { ok, evidence: { custodianDirect: [cust.status, cust.body?.staged ? "staged" : "applied"], headDirect: head.status, adminDirect: admin.status, liveWhiteboard: live.name, adminRenamed: adminRow.name } };
  });

  await check(D, "D-03", "custody/ownership never staged; a change outside the lab refused; an outsider cannot edit the lab's changes", async () => {
    const outside = await db.item.findFirst({ where: { parentId: null, ownerOrgNodeId: se, deletedAt: null } });
    const r = {
      setOwnerOrg: (await change("custMat", { kind: "setOwnerOrg", itemIds: [wb], value: se })).status,
      setCustodian: (await change("custMat", { kind: "setCustodian", itemIds: [wb], value: S.headMat.id })).status,
      outsideLab: outside ? (await op("custMat", lab, { kind: "setName", itemIds: [outside.id], value: "x" })).status : 400,
      outsiderEdits: (await op("custChem", lab, { kind: "setName", itemIds: [wb], value: "x" })).status,
      outsiderStarts: (await act("custChem", lab, "start")).status,
    };
    return { ok: r.setOwnerOrg === 403 && r.setCustodian === 403 && r.outsideLab === 400 && r.outsiderEdits === 403 && r.outsiderStarts === 403, evidence: r };
  });

  let commitId = "";
  await check(D, "D-04", "stage create/status/remove, submit, head rejects → changes back to editing with the reason, nothing applied", async () => {
    const s1 = await change("custMat", { kind: "createItem", parentId: lab, categoryId: computer, count: 2 });
    const s2 = await change("custMat", { kind: "setStatus", itemIds: [chairs[0]], value: "BROKEN" });
    const sub = await act("custMat", lab, "submit");
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
    const sub = await act("custMat", lab, "submit");
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

  await check(D, "D-06", "H17 — two edits of the same item in one batch of changes: approval applies both, all-or-nothing", async () => {
    await change("custMat", { kind: "setName", itemIds: [chairs[1]], value: "Chair renamed" });
    await change("custMat", { kind: "setStatus", itemIds: [chairs[1]], value: "BROKEN" });
    const sub = await act("custMat", lab, "submit");
    const res = await decide("headMat", sub.body.id, "APPROVE");
    const after = await db.item.findUniqueOrThrow({ where: { id: chairs[1] } });
    const both = after.name === "Chair renamed" && after.status === "BROKEN";
    return { ok: both && res.body?.status === "APPLIED", evidence: { decide: res.body?.status, name: after.name, status: after.status }, hypothesis: "H17" };
  });

  await check(D, "D-07", "a staged rename approved after an admin changed the item is refused as STALE — never a lost update", async () => {
    await change("custMat", { kind: "setName", itemIds: [wb], value: "WB from stale draft" });
    const sub = await act("custMat", lab, "submit");
    await change("admin", { kind: "setName", itemIds: [wb], value: "WB corrected by admin" });
    const res = await decide("headMat", sub.body.id, "APPROVE");
    const row = await db.item.findUniqueOrThrow({ where: { id: wb } });
    await act("custMat", lab, "discard");
    return { ok: res.body?.status === "STALE" && row.name === "WB corrected by admin", evidence: { commitStatus: res.body?.status, resolution: res.body?.resolution, finalName: row.name } };
  });

  await check(D, "D-08", "needs replace ideals: the broken chairs are a replacement suggestion, and asking raises a REPLACEMENT need on the lab", async () => {
    const sugg = await get("custMat", "/resources/needs/replacements");
    const mine = (sugg.body ?? []).find((s: any) => s.labItemId === lab && s.categoryId === chair);
    const need = await post("custMat", "/resources/needs", { labItemId: lab, name: "Lab chair", qty: 2, unit: "pcs", categoryId: chair, priority: "IMPORTANT", kind: "REPLACEMENT", replacesItemIds: mine?.items.map((i: any) => i.id) ?? [], reason: "Two chairs broke" });
    const forHead = await get("headMat", `/resources/needs?node=${mat}`);
    const listed = (forHead.body ?? []).find((n: any) => n.id === need.body?.id);
    return { ok: !!mine && mine.items.length === 2 && need.status === 200 && listed?.kind === "REPLACEMENT" && listed?.labItemId === lab, evidence: { suggestion: mine?.items.length, need: ev(need), headSees: listed ? [listed.kind, listed.labName] : null } };
  });

  await check(D, "D-09", "vacant headship blocks decisions for everyone (incl. admin); appointing a head unblocks", async () => {
    await change("custMat", { kind: "setName", itemIds: [chairs[0]], value: "Chair while vacant" });
    const sub = await act("custMat", lab, "submit");
    await post("admin", `/people/${S.headMat.id}/assign-node`, { nodeId: null });
    const adminTry = await decide("admin", sub.body.id, "APPROVE");
    const exHead = await decide("headMat", sub.body.id, "APPROVE");
    await post("admin", `/people/${S.headMat.id}/assign-node`, { nodeId: mat });
    const back = await decide("headMat", sub.body.id, "APPROVE");
    return { ok: adminTry.status === 403 && exHead.status === 403 && back.status === 200, evidence: { adminWhileVacant: adminTry.status, formerHeadWhileVacant: exHead.status, afterReappointment: back.status } };
  });

  await check(D, "D-10", "the custodian cannot approve their own changes; withdraw works only while sent; a stranger cannot withdraw", async () => {
    await change("custMat", { kind: "setName", itemIds: [chairs[0]], value: "self-approve" });
    const sub = await act("custMat", lab, "submit");
    const self = await decide("custMat", sub.body.id, "APPROVE");
    const stranger = await act("custChem", lab, "withdraw");
    const withdraw = await act("custMat", lab, "withdraw");
    const again = await act("custMat", lab, "withdraw");
    const req = await db.labCommitRequest.findUniqueOrThrow({ where: { id: sub.body.id } });
    await act("custMat", lab, "discard");
    return { ok: self.status === 403 && stranger.status === 403 && withdraw.status === 200 && again.status === 409 && req.status === "CANCELLED", evidence: { selfApprove: self.status, strangerWithdraws: stranger.status, withdraw: withdraw.status, withdrawAgain: again.status, requestAfter: req.status } };
  });

  await check(D, "D-11", "the lab itself is not the custodian's: renaming it is refused; its head renames it on Labs & stores", async () => {
    const byCustodian = await change("custMat", { kind: "setName", itemIds: [lab], value: "Renamed by custodian" });
    const viaPlaces = await api("custMat", "PATCH", `/places/${lab}`, { name: "Renamed by custodian" });
    const byHead = await api("headMat", "PATCH", `/places/${lab}`, { name: uniq("E2E Materials Lab (renamed)") });
    return { ok: byCustodian.status === 403 && viaPlaces.status === 403 && byHead.status === 200, evidence: { custodianThroughRegister: byCustodian.status, custodianThroughPlaces: viaPlaces.status, head: byHead.status } };
  });

  await done();
}

main();
