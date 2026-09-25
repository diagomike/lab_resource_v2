import { post, del, check, db, done, uniq, nodeId } from "../lib";
async function main() {
  const coeec = await nodeId("College of Electrical Engineering and Computing");
  const uni = await nodeId("Adama Science and Technology University");
  await check("O", "O-17b", "8 parallel node creations: all succeed and every node gets complete closure rows", async () => {
    const tag = uniq("E2E ParCreate");
    const res = await Promise.all([...Array(8)].map((_, i) => post("admin", "/org/nodes", { name: `${tag} ${i}`, level: 2, kind: "DEPARTMENT", parentIds: [coeec] })));
    const rows = await db.orgNode.findMany({ where: { name: { startsWith: tag } } });
    const broken: string[] = [];
    for (const n of rows) {
      const anc = (await db.orgClosure.findMany({ where: { descendantId: n.id } })).map((x) => x.ancestorId);
      if (!anc.includes(coeec) || !anc.includes(uni) || !anc.includes(n.id)) broken.push(n.name);
    }
    const bodies = res.filter((r) => r.status >= 400).map((r) => r.body?.message);
    for (const n of rows) await del("admin", `/org/nodes/${n.id}`);
    return { ok: res.every((r) => r.status === 201) && broken.length === 0 && rows.length === 8, evidence: { statuses: res.map((r) => r.status), errors: bodies, nodeRowsCreated: rows.length, nodesMissingClosure: broken.length } };
  });
  await done();
}
main();
