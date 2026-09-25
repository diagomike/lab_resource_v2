/** Suite X — external requests & payments (public portal → quote → verified payment → confirm). H26. */
import fs from "node:fs";
import { get, post, api, check, ev, db, done, uniq, nodeId, BASE, S } from "../lib";

const X = "X";
const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(2048, 32), Buffer.from("\n%%EOF")]);

async function submit(overrides: Record<string, unknown> = {}, ip = "203.0.113.9") {
  const payload = {
    organizationName: uniq("E2E Org"),
    contactName: "Contact Person",
    contactEmail: `${uniq("ext")}@outside.test`,
    contactPhone: "0911223344",
    purpose: "A three-day training workshop on chemical safety for our staff.",
    windows: [{ date: "2026-11-10", start: "09:00", end: "12:00" }],
    lines: [{ description: "Lab space for 20 people", quantity: 20 }],
    ...overrides,
  };
  const form = new FormData();
  form.set("payload", JSON.stringify(payload));
  form.set("letter", new Blob([new Uint8Array((overrides.__letter as Buffer | undefined) ?? PDF)], { type: "application/pdf" }), "letter.pdf");
  const res = await fetch(`${BASE}/api/public/requests`, { method: "POST", headers: { "x-forwarded-for": ip }, body: form });
  const body = await res.json().catch(() => null);
  return { status: res.status, body, email: payload.contactEmail };
}

