import { post, db, S, nodeId } from "./lib";
async function main() {
  const se = await nodeId("Software Engineering");
  const reqs = await db.purchaseRequest.findMany({ where: { stage: "REVISING" }, include: { lines: { include: { answeredNeeds: true } } }, orderBy: { createdAt: "asc" } });
  const r = reqs[0];
  const needIds = r.lines.flatMap((l) => l.answeredNeeds.map((n) => n.id));
  console.log("revising", r.reference, "carried needs", needIds, (await db.needLine.findMany({ where: { id: { in: needIds } } })).map((n) => n.status));
  const res = await fetch(`http://localhost:3100/api/resources/purchase-requests/${r.id}`, { method: "PUT", headers: { cookie: `lrms_session=${S.headSe.token}`, "content-type": "application/json" }, body: JSON.stringify({ orgNodeId: se, title: r.title, lines: [{ name: "Oscilloscope", qty: 2, fromNeedIds: needIds }] }) });
  console.log("resubmit with carried need:", res.status, await res.text());
  const res2 = await fetch(`http://localhost:3100/api/resources/purchase-requests/${r.id}`, { method: "PUT", headers: { cookie: `lrms_session=${S.headSe.token}`, "content-type": "application/json" }, body: JSON.stringify({ orgNodeId: se, title: r.title, lines: [{ name: "Oscilloscope", qty: 2, fromNeedIds: [] }] }) });
  console.log("resubmit without need ids:", res2.status, (await res2.text()).slice(0, 200));
  const refs = await db.purchaseRequest.findMany({ select: { reference: true }, orderBy: { reference: "asc" } });
  console.log("refs", refs.map((x) => x.reference).join(","), "count", refs.length);
  await db.$disconnect();
}
main();
