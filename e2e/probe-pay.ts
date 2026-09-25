import { post, get, api, db, S, nodeId, BASE } from "./lib";
const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(1024, 32), Buffer.from("\n%%EOF")]);
async function main() {
  const chem = await nodeId("Chemical Engineering");
  const chemLab = await db.item.findFirstOrThrow({ where: { name: "Mechanical Unit Operations Laboratory" } });
  const form = new FormData();
  form.set("payload", JSON.stringify({ organizationName: "Pay Probe " + Date.now(), contactName: "C", contactEmail: `pp${Date.now()}@outside.test`, contactPhone: "0911223344", purpose: "workshop at least ten chars", windows: [{ date: "2026-11-25", start: "09:00", end: "12:00" }], lines: [{ description: "space", quantity: 5 }] }));
  form.set("letter", new Blob([PDF], { type: "application/pdf" }), "letter.pdf");
  const s = await (await fetch(`${BASE}/api/public/requests`, { method: "POST", headers: { "x-forwarded-for": "203.0.113.90" }, body: form })).json();
  const id = (await db.externalRequest.findFirstOrThrow({ where: { reference: s.reference } })).id;
  await post("avp", `/external-requests/${id}/forward`, { orgNodeIds: [chem] });
  const a = await db.externalRequestAssignment.findFirstOrThrow({ where: { requestId: id, orgNodeId: chem } });
  const hold = await post("custChem", `/external-requests/${id}/hold`, { itemIds: [chemLab.id], date: "2026-11-25", start: "09:00", end: "12:00" });
  const acc = await post("headChem", `/external-requests/assignments/${a.id}/decide`, { decision: "ACCEPT", sheetUrl: "https://docs.google.com/s/a", amountSantim: 1000000 });
  const q = await post("avp", `/external-requests/${id}/quote`, { amountSantim: 1000000, paymentDeadline: "2026-11-28" });
  const { generateToken, hashToken } = await import("../lib/server/auth/token");
  const raw = generateToken();
  await db.externalRequest.update({ where: { id }, data: { trackingTokenHash: hashToken(raw) } });
  const payRes = await fetch(`${BASE}/api/public/track/${raw}/payments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "CBE", reference: "FAKE-10000-" + Date.now(), accountSuffix: "12345" }) });
  console.log("hold", hold.status, "acc", acc.status, "quote", q.status);
  console.log("pay", payRes.status, JSON.stringify(await payRes.json()).slice(0, 400));
  await db.$disconnect();
}
main();
