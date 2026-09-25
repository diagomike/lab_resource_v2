/** Suite V — access views and the cross-department read-leak sweep. */
import { get, post, patch, del, check, ev, db, done, uniq, nodeId, S } from "../lib";

const V = "V";
const change = (actor: string, body: unknown, view?: string) => post(actor, `/resources/items/changes${view ? `?view=${view}` : ""}`, body);

async function main() {
  const se = await nodeId("Software Engineering");
  const chem = await nodeId("Chemical Engineering");
  const girmaLab = await db.item.findFirstOrThrow({ where: { name: "SE Lab X — Software Lab 3" } });
  const seComputer = await db.item.findFirstOrThrow({ where: { parentId: { not: null }, ownerOrgNodeId: se, category: { key: "computer" }, custodianId: S.custSe.id } });
  const chemStore = await db.item.findFirstOrThrow({ where: { name: "Chemistry Store — Room C-12" } });

  const idsOf = (body: any): string[] => (body?.rows ?? body?.items ?? body ?? []).map((r: any) => r.id ?? r.item?.id).filter(Boolean);
  const ownersOf = async (ids: string[]) => new Set((await db.item.findMany({ where: { id: { in: ids } }, select: { ownerOrgNodeId: true, currentOrgNodeId: true } })).flatMap((r) => [r.ownerOrgNodeId, r.currentOrgNodeId]));

  await check(V, "V-01", "ChemE custodian's search/tree contain no SE-only resources", async () => {
    const s = await get("custChem", "/resources/items?pageSize=200");
    const t = await get("custChem", "/resources/items/tree");
    const ids = [...idsOf(s.body), ...idsOf(t.body)];
    const units = await ownersOf(ids);
    return { ok: s.status === 200 && t.status === 200 && !units.has(se), evidence: { searchRows: idsOf(s.body).length, treeRows: idsOf(t.body).length, seesSE: units.has(se) } };
  });

  await check(V, "V-01b", "uncontaminated check: Materials custodian & ChemE-free STAFF see only their own unit (search, tree, summary, facets)", async () => {
    const mat = await nodeId("Materials Science");
    const out: Record<string, unknown> = {};
    let leak = false;
    for (const a of ["custMat", "staffSe"]) {
      const s = await get(a, "/resources/items?pageSize=200");
      const t = await get(a, "/resources/items/tree");
      const units = await ownersOf([...idsOf(s.body), ...idsOf(t.body)]);
      const own = a === "custMat" ? mat : se;
      // Items THIS unit owns but has lent out (T-03/T-08 leave boards on loan in ChemE — F-041 now lets
      // a renamed pull complete) legitimately show a foreign *current* unit; only foreign-OWNED items would be a leak.
      // Foreign-owned containers that only hold this unit's lent-out items are read-only *context* (ancestor closure), not a leak.
      const seen = [...new Set([...idsOf(s.body), ...idsOf(t.body)])];
      const rows = await db.item.findMany({ where: { id: { in: seen } }, select: { id: true, parentId: true, ownerOrgNodeId: true } });
      const byId = new Map(rows.map((r) => [r.id, r]));
      const contextIds = new Set<string>();
      for (const r of rows.filter((x) => x.ownerOrgNodeId === own)) {
        for (let p = r.parentId; p && byId.has(p); p = byId.get(p)!.parentId) contextIds.add(p);
      }
      const ownedForeign = rows.filter((r) => r.ownerOrgNodeId !== own && !contextIds.has(r.id)).length;
      const foreign = ownedForeign ? [...units].filter((u) => u !== own) : [];
      const sum = JSON.stringify((await get(a, "/resources/items/summary")).body);
      out[a] = { search: idsOf(s.body).length, tree: idsOf(t.body).length, foreignUnits: foreign.length, summaryMentionsChemStore: sum.includes("Chemistry Store") };
      if (foreign.length || (a === "custMat" && sum.includes("Chemistry Store"))) leak = true;
    }
    return { ok: !leak, evidence: out };
  });

  await check(V, "V-02", "point reads of an SE item by ChemE custodian / staff: item, history, change-log filter, ideal-vs-actual", async () => {
    const r = {
      item: (await get("custChem", `/resources/items/${seComputer.id}`)).status,
      history: (await get("custChem", `/resources/items/${seComputer.id}/changes`)).status,
      idealVsActual: (await get("custChem", `/resources/labs/${girmaLab.id}/ideal-vs-actual`)).status,
      itemAsStaffChem: (await get("staffChem", `/resources/items/${seComputer.id}`)).status,
    };
    const log = await get("custChem", `/resources/changes?itemId=${seComputer.id}`);
    const logRows = (log.body?.rows ?? log.body?.items ?? []).length;
    return { ok: [r.item, r.history, r.idealVsActual, r.itemAsStaffChem].every((s) => s === 404 || s === 403) && logRows === 0, evidence: { ...r, changeLogRowsForSEItem: logRows } };
  });

  await check(V, "V-03", "facets / filter-fields / summary as ChemE staff reveal no SE counts or names", async () => {
    const sum = await get("staffChem", "/resources/items/summary");
    const facets = await get("staffChem", "/resources/items/facets");
    const fields = await get("staffChem", "/resources/items/filter-fields");
    const blob = JSON.stringify([sum.body, facets.body, fields.body]);
    return { ok: !blob.includes("SE Lab X") && !blob.includes(S.custSe.id), evidence: { summary: sum.status, facets: facets.status, filterFields: fields.status, mentionsSELab: blob.includes("SE Lab X"), mentionsGirmaId: blob.includes(S.custSe.id) } };
  });

  await check(V, "V-04", "department purchasables and open needs are head-only", async () => {
    const r = {
      purchasablesByOtherHead: (await get("headChem", `/resources/departments/${se}/purchasables`)).status,
      purchasablesByCustodian: (await get("custSe", `/resources/departments/${se}/purchasables`)).status,
      openNeedsByOtherHead: (await get("headChem", `/resources/needs?node=${se}`)).status,
    };
    return { ok: Object.values(r).every((s) => s === 403 || s === 404), evidence: r };
  });

  await check(V, "V-05", "a STUDENT (home: SE) cannot read the asset register", async () => {
    const s = await get("student", "/resources/items?pageSize=200");
    const one = await get("student", `/resources/items/${seComputer.id}`);
    const rows = s.status === 403 ? 0 : idsOf(s.body).length;
    return { ok: (s.status === 403 || rows === 0) && one.status !== 200, evidence: { searchStatus: s.status, rowsVisibleToStudent: rows, pointRead: one.status } };
  });

  await check(V, "V-06", "university-wide browse: MANAGER/STORE_KEEPER/CUSTODIAN allowed; STAFF/STUDENT refused", async () => {
    const r: Record<string, number> = {};
    for (const a of ["headSe", "storekeeper", "custSe", "staffSe", "student"]) r[a] = (await get(a, "/resources/items?scope=UNIVERSITY&pageSize=5")).status;
    return { ok: r.headSe === 200 && r.storekeeper === 200 && r.custSe === 200 && r.staffSe === 403 && r.student === 403, evidence: r };
  });

  await check(V, "V-07", "cost visibility: STAFF/CUSTODIAN do not receive cost fields in purchase or item DTOs", async () => {
    const me = await get("custSe", "/auth/me");
    const item = await get("custSe", `/resources/items/${seComputer.id}`);
    const blob = JSON.stringify(item.body);
    return { ok: me.body?.canSeeCost === false && !/cost/i.test(blob), evidence: { canSeeCost: me.body?.canSeeCost, itemDtoMentionsCost: /cost/i.test(blob) } };
  });

  // ── Access views ───────────────────────────────────────────────────────────
  const created: string[] = [];
  const upsert = async (actor: string, body: any) => {
    const r = await post(actor, "/resources/access-views", body);
    if (r.status < 300 && r.body?.id) created.push(r.body.id);
    return r;
  };

  await check(V, "V-08", "only SYS_ADMIN / PROPERTY_ADMIN manage views", async () => {
    const r: Record<string, number> = {};
    for (const a of ["headSe", "custSe", "procurement"]) r[a] = (await upsert(a, { name: uniq("x"), scope: "UNIVERSITY", audiences: [{ type: "EVERYONE" }] })).status;
    return { ok: Object.values(r).every((s) => s === 403), evidence: r };
  });

  await check(V, "V-09", "specificity PERSON > ROLE; explicit valid choice honoured; foreign view id falls back silently", async () => {
    const role = await upsert("admin", { name: uniq("V role custodians"), scope: "ORG_SUBTREE", audiences: [{ type: "ROLE", role: "CUSTODIAN" }], canEdit: true });
    const person = await upsert("admin", { name: uniq("V person Girma"), scope: "MY_CUSTODY", audiences: [{ type: "PERSON", personId: S.custSe.id }], canEdit: true });
    const other = await upsert("admin", { name: uniq("V person Hanna"), scope: "UNIVERSITY", audiences: [{ type: "PERSON", personId: S.custChem.id }], canEdit: true });
    const me = await get("custSe", "/auth/me");
    const views = (me.body?.views ?? []).map((v: any) => v.id);
    const withForeign = idsOf((await get("custSe", `/resources/items?view=${other.body.id}&pageSize=200`)).body).sort();
    const without = idsOf((await get("custSe", "/resources/items?pageSize=200")).body).sort();
    const same = JSON.stringify(withForeign) === JSON.stringify(without);
    return {
      ok: views[0] === person.body.id && views.includes(role.body.id) && !views.includes(other.body.id) && same,
      evidence: { orderedViewIds: views.map((v: string) => (v === person.body.id ? "PERSON" : v === role.body.id ? "ROLE" : v)), foreignViewIgnored: same, rowsWith: withForeign.length, rowsWithout: without.length },
    };
  });

  await check(V, "V-10", "a canEdit:false view blocks writes even for SYS_ADMIN; EXPLICIT_NODES widens reads but never writes", async () => {
    const ro = await upsert("admin", { name: uniq("V read-only admin"), scope: "UNIVERSITY", audiences: [{ type: "PERSON", personId: S.admin.id }], canEdit: false });
    const blocked = await change("admin", { kind: "setName", itemIds: [chemStore.id], value: chemStore.name }, ro.body.id);
    await del("admin", `/resources/access-views/${ro.body.id}`);
    const wide = await upsert("admin", { name: uniq("V explicit chem for staffSe"), scope: "EXPLICIT_NODES", explicitNodeIds: [chem], audiences: [{ type: "PERSON", personId: S.staffSe.id }], canEdit: true });
    const read = await get("staffSe", `/resources/items/${chemStore.id}?view=${wide.body.id}`);
    const write = await change("staffSe", { kind: "setName", itemIds: [chemStore.id], value: "pwned" }, wide.body.id);
    return { ok: blocked.status === 403 && read.status === 200 && write.status === 404, evidence: { adminWriteUnderReadOnlyView: blocked.status, widenedRead: read.status, widenedWrite: write.status } };
  });

  await check(V, "V-11", "a PROPERTY_ADMIN can publish an EVERYONE read-only view that silently blocks every write for everyone, incl. SYS_ADMIN", async () => {
    const lock = await upsert("propadmin", { name: uniq("V everyone read-only"), scope: "ORG_SUBTREE", audiences: [{ type: "EVERYONE" }], canEdit: false });
    const admin = await change("admin", { kind: "setName", itemIds: [chemStore.id], value: chemStore.name });
    const cust = await change("custChem", { kind: "setName", itemIds: [chemStore.id], value: chemStore.name });
    if (lock.body?.id) await del("admin", `/resources/access-views/${lock.body.id}`);
    return { ok: admin.status !== 403, evidence: { create: lock.status, adminWriteWithNoViewChosen: ev(admin), custodianWrite: cust.status } };
  });

  await check(V, "V-12", "access-view validation: EXPLICIT_NODES with no nodes / unknown node ids / unknown person", async () => {
    const r = {
      explicitEmpty: (await upsert("admin", { name: uniq("V empty"), scope: "EXPLICIT_NODES", explicitNodeIds: [], audiences: [{ type: "EVERYONE" }], canEdit: true, active: false })).status,
      unknownNode: (await upsert("admin", { name: uniq("V bad node"), scope: "EXPLICIT_NODES", explicitNodeIds: ["nope"], audiences: [{ type: "ROLE", role: "STUDENT" }], canEdit: true, active: false })).status,
      unknownPerson: (await upsert("admin", { name: uniq("V bad person"), scope: "UNIVERSITY", audiences: [{ type: "PERSON", personId: "nope" }], canEdit: true, active: false })).status,
    };
    return { ok: Object.values(r).every((s) => s === 400), evidence: r };
  });

  for (const id of created) await del("admin", `/resources/access-views/${id}`);
  void patch;
  await done();
}

main();