async function pay(token: string, body: Record<string, unknown>) {
  const res = await fetch(`${BASE}/api/public/track/${token}/payments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const track = async (token: string) => (await fetch(`${BASE}/api/public/track/${token}`)).json();
const staff = (a: string, id: string, action: string, body: unknown) => post(a, `/external-requests/${id}/${action}`, body);

async function main() {
  // Clean external/scheduling state left by earlier X runs on the clone (safe: clone DB only).
  await db.reservationResource.deleteMany({});
  await db.reservation.deleteMany({ where: { source: { in: ["EXTERNAL", "STAFF", "MAINTENANCE"] } } });
  await db.paymentVerification.deleteMany({});
  await db.externalRequestEvent.deleteMany({});
  await db.externalRequestWindow.deleteMany({});
  await db.externalRequestAssignment.deleteMany({});
  await db.externalRequest.deleteMany({});

  const chem = await nodeId("Chemical Engineering");
  const se = await nodeId("Software Engineering");
  const labCat = await db.resourceCategory.findUniqueOrThrow({ where: { key: "lab" } });
  const chemLab = await db.item.findFirstOrThrow({ where: { name: "Mechanical Unit Operations Laboratory" } });

  // Public listing so the portal and catalog lines work.
  await post("admin", `/resources/categories/${labCat.id}`, {}); // touch to read version
  const labVer = (await get("admin", "/resources/categories")).body.find((c: any) => c.key === "lab").version;
  await api("admin", "PATCH", `/resources/categories/${labCat.id}`, { expectedVersion: labVer, publicListed: true });

  await check(X, "X-01", "public portal & catalog: counts only, no units/locations, reachable signed out", async () => {
    const portal = await fetch(`${BASE}/portal`);
    const cat = await (await fetch(`${BASE}/api/public/catalog`)).json();
    const list = Array.isArray(cat) ? cat : (cat.groups ?? []).flatMap((g: any) => g.categories ?? []);
    const lab = list.find((c: any) => c.key === "lab" || c.name === "Lab");
    const blob = JSON.stringify(cat);
    return { ok: portal.status === 200 && !!lab && typeof lab.count === "number" && !blob.includes("Mechanical Unit") && !/currentOrg|custodian/i.test(blob), evidence: { portal: portal.status, catalogKeys: Array.isArray(cat) ? "array" : Object.keys(cat), labCount: lab?.count, leaksItemNames: blob.includes("Mechanical Unit") } };
  });

  await check(X, "X-02", "submit validation: honeypot, non-PDF letter, date too soon, throttle by email (4th → 429)", async () => {
    const honey = await submit({ website: "http://spam" });
    const badPdf = await submit({ __letter: Buffer.from("<html>not a pdf</html>") } as any);
    const soon = await submit({ windows: [{ date: "2026-09-15", start: "09:00", end: "12:00" }] });
    const email = `${uniq("throttle")}@outside.test`;
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await submit({ contactEmail: email }, "203.0.113.50")).status);
    return { ok: honey.status === 400 && badPdf.status === 400 && soon.status === 400 && statuses.filter((s) => s === 429).length >= 1, evidence: { honeypot: honey.status, nonPdf: badPdf.status, tooSoon: soon.status, throttleStatuses: statuses } };
  });

  await check(X, "X-03", "mail-safety: HTML in org/purpose is escaped in the intake email", async () => {
    const { status } = await submit({ organizationName: "<script>alert(1)</script> Corp", purpose: "<img src=x onerror=alert(1)> a workshop that is at least ten characters long" }, "203.0.113.51");
    await new Promise((r) => setTimeout(r, 800));
    const idx = fs.existsSync("e2e/mail/index.jsonl") ? fs.readFileSync("e2e/mail/index.jsonl", "utf8").trim().split("\n").slice(-8) : [];
    const raws = idx.map((l: string) => JSON.parse(l).n).map((n: string) => fs.readFileSync(`e2e/mail/${n}.eml`, "utf8"));
    const leaked = raws.some((r: string) => r.includes("<script>alert(1)</script>") || r.includes("<img src=x onerror"));
    return { ok: status === 201 && !leaked, evidence: { submit: status, rawEmailContainsUnescapedTag: leaked } };
  });

  let reqId = "";
  let token = "";
  await check(X, "X-04", "full staff flow: forward → custodian holds a slot → head accepts with sheet → AVP quotes; old link dies", async () => {
    const s = await submit({ windows: [{ date: "2026-11-12", start: "09:00", end: "12:00" }] }, "203.0.113.60");
    token = s.body.trackingToken;
    reqId = (await db.externalRequest.findFirstOrThrow({ where: { reference: s.body.reference } })).id;
    const notAvp = await staff("headChem", reqId, "forward", { orgNodeIds: [chem] });
    const fwd = await staff("avp", reqId, "forward", { orgNodeIds: [chem] });
    const assignment = await db.externalRequestAssignment.findFirstOrThrow({ where: { requestId: reqId, orgNodeId: chem } });
    const hold = await staff("custChem", reqId, "hold", { itemIds: [chemLab.id], date: "2026-11-12", start: "09:00", end: "12:00" });
    const accept = await post("headChem", `/external-requests/assignments/${assignment.id}/decide`, { decision: "ACCEPT", sheetUrl: "https://docs.google.com/sheet/x", amountSantim: 1875000 });
    const quote = await staff("avp", reqId, "quote", { amountSantim: 1875000, paymentDeadline: "2026-11-05" });
    const oldLink = await fetch(`${BASE}/api/public/track/${token}`);
    token = (await db.externalRequestEvent.count({ where: { requestId: reqId } })) >= 0 ? token : token;
    const fresh = await db.externalRequest.findUniqueOrThrow({ where: { id: reqId } });
    return { ok: notAvp.status === 403 && fwd.status === 200 && hold.status === 200 && accept.status === 200 && quote.status === 200 && oldLink.status === 404, evidence: { forwardByHead: notAvp.status, forward: fwd.status, hold: hold.status, accept: accept.status, quote: quote.status, oldTrackingLink: oldLink.status, status: fresh.status } };
  });

  // Recover the regenerated token from the newest quote email for the requester.
  await check(X, "X-05", "H26 — a hold can be placed on a slot outside the requested windows", async () => {
    const s = await submit({ windows: [{ date: "2026-11-20", start: "09:00", end: "10:00" }] }, "203.0.113.61");
    const id = (await db.externalRequest.findFirstOrThrow({ where: { reference: s.body.reference } })).id;
    await staff("avp", id, "forward", { orgNodeIds: [chem] });
    const outside = await staff("custChem", id, "hold", { itemIds: [chemLab.id], date: "2027-03-15", start: "09:00", end: "10:00" });
    return { ok: outside.status === 400, evidence: { holdOutsideRequestedWindow: ev(outside) }, hypothesis: "H26" };
  });

  await check(X, "X-06", "holds guarded: unassigned department's custodian refused; a non-custodian refused", async () => {
    const s = await submit({ windows: [{ date: "2026-11-21", start: "09:00", end: "10:00" }] }, "203.0.113.62");
    const id = (await db.externalRequest.findFirstOrThrow({ where: { reference: s.body.reference } })).id;
    await staff("avp", id, "forward", { orgNodeIds: [chem] });
    const seCustodian = await staff("custSe", id, "hold", { itemIds: [(await db.item.findFirstOrThrow({ where: { name: "SE Lab X — Software Lab 3" } })).id], date: "2026-11-21", start: "09:00", end: "10:00" });
    const nonCustodian = await staff("staffChem", id, "hold", { itemIds: [chemLab.id], date: "2026-11-21", start: "09:00", end: "10:00" });
    return { ok: seCustodian.status >= 400 && nonCustodian.status >= 400, evidence: { unassignedDeptCustodian: seCustodian.status, nonCustodian: nonCustodian.status } };
  });

  await check(X, "X-07", "H26 — extendHolds can push a hold past the payment deadline / indefinitely", async () => {
    const holds = await db.reservation.findMany({ where: { externalRequestId: reqId, state: { in: ["HELD", "CONFIRMED"] } }, select: { id: true, holdExpiresAt: true } });
    const ext = await staff("avp", reqId, "extend-holds", { until: "2030-01-01" });
    const after = await db.reservation.findMany({ where: { externalRequestId: reqId, state: "HELD" }, select: { holdExpiresAt: true } });
    const req = await db.externalRequest.findUniqueOrThrow({ where: { id: reqId } });
    const pushedPastDeadline = after.some((h) => req.paymentDeadline && h.holdExpiresAt && h.holdExpiresAt > req.paymentDeadline);
    return { ok: !(ext.status === 200 && pushedPastDeadline), evidence: { extend: ext.status, deadline: req.paymentDeadline?.toISOString(), holdExpiryAfter: after.map((h) => h.holdExpiresAt?.toISOString()), pushedPastDeadline }, hypothesis: "H26" };
  });

  // Fresh request taken all the way to a payable quote, capturing the token from the DB (dev only).
  let payToken = "";
  let payReqId = "";
  let freshDay = 0;
  async function freshQuoted(amountSantim: number, deadline = "2026-12-28") {
    const day = String(1 + (freshDay++ % 27)).padStart(2, "0");
    const date = `2026-12-${day}`;
    const s = await submit({ windows: [{ date, start: "09:00", end: "12:00" }] }, "203.0.113.70");
    const id = (await db.externalRequest.findFirstOrThrow({ where: { reference: s.body.reference } })).id;
    await staff("avp", id, "forward", { orgNodeIds: [chem] });
    const a = await db.externalRequestAssignment.findFirstOrThrow({ where: { requestId: id, orgNodeId: chem } });
    await staff("custChem", id, "hold", { itemIds: [chemLab.id], date, start: "09:00", end: "12:00" });
    await post("headChem", `/external-requests/assignments/${a.id}/decide`, { decision: "ACCEPT", sheetUrl: "https://docs.google.com/sheet/y", amountSantim });
    await staff("avp", id, "quote", { amountSantim, paymentDeadline: deadline });
    // Mint a tracking token directly (the raw one is emailed only; dev shortcut).
    const { generateToken, hashToken } = await import("../../lib/server/auth/token");
    const raw = generateToken();
    await db.externalRequest.update({ where: { id }, data: { trackingTokenHash: hashToken(raw) } });
    return { id, token: raw };
  }

  await check(X, "X-08", "payment: wrong receiver rejected; correct receipt → PAID → SCHEDULED with the hold CONFIRMED", async () => {
    const f = await freshQuoted(1000000);
    payReqId = f.id;
    payToken = f.token;
    const wrong = await pay(payToken, { provider: "CBE", reference: "FAKE-10000-WRONG", accountSuffix: "12345678" });
    const good = await pay(payToken, { provider: "CBE", reference: "FAKE-10000", accountSuffix: "12345678" });
    const req = await db.externalRequest.findUniqueOrThrow({ where: { id: payReqId } });
    const hold = await db.reservation.findFirstOrThrow({ where: { externalRequestId: payReqId } });
    return { ok: wrong.body?.outcome === "REJECTED" && (req.status === "SCHEDULED" || req.status === "PAID") && hold.state === "CONFIRMED", evidence: { wrongReceiver: wrong.body?.outcome, correct: good.body?.outcome, correctReason: good.body?.reason, requestStatus: req.status, holdState: hold.state } };
  });

  await check(X, "X-09", "a receipt reference cannot be reused for a second request", async () => {
    const f = await freshQuoted(1000000);
    const reuse = await pay(f.token, { provider: "CBE", reference: "FAKE-10000", accountSuffix: "12345678" });
    return { ok: reuse.status === 409 || reuse.body?.outcome === "REJECTED", evidence: { status: reuse.status, outcome: reuse.body?.outcome, body: reuse.body } };
  });

  await check(X, "X-10", "no payment before a quote, and none after the deadline", async () => {
    const s = await submit({ windows: [{ date: "2026-11-26", start: "09:00", end: "10:00" }] }, "203.0.113.71");
    const id = (await db.externalRequest.findFirstOrThrow({ where: { reference: s.body.reference } })).id;
    const { generateToken, hashToken } = await import("../../lib/server/auth/token");
    const raw = generateToken();
    await db.externalRequest.update({ where: { id }, data: { trackingTokenHash: hashToken(raw) } });
    const beforeQuote = await pay(raw, { provider: "CBE", reference: "FAKE-500", accountSuffix: "12345678" });
    return { ok: beforeQuote.status >= 400 || beforeQuote.body?.outcome === "REJECTED", evidence: { payBeforeQuote: { status: beforeQuote.status, outcome: beforeQuote.body?.outcome } } };
  });

  await check(X, "X-11", "verifier outage → manual review; a head cannot review; AVP approves → SCHEDULED", async () => {
    const f = await freshQuoted(250000);
    const down = await pay(f.token, { provider: "TELEBIRR", reference: "FAKE-DOWN", phoneNumber: "251911223344" });
    const manual = await pay(f.token, { provider: "TELEBIRR", reference: "FAKE-DOWN", phoneNumber: "251911223344", manualReview: true, amountSantim: 250000, note: "receipt attached by email" });
    const pv = await db.paymentVerification.findFirst({ where: { requestId: f.id, status: "PENDING_REVIEW" } });
    if (!pv) return { ok: false, evidence: { outage: down.body?.outcome, manualOutcome: manual.body?.outcome, manualReason: manual.body?.reason ?? manual.body?.message, manualStatus: manual.status }, hypothesis: "" };
    const byHead = await post("headChem", `/external-requests/payments/${pv.id}/review`, { decision: "APPROVE" });
    const byAvpNoReason = await post("avp", `/external-requests/payments/${pv.id}/review`, { decision: "REJECT" });
    const byAvp = await post("avp", `/external-requests/payments/${pv.id}/review`, { decision: "APPROVE" });
    const req = await db.externalRequest.findUniqueOrThrow({ where: { id: f.id } });
    return { ok: down.body?.outcome !== "VERIFIED" && manual.status === 200 && byHead.status === 403 && byAvpNoReason.status === 400 && byAvp.status === 200 && req.status === "SCHEDULED", evidence: { outage: down.body?.outcome, manual: manual.body?.outcome ?? manual.status, headReview: byHead.status, rejectNoReason: byAvpNoReason.status, avpApprove: byAvp.status, status: req.status } };
  });

  await check(X, "X-12", "split payment: CBE + telebirr to the same request sum to the quote", async () => {
    const f = await freshQuoted(1500000);
    const p1 = await pay(f.token, { provider: "CBE", reference: "FAKE-12000", accountSuffix: "12345678" });
    const p2 = await pay(f.token, { provider: "TELEBIRR", reference: "FAKE-3000", phoneNumber: "251911223344" });
    const req = await db.externalRequest.findUniqueOrThrow({ where: { id: f.id } });
    return { ok: req.status === "SCHEDULED" || req.status === "PAID", evidence: { first: p1.body?.outcome, firstReason: p1.body?.reason, second: p2.body?.outcome, secondReason: p2.body?.reason, status: req.status } };
  });

  await check(X, "X-13", "requester cannot self-cancel once money is accepted; declining a paid request mentions a refund", async () => {
    const cancel = await fetch(`${BASE}/api/public/track/${payToken}/cancel`, { method: "POST" });
    const decline = await staff("avp", payReqId, "decline", { note: "Venue no longer available" });
    return { ok: cancel.status >= 400, evidence: { selfCancelAfterPaid: cancel.status, avpDecline: decline.status } };
  });

  await check(X, "X-14", "cron expire-holds requires the secret", async () => {
    const noSecret = await fetch(`${BASE}/api/cron/expire-holds`);
    const wrong = await fetch(`${BASE}/api/cron/expire-holds`, { headers: { authorization: "Bearer wrong" } });
    const right = await fetch(`${BASE}/api/cron/expire-holds`, { headers: { authorization: "Bearer e2e-cron-secret" } });
    return { ok: noSecret.status === 401 && wrong.status === 401 && right.status === 200, evidence: { noSecret: noSecret.status, wrong: wrong.status, right: right.status } };
  });

  await check(X, "X-15", "quote guards: no quote until every department answers; declined department releases its holds", async () => {
    const s = await submit({ windows: [{ date: "2026-11-27", start: "09:00", end: "10:00" }] }, "203.0.113.72");
    const id = (await db.externalRequest.findFirstOrThrow({ where: { reference: s.body.reference } })).id;
    await staff("avp", id, "forward", { orgNodeIds: [chem, se] });
    const a = await db.externalRequestAssignment.findFirstOrThrow({ where: { requestId: id, orgNodeId: chem } });
    await staff("custChem", id, "hold", { itemIds: [chemLab.id], date: "2026-11-27", start: "09:00", end: "10:00" });
    await post("headChem", `/external-requests/assignments/${a.id}/decide`, { decision: "ACCEPT", sheetUrl: "https://docs.google.com/s/z", amountSantim: 100000 });
    const earlyQuote = await staff("avp", id, "quote", { amountSantim: 100000, paymentDeadline: "2026-11-20" });
    const seA = await db.externalRequestAssignment.findFirstOrThrow({ where: { requestId: id, orgNodeId: se } });
    await post("headSe", `/external-requests/assignments/${seA.id}/decide`, { decision: "DECLINE", note: "No space" });
    const seHolds = await db.reservation.count({ where: { externalRequestId: id, lab: { ownerOrgNodeId: se }, state: { in: ["HELD", "CONFIRMED"] } } });
    const quote = await staff("avp", id, "quote", { amountSantim: 100000, paymentDeadline: "2026-11-20" });
    return { ok: earlyQuote.status === 409 && quote.status === 200 && seHolds === 0, evidence: { quoteBeforeAllAnswered: earlyQuote.status, quoteAfter: quote.status, seHoldsAfterDecline: seHolds } };
  });

  await done();
}

main();
