/** Suite X — external requests & payments. H26.
 *  2026-10-02: rebuilt for the account-based portal (2026-09-28): an outside requester signs in
 *  and sends the request (letter attached); the AVP forwards it to a college, the dean to a
 *  department, the head asks a custodian to hold a slot; the answer goes back up (head →
 *  dean → AVP), the AVP quotes; the requester pays on their request's page, and the AVP
 *  confirms the payment. Same check ids where the intent survives.
 *  2026-10-03: the contact persons are the custodians holding the places, from their own
 *  profiles (lab setups, booking and holds are the approval-lines validator's P10). */
import fs from "node:fs";
import { get, post, api, check, ev, db, done, uniq, nodeId, mintAs, BASE, S } from "../lib";

const X = "X";
const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(2048, 32), Buffer.from("\n%%EOF")]);

/** A verified outside requester's account, signed in (the sign-up and email check are the
 *  approval-lines validator's P10). */
async function requester(key: string): Promise<string> {
  const email = `${uniq(key)}@outside.test`;
  const user = await db.user.create({ data: { email, emailLower: email, name: "Ms. Outside Requester", organisation: "E2E Org", phone: "0911223344", status: "ACTIVE", roles: { create: [{ kind: "EXTERNAL" }] } } });
  await mintAs(key, user.id);
  return email;
}

async function submit(who: string, overrides: Record<string, unknown> = {}, ip = "203.0.113.9") {
  const payload = {
    kind: "FACILITY",
    organizationName: uniq("E2E Org"),
    contactName: "Contact Person",
    contactEmail: S[who].email,
    contactPhone: "0911223344",
    purpose: "A three-day training workshop on chemical safety for our staff.",
    windows: [{ date: "2026-11-10", start: "09:00", end: "12:00" }],
    lines: [{ description: "Lab space for 20 people", quantity: 20 }],
    ...overrides,
  };
  const form = new FormData();
  form.set("payload", JSON.stringify(payload));
  form.set("letter", new Blob([new Uint8Array((overrides.__letter as Buffer | undefined) ?? PDF)], { type: "application/pdf" }), "letter.pdf");
  return api(who, "POST", "/portal/requests", form, { "x-forwarded-for": ip });
}

const pay = (who: string, id: string, body: Record<string, unknown>) => post(who, `/portal/requests/${id}/payments`, body);
const staff = (a: string, id: string, action: string, body: unknown) => post(a, `/external-requests/${id}/${action}`, body);

