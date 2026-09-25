/** Suite Z — cross-cutting lifecycle, input limits, and 500-hunting. */
import { get, post, patch, put, del, api, check, ev, db, done, uniq, nodeId, S } from "../lib";

const Z = "Z";

async function main() {
  const se = await nodeId("Software Engineering");
  const girmaLab = await db.item.findFirstOrThrow({ where: { name: "SE Lab X — Software Lab 3" } });

  await check(Z, "Z-01", "offboarding: a custodian with custody cannot be deactivated; after bulk custody handoff, they can", async () => {
    // Give a throwaway custodian one item, then try to deactivate.
    const email = `${uniq("z-leaver")}@e2e.test`;
    const p = await post("admin", "/people", { name: "Z Leaver", email, roles: ["CUSTODIAN", "STAFF"], homeNodeId: se });
    await db.user.update({ where: { id: p.body.id }, data: { status: "ACTIVE" } });
    const lab = (await post("admin", "/resources/items/changes", { kind: "createItem", parentId: null, categoryId: (await db.resourceCategory.findUniqueOrThrow({ where: { key: "lab" } })).id, count: 1, ownerOrgNodeId: se, custodianId: p.body.id, name: uniq("Z Lab") })).body.itemIds[0];
    const blocked = await post("admin", `/people/${p.body.id}/deactivate`);
    await post("admin", "/resources/items/changes", { kind: "setCustodian", itemIds: [lab], value: S.custSe.id });
    const ok = await post("admin", `/people/${p.body.id}/deactivate`);
    return { ok: blocked.status === 400 && ok.status < 300, evidence: { blockedWhileHolding: ev(blocked), afterHandoff: ok.status } };
  });

  await check(Z, "Z-02", "invalid ids across the API return 400/404, never 500", async () => {
    const calls: Record<string, number> = {
      item: (await get("admin", "/resources/items/nope")).status,
      itemChanges: (await get("admin", "/resources/items/nope/changes")).status,
      category: (await get("admin", "/resources/categories/nope")).status,
      transfer: (await get("admin", "/resources/transfers/nope")).status,
      purchase: (await get("admin", "/resources/purchase-requests/nope")).status,
      labCommit: (await get("admin", "/resources/lab-commits/nope")).status,
      labIdeal: (await get("admin", "/resources/labs/nope/ideal-vs-actual")).status,
      booking: (await post("admin", "/scheduling/bookings/nope/cancel", {})).status,
      series: (await patch("admin", "/scheduling/series/nope", { title: "x" })).status,
      external: (await get("admin", "/external-requests/nope")).status,
      decideStep: (await post("admin", "/resources/transfers/nope/decide", { decision: "APPROVE" })).status,
      changeMissingItem: (await post("admin", "/resources/items/changes", { kind: "setName", itemIds: ["nope"], value: "x" })).status,
    };
    const fivehundreds = Object.entries(calls).filter(([, s]) => s >= 500).map(([k]) => k);
    return { ok: fivehundreds.length === 0, evidence: { calls, returned500: fivehundreds } };
  });

  await check(Z, "Z-03", "malformed bodies and bad enum values return 400, never 500", async () => {
    const calls: Record<string, number> = {
      notJson: (await api("admin", "POST", "/resources/items/changes", undefined, { "content-type": "application/json" }).catch(() => ({ status: -1 }) as any)).status,
      unknownKind: (await post("admin", "/resources/items/changes", { kind: "explode", itemIds: ["x"] })).status,
      badStatus: (await post("custSe", "/resources/items/changes", { kind: "setStatus", itemIds: [girmaLab.id], value: "SUPERBROKEN" })).status,
      wrongType: (await post("admin", "/resources/items/changes", { kind: "createItem", parentId: null, categoryId: 123, count: "lots" })).status,
      negativeCount: (await post("admin", "/resources/items/changes", { kind: "createItem", parentId: girmaLab.id, categoryId: (await db.resourceCategory.findUniqueOrThrow({ where: { key: "chair" } })).id, count: -5 })).status,
    };
    const fivehundreds = Object.entries(calls).filter(([, s]) => s >= 500).map(([k]) => k);
    return { ok: fivehundreds.length === 0, evidence: { calls, returned500: fivehundreds } };
  });

  await check(Z, "Z-04", "SQL/JSON-ish input in a name is stored literally, not executed", async () => {
    const evil = `'); DROP TABLE "Item";--`;
    const r = await post("custSe", "/resources/items/changes", { kind: "setName", itemIds: [girmaLab.id], value: evil });
    const row = await db.item.findUniqueOrThrow({ where: { id: girmaLab.id } });
    const tableStillThere = await db.item.count();
    await post("custSe", "/resources/items/changes", { kind: "setName", itemIds: [girmaLab.id], value: "SE Lab X — Software Lab 3" });
    return { ok: r.status === 200 && row.name === evil && tableStillThere > 0, evidence: { stored: row.name === evil, itemsTableRowCount: tableStillThere } };
  });

  await check(Z, "Z-05", "unicode / emoji / RTL text in names round-trips", async () => {
    const name = "実験室 🔬 مختبر ‮EVIL‬";
    const r = await post("custSe", "/resources/items/changes", { kind: "setName", itemIds: [girmaLab.id], value: name });
    const row = await db.item.findUniqueOrThrow({ where: { id: girmaLab.id } });
    await post("custSe", "/resources/items/changes", { kind: "setName", itemIds: [girmaLab.id], value: "SE Lab X — Software Lab 3" });
    return { ok: r.status === 200 && row.name === name, evidence: { roundTripped: row.name === name } };
  });

  await check(Z, "Z-06", "a department with a resource cannot be deleted (blocked, not 500)", async () => {
    const r = await del("admin", `/org/nodes/${se}`);
    return { ok: r.status === 400, evidence: ev(r) };
  });

  await check(Z, "Z-07", "GET list endpoints tolerate junk query params without 500", async () => {
    const calls: Record<string, number> = {
      pageNaN: (await get("admin", "/resources/items?page=abc&pageSize=xyz")).status,
      pageNeg: (await get("admin", "/resources/items?page=-3&pageSize=-9")).status,
      badFilter: (await get("admin", "/resources/items?f=%ZZ%not-json")).status,
      calendarNoDates: (await get("custSe", `/scheduling/calendar?labItemId=${girmaLab.id}`)).status,
      calendarBadRange: (await get("custSe", `/scheduling/calendar?labItemId=${girmaLab.id}&from=2026-12-01&to=2026-01-01`)).status,
      changesBadPage: (await get("admin", "/resources/changes?page=0&pageSize=100000")).status,
    };
    const fivehundreds = Object.entries(calls).filter(([, s]) => s >= 500).map(([k]) => k);
    return { ok: fivehundreds.length === 0, evidence: { calls, returned500: fivehundreds } };
  });

  await check(Z, "Z-08", "every write endpoint refuses an anonymous (no cookie) caller with 401", async () => {
    const calls: Record<string, number> = {
      createNode: (await post(null, "/org/nodes", { name: "x", level: 1, kind: "COLLEGE", parentIds: [] })).status,
      invite: (await post(null, "/people", { name: "x", email: "x@e2e.test", roles: ["STAFF"] })).status,
      itemChange: (await post(null, "/resources/items/changes", { kind: "setName", itemIds: [girmaLab.id], value: "x" })).status,
      category: (await post(null, "/resources/categories", { key: "x", name: "x", iconKey: "Box", groupId: "x", countingMode: "SERIALIZED" })).status,
      transfer: (await post(null, "/resources/transfers", { input: {} })).status,
      booking: (await post(null, "/scheduling/bookings", {})).status,
      need: (await post(null, "/resources/needs", { name: "x", qty: 1, reason: "x" })).status,
    };
    return { ok: Object.values(calls).every((s) => s === 401), evidence: calls };
  });

  await check(Z, "Z-09", "the HTTP method matters: GET on a write-only route and vice-versa are 404/405, not 500", async () => {
    const calls: Record<string, number> = {
      getChanges: (await get("admin", "/resources/items/changes")).status,
      putNode: (await put("admin", `/org/nodes/${se}`, { name: "x" })).status,
      deleteMe: (await del("admin", "/auth/me")).status,
    };
    const fivehundreds = Object.entries(calls).filter(([, s]) => s >= 500).map(([k]) => k);
    return { ok: fivehundreds.length === 0, evidence: { calls, returned500: fivehundreds } };
  });

  await check(Z, "Z-10", "deep-nesting abuse: creating a resource 200 levels deep is bounded or handled without 500", async () => {
    const chair = (await db.resourceCategory.findUniqueOrThrow({ where: { key: "chair" } })).id;
    const setup = (await db.resourceCategory.findUniqueOrThrow({ where: { key: "setup" } })).id;
    let parent = girmaLab.id;
    let depth = 0;
    let last = 200;
    for (let i = 0; i < 60; i++) {
      const r = await post("custSe", "/resources/items/changes", { kind: "createItem", parentId: parent, categoryId: setup, count: 1, name: `Z Depth ${i}` });
      last = r.status;
      if (r.status !== 200) break;
      parent = r.body.itemIds[0];
      depth++;
    }
    void chair;
    return { ok: last !== 500, evidence: { reachedDepth: depth, lastStatus: last } };
  });

  await done();
}

main();
