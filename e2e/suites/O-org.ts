/** Suite O — org structure (SYS_ADMIN), incl. H5, H6, H7. */
import { get, post, patch, put, del, check, ev, db, done, mintAs, mailSeq, mailsSince, uniq, nodeId, userId } from "../lib";

const O = "O";

async function createNode(name: string, level: number, kind: string, parentIds: string[]) {
  return post("admin", "/org/nodes", { name, level, kind, parentIds });
}

async function main() {
  const uni = await nodeId("Adama Science and Technology University");
  const coeec = await nodeId("College of Electrical Engineering and Computing");
  const comcme = await nodeId("College of Mechanical, Chemical and Materials Engineering");
  const se = await nodeId("Software Engineering");

  let college = "";
  let dept = "";
  await check(O, "O-01", "create college under the university and a department under it", async () => {
    const c = await createNode(uniq("E2E College"), 1, "COLLEGE", [uni]);
    college = c.body?.id;
    const d = await createNode(uniq("E2E Dept"), 2, "DEPARTMENT", [college]);
    dept = d.body?.id;
    const closure = await db.orgClosure.findMany({ where: { descendantId: dept } });
    const anc = closure.map((r) => r.ancestorId).sort();
    return { ok: c.status === 201 && d.status === 201 && anc.includes(uni) && anc.includes(college) && anc.includes(dept), evidence: { college: c.status, dept: d.status, ancestors: anc.length } };
  });

  await check(O, "O-02", "validation: non-adjacent level, level-0 with parent, level>0 without parent, empty name, unknown parent", async () => {
    const r = {
      nonAdjacent: (await createNode(uniq("bad"), 3, "DEPARTMENT", [uni])).status,
      rootWithParent: (await createNode(uniq("bad"), 0, "UNIVERSITY", [uni])).status,
      noParent: (await createNode(uniq("bad"), 2, "DEPARTMENT", [])).status,
      emptyName: (await createNode("", 1, "COLLEGE", [uni])).status,
      unknownParent: (await createNode(uniq("bad"), 1, "COLLEGE", ["does-not-exist"])).status,
    };
    return { ok: Object.values(r).every((s) => s === 400), evidence: r };
  });

  await check(O, "O-03", "name hygiene: 5,000-char name, whitespace-only name, and duplicate sibling name are refused", async () => {
    const long = await createNode("L".repeat(5000), 1, "COLLEGE", [uni]);
    const blank = await createNode("   ", 1, "COLLEGE", [uni]);
    const dup = await createNode("Software Engineering", 2, "DEPARTMENT", [coeec]);
    for (const r of [long, blank, dup]) if (r.status === 201) await del("admin", `/org/nodes/${r.body.id}`);
    return { ok: long.status === 400 && blank.status === 400 && dup.status === 400, evidence: { long5000: long.status, whitespaceOnly: blank.status, duplicateOfSE: dup.status } };
  });

  await check(O, "O-04", "multi-parent department: closure reaches both colleges and the root", async () => {
    const d = await createNode(uniq("E2E Joint Dept"), 2, "DEPARTMENT", [coeec, comcme]);
    const anc = (await db.orgClosure.findMany({ where: { descendantId: d.body?.id } })).map((r) => r.ancestorId);
    const ok = d.status === 201 && anc.includes(coeec) && anc.includes(comcme) && anc.includes(uni);
    if (d.status === 201) await del("admin", `/org/nodes/${d.body.id}`);
    return { ok, evidence: { status: d.status, ancestors: anc.length } };
  });

  await check(O, "O-05", "non-admins get 403 on every org write endpoint", async () => {
    const out: Record<string, number> = {};
    for (const a of ["headSe", "avp", "propadmin", "custSe", "procurement"]) {
      out[`${a}:create`] = (await createNodeAs(a)).status;
      out[`${a}:patch`] = (await patch(a, `/org/nodes/${se}`, { name: "hijack" })).status;
      out[`${a}:parents`] = (await put(a, `/org/nodes/${se}/parents`, { parentIds: [comcme] })).status;
      out[`${a}:deactivate`] = (await post(a, `/org/nodes/${dept}/deactivate`)).status;
      out[`${a}:delete`] = (await del(a, `/org/nodes/${dept}`)).status;
      out[`${a}:draft`] = (await post(a, `/org/nodes/${se}/draft-workflow`, { enabled: true })).status;
      out[`${a}:assign`] = (await post(a, `/people/${await userId("staff.se@e2e.test")}/assign-node`, { nodeId: dept })).status;
    }
    return { ok: Object.values(out).every((s) => s === 403), evidence: out };
  });

  await check(O, "O-06", "rename and kind change persist", async () => {
    const r1 = await patch("admin", `/org/nodes/${dept}`, { name: "E2E Dept Renamed" });
    const r2 = await patch("admin", `/org/nodes/${dept}`, { kind: "OFFICE" });
    const r3 = await patch("admin", `/org/nodes/${dept}`, { kind: "DEPARTMENT" });
    const row = await db.orgNode.findUniqueOrThrow({ where: { id: dept } });
    return { ok: r1.status === 200 && r2.status === 200 && r3.status === 200 && row.name === "E2E Dept Renamed" && row.kind === "DEPARTMENT", evidence: { r1: r1.status, r2: r2.status, r3: r3.status } };
  });

  await check(O, "O-07", "occupant assign → replace → vacate keeps a dated ledger and mails only new assignments", async () => {
    // Throwaway occupants, not the shared staff.se/staff.chem fixtures: assign-node
    // auto-grants MANAGER (F-017), which would make those shared actors heads for every
    // later suite (R-12, T-06, V-01b, V-06 all read them as plain STAFF).
    const a = await createPersonAt(se, "STAFF");
    const b = await createPersonAt(se, "STAFF");
    const seq = mailSeq();
    const r1 = await post("admin", `/people/${a}/assign-node`, { nodeId: dept, reason: "first" });
    const r2 = await post("admin", `/people/${b}/assign-node`, { nodeId: dept, reason: "replace" });
    const r3 = await post("admin", `/people/${b}/assign-node`, { nodeId: dept });
    const r4 = await post("admin", `/people/${b}/assign-node`, { nodeId: null });
    await new Promise((r) => setTimeout(r, 800));
    const ledger = await db.orgNodeAssignment.findMany({ where: { nodeId: dept }, orderBy: { startedAt: "asc" } });
    const node = await db.orgNode.findUniqueOrThrow({ where: { id: dept } });
    const mails = mailsSince(seq).filter((m) => /assigned/i.test(m.subject));
    const ok = [r1, r2, r3, r4].every((r) => r.status < 300) && node.userId === null && ledger.length === 2 && ledger.every((l) => l.endedAt) && mails.length === 2;
    return { ok, evidence: { statuses: [r1.status, r2.status, r3.status, r4.status], ledger: ledger.map((l) => ({ user: l.userId === a ? "A" : "B", ended: !!l.endedAt, reason: l.reason })), assignMails: mails.length } };
  });

  await check(O, "O-08", "reparent a department to another college: closure and the old dean's people view update", async () => {
    const staffHome = await createPersonAt(dept, "CUSTODIAN");
    const deanBefore = await get("deanCoeec", "/people");
    const r = await put("admin", `/org/nodes/${dept}/parents`, { parentIds: [comcme] });
    // move the whole college chain: dept was under the E2E college; now under CoMCME
    const anc = (await db.orgClosure.findMany({ where: { descendantId: dept } })).map((x) => x.ancestorId);
    const deanComcme = await get("deanComcme", "/people");
    const seen = Array.isArray(deanComcme.body) && deanComcme.body.some((p: any) => p.id === staffHome);
    const back = await put("admin", `/org/nodes/${dept}/parents`, { parentIds: [college] });
    return { ok: r.status === 200 && anc.includes(comcme) && !anc.includes(college) && seen && back.status === 200, evidence: { reparent: r.status, closureHasNewParent: anc.includes(comcme), deanComcmeSeesResident: seen, deanCoeecBefore: deanBefore.status } };
  });

  await check(O, "O-09", "H7 — change-level strands the node and its children (no parent, level mismatch)", async () => {
    const d = await createNode(uniq("E2E Level Dept"), 2, "DEPARTMENT", [college]);
    const child = await createNode(uniq("E2E Level Unit"), 3, "OFFICE", [d.body.id]);
    const r = await post("admin", `/org/nodes/${d.body.id}/change-level`, { level: 1 });
    const moved = await db.orgNode.findUniqueOrThrow({ where: { id: d.body.id }, include: { incomingEdges: true, outgoingEdges: true } });
    const orphan = await db.orgNode.findUniqueOrThrow({ where: { id: child.body.id }, include: { incomingEdges: true } });
    const ok = !(moved.level === 1 && moved.incomingEdges.length === 0) && !(orphan.level > 0 && orphan.incomingEdges.length === 0);
    await del("admin", `/org/nodes/${child.body.id}`);
    await del("admin", `/org/nodes/${d.body.id}`);
    return {
      ok,
      evidence: { changeLevel: r.status, movedNode: { level: moved.level, parents: moved.incomingEdges.length, children: moved.outgoingEdges.length }, formerChild: { level: orphan.level, parents: orphan.incomingEdges.length } },
      hypothesis: "H7",
    };
  });

  await check(O, "O-10", "H7 — a second level-0 UNIVERSITY node can be created and its occupant becomes a second AVP", async () => {
    const root2 = await createNode(uniq("E2E Second University"), 0, "UNIVERSITY", []);
    const holder = await createPersonAt(se, "STAFF");
    const assign = root2.status === 201 ? await post("admin", `/people/${holder}/assign-node`, { nodeId: root2.body.id }) : null;
    await mintAs("secondAvp", holder);
    const list = await get("secondAvp", "/external-requests");
    const ok = root2.status !== 201;
    if (root2.status === 201) {
      await post("admin", `/people/${holder}/assign-node`, { nodeId: null });
      await del("admin", `/org/nodes/${root2.body.id}`);
    }
    return { ok, evidence: { createSecondRoot: root2.status, assign: assign?.status, externalRequestsAsSecondAvp: list.status }, hypothesis: "H7" };
  });

  await check(O, "O-11", "H7 — deactivated node still grants its residents scope", async () => {
    const d = await createNode(uniq("E2E Inactive Dept"), 2, "DEPARTMENT", [college]);
    const resident = await createPersonAt(d.body.id, "CUSTODIAN");
    const deact = await post("admin", `/org/nodes/${d.body.id}/deactivate`);
    await mintAs("inactiveResident", resident);
    const me = await get("inactiveResident", "/auth/me");
    return { ok: !(me.status === 200 && me.body?.scope?.nodeId === d.body.id), evidence: { deactivate: deact.status, meScope: me.body?.scope }, hypothesis: "H7" };
  });

  await check(O, "O-12", "H5 — deactivating a node disables an occupant who still custodies resources", async () => {
    const d = await createNode(uniq("E2E Custody Dept"), 2, "DEPARTMENT", [college]);
    const head = await createPersonAt(d.body.id, "MANAGER");
    await post("admin", `/people/${head}/assign-node`, { nodeId: d.body.id });
    const lab = await db.resourceCategory.findFirstOrThrow({ where: { key: "lab" } });
    const create = await post("admin", "/resources/items/changes", { kind: "createItem", categoryId: lab.id, count: 1, parentId: null, ownerOrgNodeId: d.body.id, custodianId: head, name: uniq("E2E Head Lab") });
    const deact = await post("admin", `/org/nodes/${d.body.id}/deactivate`);
    const user = await db.user.findUniqueOrThrow({ where: { id: head } });
    const custody = await db.item.count({ where: { custodianId: head } });
    return { ok: !(user.status === "DISABLED" && custody > 0), evidence: { createLab: create.status, deactivate: ev(deact), userStatus: user.status, itemsStillInTheirCustody: custody }, hypothesis: "H5" };
  });

  await check(O, "O-13", "H6 — delete refuses cleanly (400 naming the blocker) when the node carries purchasing needs", async () => {
    const d = await createNode(uniq("E2E Need Dept"), 2, "DEPARTMENT", [college]);
    const raiser = await createPersonAt(d.body.id, "STAFF");
    await mintAs("needRaiser", raiser);
    const need = await post("needRaiser", "/resources/needs", { name: "Oscilloscope", qty: 1, reason: "E2E" });
    // the raiser later moves to another department (no API for that — see P suite)
    await db.user.update({ where: { id: raiser }, data: { homeNodeId: se } });
    const r = await del("admin", `/org/nodes/${d.body.id}`);
    return { ok: r.status === 400, evidence: { need: need.status, deleteNode: ev(r) }, hypothesis: "H6" };
  });

  await check(O, "O-14", "delete blockers: node with a child refused; clean leaf deletes and closure rows go", async () => {
    const parentDel = await del("admin", `/org/nodes/${college}`);
    const leaf = await createNode(uniq("E2E Leaf"), 2, "DEPARTMENT", [college]);
    const leafDel = await del("admin", `/org/nodes/${leaf.body.id}`);
    const closure = await db.orgClosure.count({ where: { OR: [{ ancestorId: leaf.body.id }, { descendantId: leaf.body.id }] } });
    return { ok: parentDel.status === 400 && leafDel.status === 200 && closure === 0, evidence: { deleteParent: ev(parentDel), deleteLeaf: leafDel.status, closureLeft: closure } };
  });

  await check(O, "O-15", "unknown ids return 404, never 500", async () => {
    const r = {
      patch: (await patch("admin", "/org/nodes/nope", { name: "x" })).status,
      del: (await del("admin", "/org/nodes/nope")).status,
      parents: (await put("admin", "/org/nodes/nope/parents", { parentIds: [uni] })).status,
      level: (await post("admin", "/org/nodes/nope/change-level", { level: 1 })).status,
      deact: (await post("admin", "/org/nodes/nope/deactivate")).status,
      react: (await post("admin", "/org/nodes/nope/reactivate")).status,
      draft: (await post("admin", "/org/nodes/nope/draft-workflow", { enabled: true })).status,
      edge: (await post("admin", "/org/edges", { parentId: "nope", childId: se })).status,
      assign: (await post("admin", `/people/${await userId("staff.se@e2e.test")}/assign-node`, { nodeId: "nope" })).status,
    };
    return { ok: Object.values(r).every((s) => s === 404 || s === 400), evidence: r };
  });

  await check(O, "O-16", "H7 — renaming the Procurement Office silently breaks purchase compilation", async () => {
    const proc = await nodeId("Procurement Office");
    await patch("admin", `/org/nodes/${proc}`, { name: "Procurement & Supplies Office" });
    const r = await post("headSe", "/resources/purchase-requests", { orgNodeId: se, title: "E2E rename probe", lines: [{ name: "Cable", qty: 1, fromNeedIds: [] }] });
    await patch("admin", `/org/nodes/${proc}`, { name: "Procurement Office" });
    if (r.status < 300) await post("headSe", `/resources/purchase-requests/${r.body.id}/cancel`);
    return { ok: r.status < 300, evidence: ev(r), hypothesis: "H7" };
  });

  await check(O, "O-17", "concurrent structural edits keep the closure table consistent (5 parallel reparents)", async () => {
    const nodes = await Promise.all([1, 2, 3, 4, 5].map((i) => createNode(uniq(`E2E Race ${i}`), 2, "DEPARTMENT", [college])));
    const results = await Promise.all(nodes.map((n, i) => put("admin", `/org/nodes/${n.body.id}/parents`, { parentIds: [i % 2 ? coeec : comcme] })));
    const bad: string[] = [];
    for (const [i, n] of nodes.entries()) {
      const anc = (await db.orgClosure.findMany({ where: { descendantId: n.body.id } })).map((x) => x.ancestorId);
      if (!anc.includes(i % 2 ? coeec : comcme) || !anc.includes(uni)) bad.push(n.body.id);
    }
    for (const n of nodes) await del("admin", `/org/nodes/${n.body.id}`);
    return { ok: results.every((r) => r.status === 200) && bad.length === 0, evidence: { statuses: results.map((r) => r.status), nodesWithWrongClosure: bad.length } };
  });

  await done();
}

async function createNodeAs(actor: string) {
  const uni = await nodeId("Adama Science and Technology University");
  return post(actor, "/org/nodes", { name: uniq("nope"), level: 1, kind: "COLLEGE", parentIds: [uni] });
}

async function createPersonAt(homeNodeId: string, role: string): Promise<string> {
  const email = `${uniq("o-person")}@e2e.test`;
  const r = await post("admin", "/people", { name: `O ${role}`, email, roles: [role], homeNodeId });
  if (r.status !== 201) throw new Error(`could not create person: ${r.status} ${JSON.stringify(r.body)}`);
  // Invited accounts have no password; activate directly so they can hold sessions.
  await db.user.update({ where: { id: r.body.id }, data: { status: "ACTIVE" } });
  return r.body.id;
}

main();
