/** Suite C — categories (SYS_ADMIN / PROPERTY_ADMIN). Also configures Lab=ROOM, Computer=EQUIPMENT for suite S. */
import { get, post, patch, del, check, ev, db, done, uniq, S } from "../lib";

const C = "C";

async function cat(key: string) {
  const r = await get("admin", "/resources/categories");
  return (r.body as any[]).find((c) => c.key === key);
}

async function main() {
  const groups = (await get("admin", "/resources/category-groups")).body as any[];
  const groupId = groups[0].id;

  await check(C, "C-01", "only SYS_ADMIN / PROPERTY_ADMIN may write categories and groups", async () => {
    const lab = await cat("lab");
    const out: Record<string, number> = {};
    for (const a of ["headSe", "custSe", "storekeeper", "procurement", "student"]) {
      out[`${a}:createCat`] = (await post(a, "/resources/categories", { key: uniq("x"), name: "x", iconKey: "Box", groupId, countingMode: "SERIALIZED" })).status;
      out[`${a}:patchCat`] = (await patch(a, `/resources/categories/${lab.id}`, { expectedVersion: lab.version, name: "hijack" })).status;
      out[`${a}:createGroup`] = (await post(a, "/resources/category-groups", { name: uniq("g") })).status;
    }
    const pa = await post("propadmin", "/resources/categories", { key: uniq("pa-cat"), name: uniq("PA Cat"), iconKey: "Box", groupId, countingMode: "SERIALIZED" });
    if (pa.status === 201) await del("propadmin", `/resources/categories/${pa.body.id}`);
    return { ok: Object.values(out).every((s) => s === 403) && pa.status === 201, evidence: { out, propAdminCreate: pa.status } };
  });

  await check(C, "C-02", "groups: create, duplicate refused (case-insensitive), rename, delete-in-use 409", async () => {
    const name = uniq("E2E Group");
    const g = await post("admin", "/resources/category-groups", { name });
    const dup = await post("admin", "/resources/category-groups", { name: name.toUpperCase() });
    const ren = await patch("admin", `/resources/category-groups/${g.body.id}`, { name: `${name} R` });
    const inUse = await del("admin", `/resources/category-groups/${groupId}`);
    const delOk = await del("admin", `/resources/category-groups/${g.body.id}`);
    return { ok: g.status === 201 && dup.status === 400 && ren.status === 200 && inUse.status === 409 && delOk.status === 200, evidence: { create: g.status, dupUpper: dup.status, rename: ren.status, deleteInUse: inUse.status, deleteEmpty: delOk.status } };
  });

  await check(C, "C-03", "field validation: enum needs options, duplicate field key, duplicate category key", async () => {
    const base = { name: uniq("E2E V"), iconKey: "Box", groupId, countingMode: "SERIALIZED" };
    const noOpts = await post("admin", "/resources/categories", { ...base, key: uniq("v1"), fields: [{ key: "grade", label: "Grade", type: "ENUM", options: [] }] });
    const dupField = await post("admin", "/resources/categories", { ...base, key: uniq("v2"), fields: [{ key: "a", label: "A", type: "TEXT" }, { key: "a", label: "A2", type: "NUMBER" }] });
    const dupKey = await post("admin", "/resources/categories", { ...base, key: "lab" });
    return { ok: noOpts.status === 400 && dupField.status === 400 && dupKey.status === 400, evidence: { enumNoOptions: noOpts.status, duplicateFieldKey: dupField.status, duplicateCategoryKey: dupKey.status } };
  });

  await check(C, "C-04", "template cycles refused (self and A→B→A)", async () => {
    const a = await post("admin", "/resources/categories", { key: uniq("tpl-a"), name: uniq("TplA"), iconKey: "Box", groupId, countingMode: "SERIALIZED" });
    const b = await post("admin", "/resources/categories", { key: uniq("tpl-b"), name: uniq("TplB"), iconKey: "Box", groupId, countingMode: "SERIALIZED", templateChildren: [{ childCategoryId: a.body.id, qty: 1 }] });
    const self = await patch("admin", `/resources/categories/${a.body.id}`, { expectedVersion: a.body.version, templateChildren: [{ childCategoryId: a.body.id, qty: 1 }] });
    const loop = await patch("admin", `/resources/categories/${a.body.id}`, { expectedVersion: a.body.version, templateChildren: [{ childCategoryId: b.body.id, qty: 1 }] });
    return { ok: self.status === 400 && loop.status === 400, evidence: { self: ev(self), loop: ev(loop) } };
  });

  await check(C, "C-05", "a BULK category can never be bookable (create, and flipping an existing ROOM category to BULK)", async () => {
    const bulkRoom = await post("admin", "/resources/categories", { key: uniq("bulkroom"), name: uniq("BulkRoom"), iconKey: "Box", groupId, countingMode: "BULK", bookingMode: "ROOM" });
    const room = await post("admin", "/resources/categories", { key: uniq("room"), name: uniq("RoomCat"), iconKey: "Box", groupId, countingMode: "SERIALIZED", bookingMode: "ROOM" });
    const flip = await patch("admin", `/resources/categories/${room.body.id}`, { expectedVersion: room.body.version, countingMode: "BULK" });
    return { ok: bulkRoom.status === 400 && room.status === 201 && flip.status === 400, evidence: { createBulkRoom: bulkRoom.status, createRoom: room.status, flipRoomToBulk: ev(flip) } };
  });

  await check(C, "C-06", "optimistic concurrency: two edits from the same version → one 200, one 409", async () => {
    const c = await post("admin", "/resources/categories", { key: uniq("occ"), name: uniq("Occ"), iconKey: "Box", groupId, countingMode: "SERIALIZED" });
    const [r1, r2] = await Promise.all([
      patch("admin", `/resources/categories/${c.body.id}`, { expectedVersion: c.body.version, name: uniq("Occ A") }),
      patch("propadmin", `/resources/categories/${c.body.id}`, { expectedVersion: c.body.version, name: uniq("Occ B") }),
    ]);
    const s = [r1.status, r2.status].sort();
    return { ok: s[0] === 200 && s[1] === 409, evidence: { statuses: [r1.status, r2.status] } };
  });

  await check(C, "C-07", "BULK → SERIALIZED on a category with qty>1 stock: impact preview warns, and units are not silently destroyed", async () => {
    const c = await post("admin", "/resources/categories", { key: uniq("reagent"), name: uniq("E2E Reagent"), iconKey: "Box", groupId, countingMode: "BULK", unit: "L" });
    const store = await db.item.findFirstOrThrow({ where: { name: "Chemistry Store — Room C-12" } });
    const create = await post("admin", "/resources/items/changes", { kind: "createItem", parentId: store.id, categoryId: c.body.id, count: 1, name: "E2E Ethanol" });
    const itemId = create.body?.itemIds?.[0];
    const qty = await post("admin", "/resources/items/changes", { kind: "setQuantity", itemIds: [itemId], value: 25 });
    const impact = await post("admin", `/resources/categories/${c.body.id}/impact`, { countingMode: "SERIALIZED" });
    const flip = await patch("admin", `/resources/categories/${c.body.id}`, { expectedVersion: c.body.version, countingMode: "SERIALIZED" });
    const after = await db.item.findUniqueOrThrow({ where: { id: itemId } });
    const notes = (impact.body?.notes ?? []).map((n: any) => `${n.severity}: ${n.title}`);
    const warned = notes.some((n: string) => /destructive|warning/.test(n));
    return {
      ok: warned && !(flip.status === 200 && Number(after.qty) === 1),
      evidence: { create: create.status, setQty25: qty.status, impactNotes: notes, flip: flip.status, qtyAfter: String(after.qty), countingModeAfter: after.countingMode },
    };
  });

  await check(C, "C-08", "changing a field's type (TEXT→NUMBER) with existing text values: preview warns and data stays valid", async () => {
    const c = await post("admin", "/resources/categories", { key: uniq("meter"), name: uniq("E2E Meter"), iconKey: "Box", groupId, countingMode: "SERIALIZED", fields: [{ key: "reading", label: "Reading", type: "TEXT" }] });
    const lab = await db.item.findFirstOrThrow({ where: { name: "SE Lab X — Software Lab 3" } });
    const create = await post("admin", "/resources/items/changes", { kind: "createItem", parentId: lab.id, categoryId: c.body.id, count: 1, name: "E2E Meter A", props: { reading: "about five" } });
    const impact = await post("admin", `/resources/categories/${c.body.id}/impact`, { fields: [{ key: "reading", label: "Reading", type: "NUMBER" }] });
    const flip = await patch("admin", `/resources/categories/${c.body.id}`, { expectedVersion: c.body.version, fields: [{ key: "reading", label: "Reading", type: "NUMBER" }] });
    const item = await db.item.findUniqueOrThrow({ where: { id: create.body.itemIds[0] } });
    const rename = await post("custSe", "/resources/items/changes", { kind: "setName", itemIds: [item.id], value: "E2E Meter A2" });
    const notes = (impact.body?.notes ?? []).map((n: any) => `${n.severity}: ${n.title}`);
    return {
      ok: notes.length > 0 && !(flip.status === 200 && typeof (item.props as any).reading === "string"),
      evidence: { impactNotes: notes, flip: flip.status, storedValueAfterFlip: (item.props as any).reading, laterUnrelatedEdit: rename.status },
    };
  });

  await check(C, "C-09", "adding a REQUIRED field to a category that already has items", async () => {
    const comp = await cat("computer");
    const count = await db.item.count({ where: { categoryId: comp.id } });
    const impact = await post("admin", `/resources/categories/${comp.id}/impact`, { fields: [...comp.fields.map((f: any) => ({ ...f, unit: f.unit ?? undefined })), { key: "assetTag", label: "Asset tag", type: "TEXT", required: true }] });
    const notes = (impact.body?.notes ?? []).map((n: any) => `${n.severity}: ${n.title}`);
    return { ok: impact.status === 200 && notes.some((n: string) => /required/i.test(n)), evidence: { existingComputers: count, impact: impact.status, notes } };
  });

  await check(C, "C-10", "deactivated category: new items refused; delete of an in-use category 409", async () => {
    const c = await post("admin", "/resources/categories", { key: uniq("retire"), name: uniq("E2E Retire"), iconKey: "Box", groupId, countingMode: "SERIALIZED" });
    const lab = await db.item.findFirstOrThrow({ where: { name: "SE Lab X — Software Lab 3" } });
    const made = await post("admin", "/resources/items/changes", { kind: "createItem", parentId: lab.id, categoryId: c.body.id, count: 1 });
    const off = await patch("admin", `/resources/categories/${c.body.id}`, { expectedVersion: c.body.version, active: false });
    const refused = await post("admin", "/resources/items/changes", { kind: "createItem", parentId: lab.id, categoryId: c.body.id, count: 1 });
    const delInUse = await del("admin", `/resources/categories/${c.body.id}`);
    return { ok: made.status === 200 && off.status === 200 && refused.status === 400 && delInUse.status === 409, evidence: { create: made.status, deactivate: off.status, createAfter: ev(refused), deleteInUse: delInUse.status } };
  });

  await check(C, "C-11", "configure scheduling: Lab → ROOM and Computer → EQUIPMENT, each audited", async () => {
    const lab = await cat("lab");
    const comp = await cat("computer");
    const r1 = await patch("admin", `/resources/categories/${lab.id}`, { expectedVersion: lab.version, bookingMode: "ROOM" });
    const r2 = await patch("admin", `/resources/categories/${comp.id}`, { expectedVersion: comp.version, bookingMode: "EQUIPMENT" });
    const audit = await db.itemChange.count({ where: { categoryId: { in: [lab.id, comp.id] }, targetKind: "CATEGORY", at: { gte: new Date(Date.now() - 60_000) } } });
    return { ok: r1.status === 200 && r2.status === 200 && audit >= 2, evidence: { lab: r1.status, computer: r2.status, auditRows: audit } };
  });

  await check(C, "C-12", "category key/name hygiene: whitespace-only name, 2,000-char name, key with spaces", async () => {
    const r = {
      blankName: (await post("admin", "/resources/categories", { key: uniq("blank"), name: "   ", iconKey: "Box", groupId, countingMode: "SERIALIZED" })).status,
      longName: (await post("admin", "/resources/categories", { key: uniq("long"), name: "N".repeat(2000), iconKey: "Box", groupId, countingMode: "SERIALIZED" })).status,
      keyWithSpaces: (await post("admin", "/resources/categories", { key: "has spaces " + uniq(""), name: uniq("Spaces"), iconKey: "Box", groupId, countingMode: "SERIALIZED" })).status,
      unknownIcon: (await post("admin", "/resources/categories", { key: uniq("icon"), name: uniq("Icon"), iconKey: "NotARealIcon", groupId, countingMode: "SERIALIZED" })).status,
    };
    return { ok: r.blankName === 400 && r.longName === 400 && r.keyWithSpaces === 400, evidence: r };
  });

  void S;
  await done();
}

main();
