/** Suite R — register: custodians & heads creating, moving, editing. H8–H12. */
import { get, post, api, check, ev, db, done, uniq, nodeId, userId, S } from "../lib";

const R = "R";
const change = (actor: string, body: unknown) => post(actor, "/resources/items/changes", body);
const PNG_1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

async function catId(key: string) {
  return (await db.resourceCategory.findUniqueOrThrow({ where: { key } })).id;
}
async function item(name: string) {
  return db.item.findFirstOrThrow({ where: { name } });
}

async function main() {
  const se = await nodeId("Software Engineering");
  const chem = await nodeId("Chemical Engineering");
  const mat = await nodeId("Materials Science");
  const [lab, computer, chair, whiteboard] = await Promise.all([catId("lab"), catId("computer"), catId("chair"), catId("whiteboard")]);
  const girmaLab = await item("SE Lab X — Software Lab 3");

  let newLab = "";
  await check(R, "R-01", "custodian registers their own lab (own home unit, self as custodian)", async () => {
    const r = await change("custSe", { kind: "createItem", parentId: null, categoryId: lab, count: 1, ownerOrgNodeId: se, custodianId: S.custSe.id, name: uniq("E2E Robotics Lab") });
    newLab = r.body?.itemIds?.[0];
    return { ok: r.status === 200 && !!newLab, evidence: ev(r) };
  });

  await check(R, "R-02", "custodian refused: root for another unit, or naming someone else as custodian", async () => {
    const otherUnit = await change("custSe", { kind: "createItem", parentId: null, categoryId: lab, count: 1, ownerOrgNodeId: chem, custodianId: S.custSe.id });
    const otherCust = await change("custSe", { kind: "createItem", parentId: null, categoryId: lab, count: 1, ownerOrgNodeId: se, custodianId: S.custSe2.id });
    return { ok: otherUnit.status === 403 && otherCust.status === 403, evidence: { otherUnit: otherUnit.status, otherCustodian: otherCust.status } };
  });

  await check(R, "R-03", "head registers a lab for their department with an assistant as custodian; refused for another department", async () => {
    const own = await change("headSe", { kind: "createItem", parentId: null, categoryId: lab, count: 1, ownerOrgNodeId: se, custodianId: S.custSe2.id, name: uniq("E2E Head Lab") });
    const foreign = await change("headSe", { kind: "createItem", parentId: null, categoryId: lab, count: 1, ownerOrgNodeId: chem, custodianId: S.custChem.id });
    return { ok: own.status === 200 && foreign.status === 403, evidence: { own: own.status, foreign: foreign.status } };
  });

  await check(R, "R-04", "add 2 computers into the new lab: template subtree instantiated, custody/ownership inherited", async () => {
    const r = await change("custSe", { kind: "createItem", parentId: newLab, categoryId: computer, count: 2, customProps: { "Asset tag": { type: "TEXT", value: "ASTU-001" } } });
    const ids: string[] = r.body?.itemIds ?? [];
    const kids = await db.item.findMany({ where: { parentId: { in: ids } } });
    const roots = await db.item.findMany({ where: { id: { in: ids } } });
    const inherited = roots.every((x) => x.ownerOrgNodeId === se && x.custodianId === S.custSe.id && x.parentId === newLab);
    return { ok: r.status === 200 && ids.length === 2 && kids.length > 0 && inherited, evidence: { status: r.status, roots: ids.length, templateChildren: kids.length, inherited } };
  });

  await check(R, "R-05", "H10 — child created under own lab cannot carry another unit/custodian chosen by the client", async () => {
    const r = await change("custSe", { kind: "createItem", parentId: newLab, categoryId: chair, count: 1, ownerOrgNodeId: chem, currentOrgNodeId: mat, custodianId: S.custChem.id, name: uniq("E2E Smuggled Chair") });
    const row = r.status === 200 ? await db.item.findUniqueOrThrow({ where: { id: r.body.itemIds[0] } }) : null;
    return {
      ok: !(row && (row.ownerOrgNodeId !== se || row.custodianId !== S.custSe.id)),
      evidence: { status: r.status, owner: row?.ownerOrgNodeId === chem ? "Chemical Engineering" : row?.ownerOrgNodeId, current: row?.currentOrgNodeId === mat ? "Materials Science" : row?.currentOrgNodeId, custodian: row?.custodianId === S.custChem.id ? "Hanna Bekele (ChemE)" : row?.custodianId },
      hypothesis: "H10",
    };
  });

  await check(R, "R-06", "H11 — createItem count has no upper bound (2,000 chairs in one request)", async () => {
    const t = Date.now();
    const r = await change("custSe", { kind: "createItem", parentId: newLab, categoryId: chair, count: 2000 });
    const ms = Date.now() - t;
    const made = r.body?.itemIds?.length ?? 0;
    if (made) await change("custSe", { kind: "deleteItem", itemIds: r.body.itemIds });
    return { ok: r.status === 400, evidence: { status: r.status, created: made, ms }, hypothesis: "H11" };
  });

  await check(R, "R-07", "H11 — a root can name a DISABLED user or a STUDENT as custodian", async () => {
    const disabled = await change("admin", { kind: "createItem", parentId: null, categoryId: lab, count: 1, ownerOrgNodeId: se, custodianId: S.disabled.id, name: uniq("E2E Disabled-custody Lab") });
    const student = await change("headSe", { kind: "createItem", parentId: null, categoryId: lab, count: 1, ownerOrgNodeId: se, custodianId: S.student.id, name: uniq("E2E Student-custody Lab") });
    return { ok: disabled.status === 400 && student.status === 400, evidence: { disabledCustodian: disabled.status, studentCustodian: student.status }, hypothesis: "H11" };
  });

  let myComputer = "";
  await check(R, "R-08", "H8 — custodian re-owns their own computer to another department without any approval", async () => {
    myComputer = (await db.item.findFirstOrThrow({ where: { parentId: newLab, categoryId: computer } })).id;
    const owner = await change("custSe", { kind: "setOwnerOrg", itemIds: [myComputer], value: chem });
    const current = await change("custSe", { kind: "setCurrentOrg", itemIds: [myComputer], value: mat });
    const row = await db.item.findUniqueOrThrow({ where: { id: myComputer } });
    const revert = await change("admin", { kind: "setOwnerOrg", itemIds: [myComputer], value: se });
    await change("admin", { kind: "setCurrentOrg", itemIds: [myComputer], value: se });
    return { ok: owner.status === 403 && current.status === 403, evidence: { setOwnerOrg: owner.status, setCurrentOrg: current.status, ownerAfter: row.ownerOrgNodeId === chem ? "Chemical Engineering" : row.ownerOrgNodeId, revert: revert.status }, hypothesis: "H8" };
  });

  await check(R, "R-09", "H8 — custodian dumps custody on a student / a disabled user / another department's custodian with no acceptance", async () => {
    const c = await change("custSe", { kind: "createItem", parentId: newLab, categoryId: whiteboard, count: 3 });
    const [a, b, d] = c.body.itemIds;
    const toStudent = await change("custSe", { kind: "setCustodian", itemIds: [a], value: S.student.id });
    const toDisabled = await change("custSe", { kind: "setCustodian", itemIds: [b], value: S.disabled.id });
    const toForeign = await change("custSe", { kind: "setCustodian", itemIds: [d], value: S.custChem.id });
    return {
      ok: [toStudent, toDisabled, toForeign].every((r) => r.status >= 400),
      evidence: { student: toStudent.status, disabledUser: toDisabled.status, otherDepartmentCustodian: toForeign.status },
      hypothesis: "H8",
    };
  });

  const borrowed = await item("Workstation Setup 07"); // SE-owned, Girma-custodied, inside Hanna's ChemE lab
  await check(R, "R-10", "H9 — host department head edits and re-owns a BORROWED item (owner SE, currently in ChemE)", async () => {
    const before = await db.item.findUniqueOrThrow({ where: { id: borrowed.id } });
    const rename = await change("headChem", { kind: "setName", itemIds: [borrowed.id], value: "Workstation Setup 07 (renamed by host head)" });
    const reown = await change("headChem", { kind: "setOwnerOrg", itemIds: [borrowed.id], value: chem });
    const after = await db.item.findUniqueOrThrow({ where: { id: borrowed.id } });
    await change("admin", { kind: "setName", itemIds: [borrowed.id], value: before.name });
    await change("admin", { kind: "setOwnerOrg", itemIds: [borrowed.id], value: before.ownerOrgNodeId });
    return { ok: rename.status >= 400 && reown.status >= 400, evidence: { rename: rename.status, setOwnerOrgToChemE: reown.status, ownerAfter: after.ownerOrgNodeId === chem ? "Chemical Engineering (stolen)" : "Software Engineering" }, hypothesis: "H9" };
  });

  await check(R, "R-11", "H9 — host lab custodian takes custody of a borrowed item (custody resolved through containment)", async () => {
    const before = await db.item.findUniqueOrThrow({ where: { id: borrowed.id } });
    const take = await change("custChem", { kind: "setCustodian", itemIds: [borrowed.id], value: S.custChem.id });
    const after = await db.item.findUniqueOrThrow({ where: { id: borrowed.id } });
    await change("admin", { kind: "setCustodian", itemIds: [borrowed.id], value: before.custodianId });
    return { ok: take.status >= 400, evidence: { setCustodianToSelf: take.status, custodianAfter: after.custodianId === S.custChem.id ? "Hanna (host)" : "Girma (lender)" }, hypothesis: "H9" };
  });

  await check(R, "R-12", "outsiders cannot write another lab's item (404): other custodian, staff, student, other head", async () => {
    const out: Record<string, number> = {};
    for (const a of ["custChem", "staffSe", "student", "headChem", "custMat", "storekeeper", "procurement", "propadmin"]) out[a] = (await change(a, { kind: "setName", itemIds: [myComputer], value: "pwned" })).status;
    return { ok: Object.values(out).every((s) => s === 404 || s === 403), evidence: out };
  });

  await check(R, "R-13", "move within own tree works; into a foreign container 404; into own descendant is skipped", async () => {
    const chairRow = await db.item.findFirstOrThrow({ where: { parentId: newLab, categoryId: chair } });
    const intoGirmaLab = await change("custSe", { kind: "moveInTree", itemIds: [chairRow.id], value: girmaLab.id });
    const hannaLab = await item("Mechanical Unit Operations Laboratory");
    const foreign = await change("custSe", { kind: "moveInTree", itemIds: [chairRow.id], value: hannaLab.id });
    const compKid = await db.item.findFirstOrThrow({ where: { parentId: myComputer } });
    const selfNest = await change("custSe", { kind: "moveInTree", itemIds: [myComputer], value: compKid.id });
    return {
      ok: intoGirmaLab.status === 200 && foreign.status === 404 && (selfNest.status >= 400 || selfNest.body?.applied === 0),
      evidence: { ownMove: intoGirmaLab.status, foreignDestination: foreign.status, intoOwnDescendant: ev(selfNest) },
    };
  });

  await check(R, "R-14", "optimistic concurrency: two renames with the same expected version → one 200, one 409", async () => {
    const row = await db.item.findUniqueOrThrow({ where: { id: myComputer } });
    const [a, b] = await Promise.all([
      change("custSe", { kind: "setName", itemIds: [myComputer], value: "E2E Computer A", expectedVersions: { [myComputer]: row.version } }),
      change("headSe", { kind: "setName", itemIds: [myComputer], value: "E2E Computer B", expectedVersions: { [myComputer]: row.version } }),
    ]);
    const s = [a.status, b.status].sort();
    return { ok: s[0] === 200 && s[1] === 409, evidence: { statuses: [a.status, b.status] } };
  });

  await check(R, "R-15", "quantity rules: serialized ≠ 1 refused; bulk negative refused", async () => {
    const chem1 = await db.item.findFirstOrThrow({ where: { category: { key: "chemical" } } });
    const serial = await change("custSe", { kind: "setQuantity", itemIds: [myComputer], value: 3 });
    const negative = await change("custChem", { kind: "setQuantity", itemIds: [chem1.id], value: -2 });
    const fraction = await change("custChem", { kind: "setQuantity", itemIds: [chem1.id], value: 2.5 });
    return { ok: serial.status === 400 && negative.status === 400 && fraction.status === 200, evidence: { serialized3: serial.status, bulkNegative: negative.status, bulkFraction: fraction.status } };
  });

  await check(R, "R-16", "custom properties: add, collision with a category field refused, bad key refused, remove", async () => {
    const add = await change("custSe", { kind: "addCustomProperty", itemIds: [myComputer], key: "Warranty until", type: "TEXT", value: "2027-01" });
    const field = (await db.categoryField.findFirst({ where: { categoryId: computer } }))?.key;
    const collide = field ? await change("custSe", { kind: "addCustomProperty", itemIds: [myComputer], key: field, type: "TEXT", value: "x" }) : { status: 400 };
    const badKey = await change("custSe", { kind: "addCustomProperty", itemIds: [myComputer], key: "1<script>", type: "TEXT", value: "x" });
    const remove = await change("custSe", { kind: "removeCustomProperty", itemIds: [myComputer], key: "Warranty until" });
    return { ok: add.status === 200 && collide.status === 400 && badKey.status === 400 && remove.status === 200, evidence: { add: add.status, collideWithField: collide.status, badKey: badKey.status, remove: remove.status } };
  });

  await check(R, "R-17", "images: upload + attach; non-image bytes refused; another custodian cannot open an upload session", async () => {
    const sess = await post("custSe", `/resources/items/${myComputer}/images/upload-sessions`);
    const up = await api("custSe", "PUT", `/resources/images/upload/${sess.body.uploadSessionId}`, undefined, { "content-type": "image/png" });
    void up;
    const res = await fetch(`http://localhost:3100/api/resources/images/upload/${sess.body.uploadSessionId}`, { method: "PUT", headers: { cookie: `lrms_session=${S.custSe.token}`, "content-type": "image/png" }, body: PNG_1x1 });
    const attach = await change("custSe", { kind: "addImage", itemIds: [myComputer], uploadSessionId: sess.body.uploadSessionId, caption: "front" });
    const sess2 = await post("custSe", `/resources/items/${myComputer}/images/upload-sessions`);
    const fake = await fetch(`http://localhost:3100/api/resources/images/upload/${sess2.body.uploadSessionId}`, { method: "PUT", headers: { cookie: `lrms_session=${S.custSe.token}`, "content-type": "image/png" }, body: Buffer.from("<svg onload=alert(1)>not an image</svg>") });
    const foreignSess = await post("custChem", `/resources/items/${myComputer}/images/upload-sessions`);
    const img = await db.itemImage.findFirst({ where: { itemId: myComputer } });
    const serve = img ? await fetch(`http://localhost:3100/api/resources/images/${img.storageKey}`, { headers: { cookie: `lrms_session=${S.custChem.token}` } }) : null;
    return {
      ok: sess.status === 201 && res.status === 200 && attach.status === 200 && fake.status === 400 && foreignSess.status >= 400 && serve?.status === 404,
      evidence: { session: sess.status, upload: res.status, attach: attach.status, spoofedUpload: fake.status, foreignSession: foreignSess.status, foreignCustodianFetchesPhoto: serve?.status },
    };
  });

  await check(R, "R-18", "H12 — delete is a hard delete (row gone, not soft-deleted)", async () => {
    const c = await change("custSe", { kind: "createItem", parentId: newLab, categoryId: whiteboard, count: 1, name: uniq("E2E Doomed") });
    const id = c.body.itemIds[0];
    const d = await change("custSe", { kind: "deleteItem", itemIds: [id] });
    const row = await db.item.findUnique({ where: { id } });
    const log = await db.itemChange.count({ where: { itemId: id, kind: "deleteItem" } });
    return { ok: d.status === 200 && row !== null, evidence: { delete: d.status, rowStillExists: row !== null, softDeletedAt: row?.deletedAt ?? null, auditRow: log }, hypothesis: "H12" };
  });

  await check(R, "R-19", "placement rules: Lab under a computer refused; Computer as a top-level resource refused", async () => {
    const labInComputer = await change("custSe", { kind: "createItem", parentId: myComputer, categoryId: lab, count: 1 });
    const computerRoot = await change("admin", { kind: "createItem", parentId: null, categoryId: computer, count: 1, ownerOrgNodeId: se, custodianId: S.custSe.id });
    return { ok: labInComputer.status === 400 && computerRoot.status === 400, evidence: { labInsideComputer: labInComputer.status, computerAsRoot: computerRoot.status } };
  });

  await check(R, "R-20", "derived status: a broken critical part impairs its computer, and the lab rolls up", async () => {
    const parts = await db.item.findMany({ where: { parentId: myComputer, critical: true } });
    const part = parts[0] ?? (await db.item.findFirstOrThrow({ where: { parentId: myComputer } }));
    const broke = await change("custSe", { kind: "setStatus", itemIds: [part.id], value: "BROKEN" });
    const comp = await get("custSe", `/resources/items/${myComputer}`);
    await change("custSe", { kind: "setStatus", itemIds: [part.id], value: "WORKING" });
    return { ok: broke.status === 200 && (!part.critical || comp.body?.effectiveStatus !== "WORKING"), evidence: { partCritical: part.critical, setBroken: broke.status, computerEffectiveStatus: comp.body?.effectiveStatus } };
  });

  await check(R, "R-21", "input limits: 10,000-char name, blank name, HTML in name, huge pageSize", async () => {
    const long = await change("custSe", { kind: "setName", itemIds: [myComputer], value: "N".repeat(10000) });
    const blank = await change("custSe", { kind: "setName", itemIds: [myComputer], value: "   " });
    const html = await change("custSe", { kind: "setName", itemIds: [myComputer], value: "<img src=x onerror=alert(1)>" });
    const big = await get("admin", "/resources/items?pageSize=100000");
    await change("custSe", { kind: "setName", itemIds: [myComputer], value: "E2E Computer" });
    return {
      ok: long.status === 400 && blank.status === 400,
      evidence: { longName10000: long.status, blankName: blank.status, htmlName: html.status, pageSize100000: { status: big.status, rows: big.body?.rows?.length ?? big.body?.items?.length, ms: big.ms } },
    };
  });

  await check(R, "R-22", "a required category field is enforced when creating a new item", async () => {
    const groupId = (await db.categoryGroup.findFirstOrThrow()).id;
    const c = await post("admin", "/resources/categories", { key: uniq("req"), name: uniq("E2E Required"), iconKey: "Box", groupId, countingMode: "SERIALIZED", fields: [{ key: "serial", label: "Serial", type: "TEXT", required: true }] });
    const r = await change("custSe", { kind: "createItem", parentId: newLab, categoryId: c.body.id, count: 1 });
    return { ok: r.status === 400, evidence: { createWithoutRequired: ev(r) } };
  });

  await check(R, "R-23", "CRITICAL probe — host custodian deletes her own lab while it holds another department's borrowed workstation", async () => {
    const hannaLab = await item("Mechanical Unit Operations Laboratory");
    const before = await db.item.count({ where: { ownerOrgNodeId: se, currentOrgNodeId: chem } });
    const d = await change("custChem", { kind: "deleteItem", itemIds: [hannaLab.id] });
    const after = await db.item.count({ where: { ownerOrgNodeId: se, currentOrgNodeId: chem } });
    return { ok: d.status >= 400 && after === before, evidence: { delete: ev(d), seOwnedItemsInChemEBefore: before, after }, hypothesis: "H9" };
  });

  void userId;
  await done();
}

main();