async function main() {
  // Clean external/scheduling state left by earlier X runs on the clone (safe: clone DB only).
  await db.reservationResource.deleteMany({ where: { reservation: { externalRequestId: { not: null } } } });
  await db.reservation.deleteMany({ where: { externalRequestId: { not: null } } });
  await db.paymentVerification.deleteMany({});
  await db.externalRequestEvent.deleteMany({});
  await db.externalRequestWindow.deleteMany({});
  await db.externalCustodianTask.deleteMany({});
  await db.externalRequestAssignment.deleteMany({});
  await db.externalRequest.deleteMany({});

  const coeec = await nodeId("College of Electrical Engineering and Computing");
  const comcme = await nodeId("College of Mechanical, Chemical and Materials Engineering");
  const chem = await nodeId("Chemical Engineering");
  const se = await nodeId("Software Engineering");
  const labCat = await db.resourceCategory.findUniqueOrThrow({ where: { key: "lab" } });
  const chemLab = await db.item.findFirstOrThrow({ where: { name: "Mechanical Unit Operations Laboratory" } });
  const seLab = await db.item.findFirstOrThrow({ where: { name: "SE Lab X Software Lab 3" } });

  // Public listing so the portal and catalog lines work.
  const labVer = (await get("admin", "/resources/categories")).body.find((c: any) => c.key === "lab").version;
  await api("admin", "PATCH", `/resources/categories/${labCat.id}`, { expectedVersion: labVer, publicListed: true });
  await requester("reqMain");
  // The contact persons are the custodians holding the places (2026-10-02): each needs a
  // phone on their profile, which they set themselves.
  await post("custChem", "/auth/phone", { phone: "+251911000111" });
  await post("custSe", "/auth/phone", { phone: "+251911000222" });

  /** Down the line: AVP → CoMCME's dean → ChemE's head, who asks Hanna to hold her lab. */
  async function toChemCustodian(id: string) {
    await staff("avp", id, "forward", { orgNodeIds: [comcme] });
    const college = await db.externalRequestAssignment.findFirstOrThrow({ where: { requestId: id, orgNodeId: comcme } });
    await post("deanComcme", `/external-requests/assignments/${college.id}/forward`, { orgNodeIds: [chem] });
    const dept = await db.externalRequestAssignment.findFirstOrThrow({ where: { requestId: id, orgNodeId: chem } });
    await post("headChem", `/external-requests/assignments/${dept.id}/assign`, { tasks: [{ custodianId: S.custChem.id, want: "Your lab, mornings" }] });
    return { college: college.id, dept: dept.id };
  }
  /** Back up the line: Hanna's task done, the head answers, the dean approves and answers, the AVP approves. */
  async function answerUp(id: string, parts: { college: string; dept: string }, amountSantim: number) {
    const task = await db.externalCustodianTask.findFirstOrThrow({ where: { assignmentId: parts.dept } });
    await post("custChem", `/external-requests/tasks/${task.id}/finish`, { outcome: "DONE" });
    await post("headChem", `/external-requests/assignments/${parts.dept}/submit`, { sheetUrl: "https://docs.google.com/sheet/x", amountSantim });
    await post("deanComcme", `/external-requests/assignments/${parts.dept}/review`, { decision: "APPROVE" });
    await post("deanComcme", `/external-requests/assignments/${parts.college}/submit`, { note: "ChemE hosts it" });
    return post("avp", `/external-requests/assignments/${parts.college}/review`, { decision: "APPROVE" });
  }

  await check(X, "X-01", "public portal & catalog: counts only, no units/locations, reachable signed out", async () => {
    const portal = await fetch(`${BASE}/portal`);
    const cat = await (await fetch(`${BASE}/api/public/catalog`)).json();
    const list = Array.isArray(cat) ? cat : (cat.groups ?? []).flatMap((g: any) => g.categories ?? []);
    const lab = list.find((c: any) => c.key === "lab" || c.name === "Lab");
    const blob = JSON.stringify(cat);
    return { ok: portal.status === 200 && !!lab && typeof lab.count === "number" && !blob.includes("Mechanical Unit") && !/currentOrg|custodian/i.test(blob), evidence: { portal: portal.status, catalogKeys: Array.isArray(cat) ? "array" : Object.keys(cat), labCount: lab?.count, leaksItemNames: blob.includes("Mechanical Unit") } };
  });

  await check(X, "X-02", "submit validation: signed out refused; honeypot, non-PDF letter, date too soon; throttle per account (4th → 429)", async () => {
    const signedOut = (await api(null, "POST", "/portal/requests", new FormData())).status;
    const honey = await submit("reqMain", { website: "http://spam" });
    const badPdf = await submit("reqMain", { __letter: Buffer.from("<html>not a pdf</html>") } as any);
    const soon = await submit("reqMain", { windows: [{ date: "2026-09-15", start: "09:00", end: "12:00" }] });
    await requester("reqThrottle");
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await submit("reqThrottle", { windows: [{ date: "2026-11-11", start: "09:00", end: "10:00" }] }, "203.0.113.50")).status);
    return { ok: signedOut === 401 && honey.status === 400 && badPdf.status === 400 && soon.status === 400 && statuses[3] === 429, evidence: { signedOut, honeypot: honey.status, nonPdf: badPdf.status, tooSoon: soon.status, throttleStatuses: statuses } };
  });

  await check(X, "X-03", "mail-safety: HTML in org/purpose is escaped in the intake email", async () => {
    await requester("reqHtml");
    const { status } = await submit("reqHtml", { organizationName: "<script>alert(1)</script> Corp", purpose: "<img src=x onerror=alert(1)> a workshop that is at least ten characters long" }, "203.0.113.51");
    await new Promise((r) => setTimeout(r, 800));
    const idx = fs.existsSync("e2e/mail/index.jsonl") ? fs.readFileSync("e2e/mail/index.jsonl", "utf8").trim().split("\n").slice(-8) : [];
    const raws = idx.map((l: string) => JSON.parse(l).n).map((n: string) => fs.readFileSync(`e2e/mail/${n}.eml`, "utf8"));
    const leaked = raws.some((r: string) => r.includes("<script>alert(1)</script>") || r.includes("<img src=x onerror"));
    return { ok: status === 201 && !leaked, evidence: { submit: status, rawEmailContainsUnescapedTag: leaked } };
  });

  let reqId = "";
  await check(X, "X-04", "full staff flow: AVP → dean → head → custodian holds → answer back up → AVP quotes; only the requester reads it", async () => {
    await requester("reqFlow");
    const s = await submit("reqFlow", { windows: [{ date: "2026-11-12", start: "09:00", end: "12:00" }] }, "203.0.113.60");
    reqId = s.body?.id;
    const notAvp = await staff("headChem", reqId, "forward", { orgNodeIds: [comcme] });
    const parts = await toChemCustodian(reqId);
    const hold = await staff("custChem", reqId, "hold", { itemIds: [chemLab.id], date: "2026-11-12", start: "09:00", end: "12:00" });
    const avpOk = await answerUp(reqId, parts, 1875000);
    const quote = await staff("avp", reqId, "quote", { amountSantim: 1875000, paymentDeadline: "2026-11-05" });
    const own = await get("reqFlow", `/portal/requests/${reqId}`);
    const other = await get("reqMain", `/portal/requests/${reqId}`);
    const fresh = await db.externalRequest.findUniqueOrThrow({ where: { id: reqId } });
    return {
      ok: s.status === 201 && notAvp.status === 403 && hold.status === 200 && avpOk.status === 200 && quote.status === 200 && own.status === 200 && other.status >= 403 && fresh.status === "QUOTED",
      evidence: { submit: s.status, forwardByHead: notAvp.status, hold: hold.status, avpApprovesCollege: avpOk.status, quote: quote.status, requesterReads: own.status, anotherRequesterReads: other.status, status: fresh.status },
    };
  });

  await check(X, "X-05", "H26 — a hold can be placed on a slot outside the requested windows", async () => {
    await requester("reqOutside");
    const s = await submit("reqOutside", { windows: [{ date: "2026-11-20", start: "09:00", end: "10:00" }] }, "203.0.113.61");
    await toChemCustodian(s.body.id);
    const outside = await staff("custChem", s.body.id, "hold", { itemIds: [chemLab.id], date: "2027-03-15", start: "09:00", end: "10:00" });
    return { ok: outside.status === 400, evidence: { holdOutsideRequestedWindow: ev(outside) }, hypothesis: "H26" };
  });

  await check(X, "X-06", "holds guarded: an unassigned department's custodian refused; someone not asked refused", async () => {
    await requester("reqGuard");
    const s = await submit("reqGuard", { windows: [{ date: "2026-11-21", start: "09:00", end: "10:00" }] }, "203.0.113.62");
    await toChemCustodian(s.body.id);
    const seCustodian = await staff("custSe", s.body.id, "hold", { itemIds: [seLab.id], date: "2026-11-21", start: "09:00", end: "10:00" });
    const notAsked = await staff("staffChem", s.body.id, "hold", { itemIds: [chemLab.id], date: "2026-11-21", start: "09:00", end: "10:00" });
    return { ok: seCustodian.status >= 400 && notAsked.status >= 400, evidence: { unassignedDeptCustodian: seCustodian.status, notAsked: notAsked.status } };
  });

  await check(X, "X-07", "H26 — extendHolds can push a hold past the payment deadline / indefinitely", async () => {
    const ext = await staff("avp", reqId, "extend-holds", { until: "2030-01-01" });
    const after = await db.reservation.findMany({ where: { externalRequestId: reqId, state: "HELD" }, select: { holdExpiresAt: true } });
    const req = await db.externalRequest.findUniqueOrThrow({ where: { id: reqId } });
    const pushedPastDeadline = after.some((h) => req.paymentDeadline && h.holdExpiresAt && h.holdExpiresAt > req.paymentDeadline);
    return { ok: !(ext.status === 200 && pushedPastDeadline), evidence: { extend: ext.status, deadline: req.paymentDeadline?.toISOString(), holdExpiryAfter: after.map((h) => h.holdExpiresAt?.toISOString()), pushedPastDeadline }, hypothesis: "H26" };
  });

  // A fresh request taken all the way to a payable quote, for its own requester.
  let freshDay = 0;
  async function freshQuoted(amountSantim: number, deadline = "2026-12-28") {
    const day = String(1 + (freshDay++ % 27)).padStart(2, "0");
    const date = `2026-12-${day}`;
    const who = `reqPay${freshDay}`;
    await requester(who);
    const s = await submit(who, { windows: [{ date, start: "09:00", end: "12:00" }] }, `203.0.113.${100 + freshDay}`);
    const parts = await toChemCustodian(s.body.id);
    await staff("custChem", s.body.id, "hold", { itemIds: [chemLab.id], date, start: "09:00", end: "12:00" });
    await answerUp(s.body.id, parts, amountSantim);
    await staff("avp", s.body.id, "quote", { amountSantim, paymentDeadline: deadline });
    return { id: s.body.id as string, who };
  }

  let paid = { id: "", who: "" };
  await check(X, "X-08", "payment: wrong receiver rejected; correct receipt → PAID; a head can't confirm; the AVP confirms → SCHEDULED, hold CONFIRMED", async () => {
    paid = await freshQuoted(1000000);
    const wrong = await pay(paid.who, paid.id, { provider: "CBE", reference: "FAKE-10000-WRONG", accountSuffix: "12345678" });
    const good = await pay(paid.who, paid.id, { provider: "CBE", reference: "FAKE-10000", accountSuffix: "12345678" });
    const byHead = await staff("headChem", paid.id, "confirm", {});
    const confirm = await staff("avp", paid.id, "confirm", {});
    const req = await db.externalRequest.findUniqueOrThrow({ where: { id: paid.id } });
    const hold = await db.reservation.findFirstOrThrow({ where: { externalRequestId: paid.id } });
    return {
      ok: wrong.body?.outcome === "REJECTED" && good.body?.outcome === "VERIFIED" && byHead.status === 403 && confirm.status === 200 && req.status === "SCHEDULED" && hold.state === "CONFIRMED",
      evidence: { wrongReceiver: wrong.body?.outcome, correct: good.body?.outcome, correctReason: good.body?.reason, headConfirms: byHead.status, avpConfirms: confirm.status, requestStatus: req.status, holdState: hold.state },
    };
  });

  await check(X, "X-09", "a receipt reference cannot be reused for a second request", async () => {
    const f = await freshQuoted(1000000);
    const reuse = await pay(f.who, f.id, { provider: "CBE", reference: "FAKE-10000", accountSuffix: "12345678" });
    return { ok: reuse.status === 409 || reuse.body?.outcome === "REJECTED", evidence: { status: reuse.status, outcome: reuse.body?.outcome, body: reuse.body } };
  });

  await check(X, "X-10", "no payment before a quote", async () => {
    await requester("reqEarly");
    const s = await submit("reqEarly", { windows: [{ date: "2026-11-26", start: "09:00", end: "10:00" }] }, "203.0.113.71");
    const beforeQuote = await pay("reqEarly", s.body.id, { provider: "CBE", reference: "FAKE-500", accountSuffix: "12345678" });
    return { ok: beforeQuote.status >= 400 || beforeQuote.body?.outcome === "REJECTED", evidence: { payBeforeQuote: { status: beforeQuote.status, outcome: beforeQuote.body?.outcome } } };
  });

  await check(X, "X-11", "verifier outage → manual review; a head cannot review; the AVP approves (with a reason to reject) → confirmed → SCHEDULED", async () => {
    const f = await freshQuoted(250000);
    const down = await pay(f.who, f.id, { provider: "TELEBIRR", reference: "FAKE-DOWN", phoneNumber: "251911223344" });
    const manual = await pay(f.who, f.id, { provider: "TELEBIRR", reference: "FAKE-DOWN", phoneNumber: "251911223344", manualReview: true, amountSantim: 250000, note: "receipt attached by email" });
    const pv = await db.paymentVerification.findFirst({ where: { requestId: f.id, status: "PENDING_REVIEW" } });
    if (!pv) return { ok: false, evidence: { outage: down.body?.outcome, manualOutcome: manual.body?.outcome, manualReason: manual.body?.reason ?? manual.body?.message, manualStatus: manual.status } };
    const byHead = await post("headChem", `/external-requests/payments/${pv.id}/review`, { decision: "APPROVE" });
    const byAvpNoReason = await post("avp", `/external-requests/payments/${pv.id}/review`, { decision: "REJECT" });
    const byAvp = await post("avp", `/external-requests/payments/${pv.id}/review`, { decision: "APPROVE" });
    const mid = await db.externalRequest.findUniqueOrThrow({ where: { id: f.id } });
    if (mid.status === "PAID") await staff("avp", f.id, "confirm", {});
    const req = await db.externalRequest.findUniqueOrThrow({ where: { id: f.id } });
    return {
      ok: down.body?.outcome !== "VERIFIED" && manual.status === 200 && byHead.status === 403 && byAvpNoReason.status === 400 && byAvp.status === 200 && req.status === "SCHEDULED",
      evidence: { outage: down.body?.outcome, manual: manual.body?.outcome ?? manual.status, headReview: byHead.status, rejectNoReason: byAvpNoReason.status, avpApprove: byAvp.status, afterReview: mid.status, status: req.status },
    };
  });

  await check(X, "X-12", "split payment: CBE + telebirr to the same request sum to the quote", async () => {
    const f = await freshQuoted(1500000);
    const p1 = await pay(f.who, f.id, { provider: "CBE", reference: "FAKE-12000", accountSuffix: "12345678" });
    const p2 = await pay(f.who, f.id, { provider: "TELEBIRR", reference: "FAKE-3000", phoneNumber: "251911223344" });
    const req = await db.externalRequest.findUniqueOrThrow({ where: { id: f.id } });
    return { ok: req.status === "PAID" || req.status === "SCHEDULED", evidence: { first: p1.body?.outcome, firstReason: p1.body?.reason, second: p2.body?.outcome, secondReason: p2.body?.reason, status: req.status } };
  });

  await check(X, "X-13", "requester cannot self-cancel once money is accepted; declining a paid request mentions a refund", async () => {
    const cancel = await post(paid.who, `/portal/requests/${paid.id}/cancel`, {});
    const decline = await staff("avp", paid.id, "decline", { note: "Venue no longer available" });
    return { ok: cancel.status >= 400, evidence: { selfCancelAfterPaid: cancel.status, avpDecline: decline.status } };
  });

  await check(X, "X-14", "cron expire-holds requires the secret", async () => {
    const noSecret = await fetch(`${BASE}/api/cron/expire-holds`);
    const wrong = await fetch(`${BASE}/api/cron/expire-holds`, { headers: { authorization: "Bearer wrong" } });
    const right = await fetch(`${BASE}/api/cron/expire-holds`, { headers: { authorization: "Bearer e2e-cron-secret" } });
    return { ok: noSecret.status === 401 && wrong.status === 401 && right.status === 200, evidence: { noSecret: noSecret.status, wrong: wrong.status, right: right.status } };
  });

  await check(X, "X-15", "quote guards: no quote until every college answers; a declining college releases its holds", async () => {
    await requester("reqTwo");
    const s = await submit("reqTwo", { windows: [{ date: "2026-11-27", start: "09:00", end: "10:00" }] }, "203.0.113.72");
    const id = s.body.id;
    await staff("avp", id, "forward", { orgNodeIds: [comcme, coeec] });
    // CoEEC: the dean sends it to SE, whose custodian holds the SE lab.
    const coeecPart = await db.externalRequestAssignment.findFirstOrThrow({ where: { requestId: id, orgNodeId: coeec } });
    await post("deanCoeec", `/external-requests/assignments/${coeecPart.id}/forward`, { orgNodeIds: [se] });
    const sePart = await db.externalRequestAssignment.findFirstOrThrow({ where: { requestId: id, orgNodeId: se } });
    await post("headSe", `/external-requests/assignments/${sePart.id}/assign`, { tasks: [{ custodianId: S.custSe.id, want: "SE Lab X" }] });
    const seHold = await staff("custSe", id, "hold", { itemIds: [seLab.id], date: "2026-11-27", start: "09:00", end: "10:00" });
    // CoMCME answers in full.
    const college = await db.externalRequestAssignment.findFirstOrThrow({ where: { requestId: id, orgNodeId: comcme } });
    await post("deanComcme", `/external-requests/assignments/${college.id}/forward`, { orgNodeIds: [chem] });
    const dept = await db.externalRequestAssignment.findFirstOrThrow({ where: { requestId: id, orgNodeId: chem } });
    await post("headChem", `/external-requests/assignments/${dept.id}/assign`, { tasks: [{ custodianId: S.custChem.id, want: "Your lab" }] });
    await staff("custChem", id, "hold", { itemIds: [chemLab.id], date: "2026-11-27", start: "09:00", end: "10:00" });
    await answerUp(id, { college: college.id, dept: dept.id }, 100000);
    const earlyQuote = await staff("avp", id, "quote", { amountSantim: 100000, paymentDeadline: "2026-11-20" });
    await post("deanCoeec", `/external-requests/assignments/${coeecPart.id}/decline`, { note: "No space this month" });
    const seHolds = await db.reservation.count({ where: { externalRequestId: id, lab: { ownerOrgNodeId: se }, state: { in: ["HELD", "CONFIRMED"] } } });
    const quote = await staff("avp", id, "quote", { amountSantim: 100000, paymentDeadline: "2026-11-20" });
    return { ok: seHold.status === 200 && earlyQuote.status === 409 && quote.status === 200 && seHolds === 0, evidence: { seHold: seHold.status, quoteBeforeAllAnswered: earlyQuote.status, quoteAfter: quote.status, seHoldsAfterDecline: seHolds } };
  });

  await done();
}

main();
