/**
 * Validates the approval lines (2026-09-28) and the UX-flow round (2026-10-01) end to end, through the app's own HTTP API
 * on :3100 against the E2E clone (lrms_v2_e2e) with the mail sink running — never by
 * writing the database, except the one-off admin configuration in `setup()` (booking modes
 * and the public catalog, which the walkthrough's Act 1 does by hand). Staff sessions are
 * minted (the driver never submits a staff password); the outside requester signs up,
 * follows the emailed link and signs in with a password, as a real one would.
 *
 *   node e2e/reset-demo.mjs
 *   node e2e/mail-sink.mjs                                 (in another terminal)
 *   node e2e/with-env.mjs npx next dev -p 3100             (in another terminal)
 *   node e2e/with-env.mjs npx tsx e2e/validate-approval-lines.ts
 *
 * Paths:
 *   P1 purchase ladder         head → dean → CMD → AVP → procurement starts the purchase: a procurement
 *                              (a second request combined, a stage skipped, lines edited, arrival) (✉)
 *   P2 import from it          Property Admin records what arrived (✉ keeper) → keeper loads → all close
 *   P3 standalone EGP import   recorded → loaded
 *   P4 distribute              the store sends what a lab's need bought: Property Admin → custodian accepts
 *   P5 needs feed purchasing   custodian asks (✉ head, badge) → head declines one (✉) → builds a request from the other
 *   P6 request from the store  keeper → receiving head → Property Admin → receipt
 *   P7 return to the store     owning head → Property Admin → keeper accepts
 *   P8 permanent transfers     same college: … → CMD; across colleges: … → CMD → Property Admin
 *   P9 loan, and its return    no CMD, no Property Admin; the owner stays; the borrower sends it home
 *   P10 external (lab setups)  sign up → request with setups → AVP → dean → head books places → custodians
 *                              hold (only a lab that fits; none once covered) → phones → up → quote → pay → confirm
 *                              a packaged offer (examination for 60) → declined → edited and sent again
 *   P11 external (sample)      a machine held instead of a room, the custodian asked directly
 *   P12 places from above      an invited custodian; the head adds a lab for them (✉); custodians, other
 *                              departments' heads and the ADAA can't; the ADAA adds the college's store and
 *                              names its keeper (✉); the head changes who runs the lab (✉ both)
 *   P13 categories             a custodian's new category applies at once (✉ head); a change to data it
 *                              holds waits for the head, then converts the values
 *   P14 a lab's changes        staged in the lab's changes, not the register → sent (✉ head) → approved (✉)
 *   P15 who does what          bookings and custody by post; the keeper's Mine; a store's changes decided by
 *                              Property Administration; phones set by the ADAA, not a dean
 *   M  the mail tour           every emailed link: a real screen, the exact item, sign-in returns to it,
 *                              it opens for the person it was sent to, and the bell has the same notice
 * Writes e2e/validation-2026-10-03.json and prints a PASS/FAIL line per check.
 */
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import { generateToken, hashToken } from "../lib/server/auth/token";

if (!process.env.DATABASE_URL?.includes("lrms_v2_e2e")) throw new Error("validate-approval-lines.ts runs against lrms_v2_e2e only");
const db = new PrismaClient();
const BASE = "http://localhost:3100/api";
const MAIL_INDEX = "e2e/mail/index.jsonl";

// ── Plumbing ────────────────────────────────────────────────────────────────

const tokens = new Map<string, string>();
async function sessionOf(email: string): Promise<string> {
  const hit = tokens.get(email);
  if (hit) return hit;
  const user = await db.user.findUniqueOrThrow({ where: { emailLower: email.toLowerCase() } });
  const token = generateToken();
  await db.session.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 86_400_000), userAgent: "approval-lines-validator" } });
  tokens.set(email, token);
  return token;
}

class HttpFail extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T = any>(who: string, method: string, path: string, body?: unknown, raw = false): Promise<T> {
  const cookie = who.startsWith("cookie:") ? who.slice(7) : `lrms_session=${await sessionOf(who)}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { cookie, ...(body !== undefined && !raw ? { "content-type": "application/json" } : {}) },
    body: body === undefined ? undefined : raw ? (body as FormData) : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new HttpFail(res.status, `${method} ${path} as ${who.slice(0, 40)} → ${res.status}: ${json?.message ?? text}`);
  return json as T;
}
const get = <T = any>(w: string, p: string) => call<T>(w, "GET", p);
const post = <T = any>(w: string, p: string, b: unknown = {}) => call<T>(w, "POST", p, b);
async function refused(status: number, fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch (e) {
    return e instanceof HttpFail && e.status === status;
  }
}

type Mail = { n: string; to: string[]; subject: string };
/** The sink's index keeps only the first line of a subject; a long or non-ASCII one is
 *  folded and RFC 2047-encoded, so the subject is read back from the message itself. */
function subjectOf(n: string, fallback: string): string {
  try {
    const eml = fs.readFileSync(`e2e/mail/${n}.eml`, "utf8");
    const header = eml.split(/\r?\n\r?\n/)[0].replace(/\r?\n[ \t]+/g, " ");
    const raw = header.match(/^Subject: (.*)$/im)?.[1] ?? fallback;
    return raw
      .replace(/\?=\s+=\?/g, "?==?")
      .replace(/=\?UTF-8\?([QB])\?([^?]*)\?=/gi, (_, enc: string, text: string) =>
        enc.toUpperCase() === "B"
          ? Buffer.from(text, "base64").toString("utf8")
          : Buffer.from(text.replace(/_/g, " ").replace(/=([0-9A-F]{2})/gi, (_m, h) => String.fromCharCode(parseInt(h, 16))), "latin1").toString("utf8"),
      );
  } catch {
    return fallback;
  }
}
const mails = (): Mail[] =>
  fs.existsSync(MAIL_INDEX)
    ? fs
        .readFileSync(MAIL_INDEX, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Mail)
        .map((m) => ({ ...m, subject: subjectOf(m.n, m.subject) }))
    : [];
const mark = () => mails().length;
const since = (m: number) => mails().slice(m);
const mailed = (m: number, email: string, subject: string | RegExp) =>
  since(m).some((x) => x.to.some((t) => t.toLowerCase().includes(email.toLowerCase())) && (typeof subject === "string" ? x.subject === subject : subject.test(x.subject)));
/** The body of the latest message to `email` — quoted-printable and base64 decoded. */
function lastBodyTo(email: string): string {
  const hit = [...mails()].reverse().find((x) => x.to.some((t) => t.toLowerCase().includes(email.toLowerCase())));
  if (!hit) return "";
  const eml = fs.readFileSync(`e2e/mail/${hit.n}.eml`, "utf8");
  const qp = eml.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  const b64 = [...eml.matchAll(/\r?\n\r?\n([A-Za-z0-9+/=\r\n]{40,})/g)].map((m) => Buffer.from(m[1].replace(/\s/g, ""), "base64").toString("utf8")).join("\n");
  return `${qp}\n${b64}`;
}

type Check = { path: string; check: string; ok: boolean; detail?: string };
const results: Check[] = [];
function check(path: string, name: string, ok: boolean, detail?: unknown) {
  results.push({ path, check: name, ok, detail: detail === undefined ? undefined : typeof detail === "string" ? detail : JSON.stringify(detail) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${path}  ${name}${!ok && detail !== undefined ? `  — ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
}

const dayAhead = (n: number) => new Date(Date.now() + 3 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
const approvers = (req: { steps: Array<{ status: string; label: string; approverName: string | null }> }) =>
  req.steps.filter((s) => s.status !== "SKIPPED").map((s) => `${s.label}${s.approverName ? ` (${s.approverName})` : ""}`);

/** Decides every remaining step of a transfer as whoever holds it, in order — after
 *  checking that each of them can read what moves, from where and to whom. */
async function walkTransfer(id: string, path = "DT"): Promise<any> {
  for (let guard = 0; guard < 12; guard++) {
    const req = await get<any>("admin@astu.edu.et", `/resources/transfers/${id}`);
    if (req.status !== "PENDING") return req;
    const step = req.steps.find((s: any) => s.status === "PENDING");
    const who = await db.user.findUniqueOrThrow({ where: { id: step.approverId } });
    const d = await get<any>(who.email, `/resources/transfers/${id}/details`);
    check(path, `${step.label}: reads the details (${d.items?.length} item(s) → ${d.to?.place?.join(" › ")})`, d.items?.length > 0 && d.items.every((i: any) => i.categoryName && i.status && i.from.length && !i.removed) && d.to?.place?.length > 0 && Boolean(d.to?.unitName), d);
    await post(who.email, `/resources/transfers/${id}/decide`, { decision: "APPROVE", note: `validated: ${step.label}` });
  }
  throw new Error(`transfer ${id} did not settle`);
}

// ── People and places ───────────────────────────────────────────────────────

const ADMIN = "admin@astu.edu.et";
const HEAD = "cse.head@astu.edu.et";
const CHEM_HEAD = "head.chem@astu.edu.et";
const DEAN = "coeec.dean@astu.edu.et";
const AVP = "avp@astu.edu.et";
const CMD = "cmd@astu.edu.et";
const PROP = "property.admin@astu.edu.et";
const PROC = "procurement@astu.edu.et";
const KEEPER = "store.keeper@astu.edu.et";
const ALI = "alikibretmuhamed@gmail.com";
const YOHANNES = "yohanesalemu0069@gmail.com";
const HANNA = "custodian.chem@astu.edu.et";

async function node(code: string) {
  return db.orgNode.findUniqueOrThrow({ where: { code } });
}
async function catId(key: string) {
  return (await db.resourceCategory.findUniqueOrThrow({ where: { key } })).id;
}
async function labOf(email: string) {
  const u = await db.user.findUniqueOrThrow({ where: { emailLower: email } });
  return db.item.findFirstOrThrow({ where: { custodianId: u.id, parentId: null, deletedAt: null, category: { key: "lab" } }, orderBy: { name: "asc" } });
}
async function childNamed(parentId: string, name: string) {
  return db.item.findFirstOrThrow({ where: { parentId, name, deletedAt: null } });
}
async function mainStore() {
  return db.item.findFirstOrThrow({ where: { parentId: null, deletedAt: null, name: "ASTU Main Store" } });
}

async function setup() {
  // The walkthrough's Act 1, done here directly: labs are bookable rooms, computers
  // bookable machines, and both are on the public catalog.
  await db.resourceCategory.update({ where: { key: "lab" }, data: { bookingMode: "ROOM", publicListed: true } });
  await db.resourceCategory.update({ where: { key: "computer" }, data: { bookingMode: "EQUIPMENT", publicListed: true } });
  // The CSE ARAs start with notification emails off (their real addresses); the admin
  // turns them on for the two custodians this run emails — through People & roles' API.
  for (const email of [ALI, YOHANNES]) {
    const u = await db.user.findUniqueOrThrow({ where: { emailLower: email } });
    await post(ADMIN, `/people/${u.id}/notifications`, { enabled: true });
  }
}

// ── P1–P3: purchase, import, load ───────────────────────────────────────────

/** The need whose purchase the store later sends from (P4). */
let chairNeedId = "";

/** A request walked up the ladder to procurement's desk. */
async function approvedByAll(id: string) {
  for (const who of [DEAN, CMD, AVP]) await post(who, `/resources/purchase-requests/${id}/decide`, { decision: "APPROVE", note: "validated" });
}

async function purchaseAndImports() {
  const cse = await node("CSE");
  const aliLab = await labOf(ALI);
  const [chair, computer, whiteboard] = [await catId("chair"), await catId("computer"), await catId("whiteboard")];
  // The chairs answer a need Ali's lab raised: that is what the store later sends from.
  const chairNeed = await post<any>(ALI, "/resources/needs", { labItemId: aliLab.id, name: "Lab Chair", qty: 2, unit: "pcs", priority: "ESSENTIAL", kind: "NEW", categoryId: chair, reason: "Two benches have no chair" });
  chairNeedId = chairNeed.id;
  const pr = await post<any>(HEAD, "/resources/purchase-requests", {
    title: "Validation: two chairs and two desktops",
    orgNodeId: cse.id,
    lines: [
      { name: "Lab Chair", qty: 2, unit: "pcs", categoryId: chair, estimatedUnitCost: 1500, fromNeedIds: [chairNeed.id] },
      { name: "Desktop Computer", qty: 2, unit: "pcs", categoryId: computer, estimatedUnitCost: 45000, fromNeedIds: [] },
    ],
  });
  const order = pr.steps.filter((s: any) => s.status !== "SKIPPED").map((s: any) => s.label);
  check("P1", "ladder is dean → CMD → AVP → procurement", JSON.stringify(order) === JSON.stringify([
    "College: College of Electrical Engineering and Computing",
    "College Managing Director",
    "University: Adama Science and Technology University",
    "Procurement Office",
  ]), order);

  // Each approver reads the request in full at their step: the lines and their kinds.
  const readsDetails = async (who: string) => {
    const d = await get<any>(who, `/resources/purchase-requests/${pr.id}/details`);
    check("P1", `${who} reads every line's details`, d.lines?.length === 2 && d.lines.every((l: any) => l.categoryName && Array.isArray(l.needs)), d);
  };
  await readsDetails(DEAN);
  let m = mark();
  await post(DEAN, `/resources/purchase-requests/${pr.id}/decide`, { decision: "APPROVE", note: "validated" });
  check("P1", "✉ CMD is next after the dean", mailed(m, CMD, `${pr.reference} is waiting for your approval`));
  check("P1", "the AVP can't decide before the CMD", await refused(403, () => post(AVP, `/resources/purchase-requests/${pr.id}/decide`, { decision: "APPROVE" })));
  await readsDetails(CMD);
  m = mark();
  await post(CMD, `/resources/purchase-requests/${pr.id}/decide`, { decision: "APPROVE", note: "validated" });
  check("P1", "✉ AVP is next after the CMD", mailed(m, AVP, `${pr.reference} is waiting for your approval`));
  await readsDetails(AVP);
  await post(AVP, `/resources/purchase-requests/${pr.id}/decide`, { decision: "APPROVE", note: "validated" });
  await readsDetails(PROC);

  // Procurement's step is not an approval: it starts the purchase, as a procurement.
  m = mark();
  const started = await post<any>(PROC, `/resources/purchase-requests/${pr.id}/decide`, { decision: "APPROVE", note: "validated" });
  check("P1", "procurement starts the purchase: With procurement, in a new procurement", started.stage === "WITH_PROCUREMENT" && /^PROC-\d{4}-\d{3}$/.test(started.procurement?.reference ?? "") && started.procurement.stage === "PREPARING", [started.stage, started.procurement]);
  const procId: string = started.procurement.id;
  const procRef: string = started.procurement.reference;
  const move = (who: string, body: Record<string, unknown>) => post<any>(who, `/resources/procurements/${procId}/move`, body);
  const stageOf = async (id: string) => (await get<any>(HEAD, `/resources/purchase-requests/${id}`)).stage;
  check("P1", "✉ the head hears procurement started buying it", mailed(m, HEAD, `${procRef}: procurement started buying your request`));

  // A second request is combined into the same procurement while it is being prepared.
  const pr2 = await post<any>(HEAD, "/resources/purchase-requests", {
    title: "Validation: a whiteboard",
    orgNodeId: cse.id,
    lines: [{ name: "Whiteboard", qty: 1, unit: "pcs", categoryId: whiteboard, estimatedUnitCost: 6000, fromNeedIds: [] }],
  });
  await approvedByAll(pr2.id);
  const joined = await post<any>(PROC, `/resources/purchase-requests/${pr2.id}/decide`, { decision: "APPROVE", procurementId: procId });
  let proc = await get<any>(PROC, `/resources/procurements/${procId}`);
  check("P1", "a second request is combined into the same procurement", joined.procurement?.id === procId && proc.requests.length === 2 && proc.lines.length === 3, [joined.procurement, proc.requests.length, proc.lines.length]);
  check("P1", "the store keeper doesn't run procurements", await refused(403, () => move(KEEPER, { stage: "PLACED_ON_EGP", egpReference: "x" })));
  check("P1", "placing it needs the EGP number", await refused(400, () => move(PROC, { stage: "PLACED_ON_EGP" })));
  await move(PROC, { stage: "PLACED_ON_EGP", egpReference: "EGP-2026/0398", note: "Tender floated" });
  check("P1", "the requests follow it: Order placed", (await stageOf(pr.id)) === "ORDER_PLACED" && (await stageOf(pr2.id)) === "ORDER_PLACED");
  // Progress is a stage picked, not a note and "advance": a later one in one step, never back.
  await move(PROC, { stage: "ON_DELIVERY", supplier: "Validation Supplies PLC" });
  check("P1", "a stage can be skipped, never undone", (await stageOf(pr.id)) === "ON_DELIVERY" && (await refused(409, () => move(PROC, { stage: "BUYER_FOUND" }))));

  // Fewer found than asked: procurement edits what is bought, saying why.
  const desk = proc.lines.find((l: any) => l.name === "Desktop Computer");
  m = mark();
  proc = await post<any>(PROC, `/resources/procurements/${procId}/lines`, {
    reason: "Only one desktop of that model was in stock",
    lines: proc.lines.map((l: any) => ({ id: l.id, name: l.name, categoryId: l.categoryId, qty: l.id === desk.id ? 1 : l.qty, unit: l.unit, unitCost: l.unitCost, spec: l.spec, purchaseLineId: l.purchaseLineId })),
  });
  const edit = proc.events.find((e: any) => e.lineChanges.length);
  check("P1", "what is bought can be edited, with the reason on its timeline", proc.lines.find((l: any) => l.id === desk.id).qty === 1 && /Only one desktop/.test(edit?.note ?? ""), edit);
  check("P1", "✉ the head hears less will be bought", mailed(m, HEAD, `${procRef}: less will be bought than you asked for`));
  check("P1", "an edit needs a reason", await refused(400, () => post(PROC, `/resources/procurements/${procId}/lines`, { reason: "", lines: proc.lines.map((l: any) => ({ id: l.id, name: l.name, categoryId: l.categoryId, qty: l.qty })) })));

  m = mark();
  proc = await move(PROC, { stage: "ARRIVED", note: "Delivered to the main store" });
  check("P1", "arrived at the main store, and the requests with it", proc.stage === "ARRIVED" && (await stageOf(pr.id)) === "IN_STORE", [proc.stage, await stageOf(pr.id)]);
  check("P1", "✉ Property Admin (not the store keeper) is told it arrived", mailed(m, PROP, `${procRef} has arrived at the main store`) && !mailed(m, KEEPER, `${procRef} has arrived at the main store`));

  // P2 — Property Administration records what arrived from the procurement; the keeper loads it.
  check("P2", "the store keeper can't record an import", await refused(403, () => post(KEEPER, "/resources/imports", { source: "PROCUREMENT", procurementId: procId, lines: [{ name: "x", categoryId: chair, qty: 1 }] })));
  check("P2", "a request bought through a procurement isn't recorded on its own", await refused(409, () => post(PROP, "/resources/imports", { source: "PURCHASE_REQUEST", purchaseRequestId: pr.id, lines: [{ name: "Lab Chair", categoryId: chair, qty: 1, purchaseLineId: pr.lines[0].id }] })));
  m = mark();
  const imp = await post<any>(PROP, "/resources/imports", {
    source: "PROCUREMENT",
    procurementId: procId,
    lines: proc.lines.map((l: any) => ({ name: l.name, categoryId: l.categoryId, qty: l.arrivedQty ?? l.qty, unit: l.unit ?? undefined, procurementLineId: l.id })),
  });
  check("P2", "IMP reference, with the procurement's EGP number and supplier", /^IMP-\d{4}-\d{3}$/.test(imp.reference) && imp.egpReference === "EGP-2026/0398" && imp.supplier === "Validation Supplies PLC", [imp.reference, imp.egpReference, imp.supplier]);
  check("P2", "✉ the store keeper is told to load it", mailed(m, KEEPER, `${imp.reference} is ready to load into the store`));
  check("P2", "recording more than arrived is refused", await refused(409, () => post(PROP, "/resources/imports", { source: "PROCUREMENT", procurementId: procId, lines: [{ name: "Lab Chair", categoryId: chair, qty: 1, procurementLineId: proc.lines.find((l: any) => l.name === "Lab Chair").id }] })));
  const store = await mainStore();
  const line = (name: string) => imp.lines.find((l: any) => l.name === name);
  const load = (name: string, qty: number) => post<any>(KEEPER, `/resources/imports/${imp.id}/load`, { lineId: line(name).id, qty, storeParentId: store.id });
  await load("Lab Chair", 1);
  check("P2", "loading more than arrived is refused", await refused(409, () => load("Lab Chair", 5)));
  await load("Lab Chair", 1);
  await load("Whiteboard", 1);
  m = mark();
  const loaded = await load("Desktop Computer", 1);
  const procEnd = await get<any>(PROC, `/resources/procurements/${procId}`);
  check("P2", "import LOADED; the procurement and both requests CLOSED", loaded.status === "LOADED" && procEnd.stage === "CLOSED" && (await stageOf(pr.id)) === "CLOSED" && (await stageOf(pr2.id)) === "CLOSED", [loaded.status, procEnd.stage, await stageOf(pr.id), await stageOf(pr2.id)]);
  check("P2", "✉ the head is told it is in the store", mailed(m, HEAD, `${procRef} is in the store`));
  const inStore = await db.item.count({ where: { parentId: store.id, deletedAt: null, name: { startsWith: "Desktop Computer" } } });
  check("P2", "the one desktop that came is now an item in the Main Store", inStore === 1, inStore);

  // P3 — a standalone EGP purchase.
  const egp = await post<any>(PROP, "/resources/imports", { source: "EGP", egpReference: "EGP-2026/0412", supplier: "Abyssinia Tech", lines: [{ name: "Laptop", categoryId: computer, qty: 2, unit: "pcs", spec: "Lenovo T14" }] });
  const egpLoaded = await post<any>(KEEPER, `/resources/imports/${egp.id}/load`, { lineId: egp.lines[0].id, qty: 2, storeParentId: store.id });
  check("P3", "standalone EGP import recorded and loaded", egp.source === "EGP" && egpLoaded.status === "LOADED", [egp.source, egpLoaded.status]);
}

// ── P4–P9: movements ────────────────────────────────────────────────────────

async function transfer(who: string, input: Record<string, unknown>) {
  return post<any>(who, "/resources/transfers", { input: { kind: "transferItem", ...input } });
}

async function movements() {
  const store = await mainStore();
  const cse = await node("CSE");
  const aliLab = await labOf(ALI);
  const yLab = await labOf(YOHANNES);
  const hannaLab = await labOf(HANNA);
  const aliUser = await db.user.findUniqueOrThrow({ where: { emailLower: ALI } });

  // P4 — Distribute: the store sends what a lab's need was bought for.
  const keeperUser = await db.user.findUniqueOrThrow({ where: { emailLower: KEEPER } });
  const dist = await get<any>(KEEPER, "/resources/distributions");
  const suggested = dist.suggestions.find((x: any) => x.lab.id === aliLab.id)?.lines.find((l: any) => l.needId === chairNeedId);
  check("P4", "Distribute suggests the chairs for the lab whose need bought them", !!suggested && suggested.items.length >= 2 && /^PR-/.test(suggested.purchaseReference ?? ""), suggested);
  check("P4", "only the store keeper distributes", await refused(403, () => get(HEAD, "/resources/distributions")));
  const chairIds: string[] = suggested.items.slice(0, 2).map((i: any) => i.id);
  let m = mark();
  const sentOut = await post<any>(KEEPER, "/resources/distributions", { sends: [{ labId: aliLab.id, itemIds: chairIds, needIds: [chairNeedId] }] });
  const p4row = await db.changeRequest.findFirstOrThrow({ where: { status: "PENDING", requesterId: keeperUser.id }, orderBy: { createdAt: "desc" } });
  const p4 = { request: await get<any>(ADMIN, `/resources/transfers/${p4row.id}`) };
  check("P4", "chain: Property Admin → the custodian accepts (the head is told, not asked)", sentOut.results[0]?.ok === true && JSON.stringify(p4.request.steps.map((s: any) => s.selector)) === JSON.stringify(["NODE_OCCUPANT", "TARGET_CUSTODIAN"]), approvers(p4.request));
  check("P4", "✉ Property Admin is asked; the custodian and the head are told", mailed(m, PROP, /A transfer is waiting for you/) && mailed(m, ALI, /Coming to you from the store/) && mailed(m, HEAD, /Coming to your department from the store/));
  check("P4", "Procurement is not on it", !approvers(p4.request).some((a) => a.includes("Procurement")));
  const p4done = await walkTransfer(p4.request.id, "P4");
  const chairsAfter = await db.item.findMany({ where: { id: { in: chairIds } } });
  check("P4", "applied: owner CSE, custodian Ali, in his lab", p4done.status === "APPLIED" && chairsAfter.every((c) => c.ownerOrgNodeId === cse.id && c.custodianId === aliUser.id && c.parentId === aliLab.id));
  const distAfter = await get<any>(KEEPER, "/resources/distributions");
  check("P4", "a need that was sent is not suggested again", !distAfter.suggestions.some((x: any) => x.lines.some((l: any) => l.needId === chairNeedId)));
  // …and a send picked by hand takes the same line.
  const desktop = await db.item.findFirstOrThrow({ where: { parentId: store.id, name: { startsWith: "Desktop Computer" }, deletedAt: null } });
  const p4b = await transfer(KEEPER, { itemIds: [desktop.id], transfer: { targetParentId: aliLab.id, targetOrgNodeId: cse.id, targetCustodianId: aliUser.id, transferOwnership: true } });
  check("P4", "a hand-picked send: the same two steps", JSON.stringify(p4b.request.steps.map((s: any) => s.selector)) === JSON.stringify(["NODE_OCCUPANT", "TARGET_CUSTODIAN"]), approvers(p4b.request));
  await walkTransfer(p4b.request.id, "P4");

  // P6 — Ali asks for a table from the store.
  const table = await db.item.findFirstOrThrow({ where: { parentId: store.id, category: { key: "table" }, deletedAt: null } });
  const p6 = await transfer(ALI, { itemIds: [table.id], transfer: { targetParentId: aliLab.id, targetOrgNodeId: "", targetCustodianId: null } });
  check("P6", "request from the store: keeper → CSE head → Property Admin → receipt", p6.request.movement === "FROM_STORE" && JSON.stringify(p6.request.steps.map((s: any) => s.selector)) === JSON.stringify(["ITEM_CUSTODIAN", "TARGET_HEAD", "NODE_OCCUPANT", "REQUESTER_RECEIPT"]), approvers(p6.request));
  await walkTransfer(p6.request.id, "P6");
  const tableAfter = await db.item.findUniqueOrThrow({ where: { id: table.id } });
  check("P6", "given, not lent: owner CSE, custodian Ali", tableAfter.ownerOrgNodeId === cse.id && tableAfter.custodianId === aliUser.id);

  // P7 — Ali returns his teacher chair to the store.
  const teacherChair = await childNamed(aliLab.id, "Teacher Chair");
  const p7 = await transfer(ALI, { itemIds: [teacherChair.id], transfer: { targetParentId: store.id, targetOrgNodeId: "", targetCustodianId: null } });
  check("P7", "return to the store: CSE head → Property Admin → keeper accepts", p7.request.movement === "TO_STORE" && JSON.stringify(p7.request.steps.map((s: any) => s.selector)) === JSON.stringify(["OWNER_HEAD", "NODE_OCCUPANT", "TARGET_CUSTODIAN"]), approvers(p7.request));
  await walkTransfer(p7.request.id, "P7");
  const tcAfter = await db.item.findUniqueOrThrow({ where: { id: teacherChair.id } });
  check("P7", "owned by the university, in the keeper's custody", tcAfter.parentId === store.id && tcAfter.ownerOrgNodeId === store.ownerOrgNodeId && tcAfter.custodianId === store.custodianId);

  // P8 — permanent: inside CoEEC (Ali → Yohannes), and across colleges (Ali → Hanna, ChemE).
  const teacherTable = await childNamed(aliLab.id, "Teacher Table");
  const yUser = await db.user.findUniqueOrThrow({ where: { emailLower: YOHANNES } });
  const p8a = await transfer(YOHANNES, { itemIds: [teacherTable.id], transfer: { targetParentId: yLab.id, targetOrgNodeId: "", targetCustodianId: null, permanent: true } });
  check("P8", "same college: Ali → CSE head (once) → CMD → receipt", p8a.request.movement === "PERMANENT" && JSON.stringify(approvers(p8a.request)) === JSON.stringify([
    "Current custodian (Ali Kibret Muhamed)",
    "Head: Computer Science and Engineering (CSE Department Head)",
    "College Managing Director (College Managing Director (CMD))",
    "Confirm receipt (Yohannes Alemu)",
  ]), approvers(p8a.request));
  await walkTransfer(p8a.request.id, "P8");
  const ttAfter = await db.item.findUniqueOrThrow({ where: { id: teacherTable.id } });
  check("P8", "custody moved to Yohannes (same owning department)", ttAfter.custodianId === yUser.id && ttAfter.parentId === yLab.id);

  const whiteboard = await childNamed(aliLab.id, "Whiteboard");
  const chem = await node("CHEM");
  const hannaUser = await db.user.findUniqueOrThrow({ where: { emailLower: HANNA } });
  const p8b = await transfer(HANNA, { itemIds: [whiteboard.id], transfer: { targetParentId: hannaLab.id, targetOrgNodeId: "", targetCustodianId: null, permanent: true } });
  check("P8", "across colleges: … → ChemE head → CMD → Property Admin → receipt", JSON.stringify(p8b.request.steps.map((s: any) => s.selector)) === JSON.stringify(["ITEM_CUSTODIAN", "OWNER_HEAD", "TARGET_HEAD", "NODE_OCCUPANT", "NODE_OCCUPANT", "REQUESTER_RECEIPT"]) && approvers(p8b.request).some((a) => a.startsWith("Property Administration")), approvers(p8b.request));
  await walkTransfer(p8b.request.id, "P8");
  const wbAfter = await db.item.findUniqueOrThrow({ where: { id: whiteboard.id } });
  check("P8", "ownership moved to ChemE, custody to Hanna", wbAfter.ownerOrgNodeId === chem.id && wbAfter.custodianId === hannaUser.id);

  // P9 — a loan across colleges: no central office, the owner stays.
  const rack = await childNamed(aliLab.id, "Switch Rack");
  const p9 = await transfer(HANNA, { itemIds: [rack.id], transfer: { targetParentId: hannaLab.id, targetOrgNodeId: "", targetCustodianId: null } });
  check("P9", "loan: custodian → owning head → receiving head → receipt; no CMD, no Property Admin", p9.request.movement === "LOAN" && JSON.stringify(p9.request.steps.map((s: any) => s.selector)) === JSON.stringify(["ITEM_CUSTODIAN", "OWNER_HEAD", "TARGET_HEAD", "REQUESTER_RECEIPT"]), approvers(p9.request));
  await walkTransfer(p9.request.id, "P9");
  const rackAfter = await db.item.findUniqueOrThrow({ where: { id: rack.id } });
  check("P9", "the owner stays CSE, custody stays with Ali", rackAfter.ownerOrgNodeId === cse.id && rackAfter.custodianId === aliUser.id && rackAfter.currentOrgNodeId === chem.id);

  // …and the borrower sends it home on their own: nobody has to ask for it back.
  const home = await get<any>(HANNA, `/resources/transfers/return-target?itemId=${rack.id}`);
  check("P9", "the borrower may return it, to where it came from", home.side === "BORROWER" && home.suggested?.id === aliLab.id, home);
  const back = await transfer(HANNA, { itemIds: [rack.id], transfer: { targetParentId: aliLab.id, targetOrgNodeId: "", targetCustodianId: null } });
  check("P9", "a return the borrower starts has no step for the borrower", back.request.movement === "RETURN" && !back.request.steps.some((s: any) => s.status !== "SKIPPED" && s.approverId === hannaUser.id), approvers(back.request));
  await walkTransfer(back.request.id, "P9");
  const rackHome = await db.item.findUniqueOrThrow({ where: { id: rack.id } });
  check("P9", "it is back in the owner's lab and unit", rackHome.parentId === aliLab.id && rackHome.currentOrgNodeId === cse.id);
}

// ── P5: needs feed purchasing ───────────────────────────────────────────────

async function needs() {
  const aliLab = await labOf(ALI);
  const cse = await node("CSE");
  let m = mark();
  const wanted = await post<any>(ALI, "/resources/needs", { labItemId: aliLab.id, name: "Soldering station", qty: 3, unit: "pcs", priority: "ESSENTIAL", kind: "NEW", reason: "The embedded systems practical has 3 benches without one", spec: "Temperature-controlled, 60 W" });
  check("P5", "✉ the head hears what the lab needs", mailed(m, HEAD, `${aliLab.name} needs Soldering station`));
  const counts = await get<any>(HEAD, "/home/counts");
  check("P5", "the head's Purchasing badge counts it, and what is in progress beside it", counts.areas?.purchasing?.action >= 1 && counts.tabs?.["purchasing.needs"]?.action >= 1 && typeof counts.areas?.purchasing?.following === "number", counts.areas);
  const home = await get<any>(HEAD, "/home");
  check("P5", "the head's Home names a next step about it", /need/i.test(JSON.stringify(home.nextStep ?? null)), home.nextStep);
  const unwanted = await post<any>(ALI, "/resources/needs", { labItemId: aliLab.id, name: "Projector screen", qty: 1, priority: "NICE_TO_HAVE", kind: "NEW", reason: "Nice for presentations" });
  check("P5", "a custodian can't decline a need", await refused(403, () => post(ALI, `/resources/needs/${unwanted.id}/decline`, { note: "no" })));
  m = mark();
  await post(HEAD, `/resources/needs/${unwanted.id}/decline`, { note: "Not this budget year" });
  check("P5", "✉ the custodian hears it was declined", mailed(m, ALI, `Your need "Projector screen" was declined`));
  const open = await get<any[]>(HEAD, `/resources/needs?node=${cse.id}`);
  check("P5", "the head sees the open need, with its lab", open.some((n) => n.id === wanted.id && n.labItemId === aliLab.id), open.map((n) => n.name));
  const pr = await post<any>(HEAD, "/resources/purchase-requests", {
    title: "Validation: soldering stations",
    orgNodeId: cse.id,
    lines: [{ name: "Soldering station", qty: 3, unit: "pcs", estimatedUnitCost: 4200, fromNeedIds: [wanted.id] }],
  });
  const mine = await get<any[]>(ALI, "/resources/needs");
  const after = mine.find((n) => n.id === wanted.id);
  check("P5", "the need is carried into the request", after?.status === "CARRIED", after?.status);
  check("P5", "the declined one stays declined", mine.find((n) => n.id === unwanted.id)?.status === "DECLINED");
  check("P5", "the request was built", typeof pr.reference === "string" || typeof pr.id === "string", pr.stage);
}

// ── P12: places are managed from above ──────────────────────────────────────

const NEWBIE = "mt.custodian@example.org";
const ADAA = "adaa.coeec@astu.edu.et";

async function places() {
  const cse = await node("CSE");
  const labKind = await catId("lab");
  // A custodian invited through the app, who registers from the emailed link.
  await post(ADMIN, "/people", { name: "MT Custodian", email: NEWBIE, roles: ["CUSTODIAN"], homeNodeId: cse.id });
  const inviteToken = lastBodyTo(NEWBIE).match(/accept-invite\?token=([\w-]+)/)?.[1];
  const reg = await fetch(`${BASE}/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: inviteToken, name: "MT Custodian", password: "astu1234-custodian" }) });
  const newbie = await db.user.findUniqueOrThrow({ where: { emailLower: NEWBIE } });
  check("P12", "the invited custodian registered through the emailed link", reg.ok && newbie.status === "ACTIVE", reg.status);

  const place = { categoryId: labKind, name: "Validation Robotics Lab B510-R30", ownerOrgNodeId: cse.id, custodianId: newbie.id, props: { block: "510", room: "30", seats: 24, purpose: "Robotics practicals" } };
  check("P12", "a custodian can't add a lab", await refused(403, () => post(ALI, "/places", place)));
  check("P12", "another department's head can't add one in CSE", await refused(403, () => post(CHEM_HEAD, "/places", place)));
  check("P12", "the ADAA adds no labs (only the college's stores)", await refused(403, () => post(ADAA, "/places", place)));
  let m = mark();
  const lab = await post<any>(HEAD, "/places", place);
  check("P12", "the CSE head adds the lab", lab.name === place.name && lab.custodianId === newbie.id);
  check("P12", "✉ the custodian hears they run it", mailed(m, NEWBIE, `You now run ${place.name}`));
  const note = await db.notification.findFirst({ where: { userId: newbie.id, title: `You now run ${place.name}` } });
  check("P12", "…and the bell has it, linking to the lab", note?.path === `/places/${lab.id}`, note?.path);

  // The ADAA's college store, and its keeper.
  const coeec = await node("COEEC");
  const storeKind = await catId("store");
  const offered = await get<any[]>(ADAA, `/places/custodians?unit=${coeec.id}&store=1`);
  const yohannes = await db.user.findUniqueOrThrow({ where: { emailLower: YOHANNES } });
  check("P12", "the ADAA is offered the college's people — custodians, and others who would become one", offered.some((u) => u.id === yohannes.id && !u.becomesCustodian) && offered.some((u) => u.becomesCustodian), offered.length);
  m = mark();
  const store = await post<any>(ADAA, "/places", { categoryId: storeKind, name: "Validation CoEEC College Store", ownerOrgNodeId: coeec.id, custodianId: yohannes.id, props: { level: "College store", block: "508", room: "1" } });
  check("P12", "the ADAA adds the college store with its keeper", store.isStore === true && store.custodianId === yohannes.id && store.canManage === true);
  check("P12", "✉ the keeper hears they keep it", mailed(m, YOHANNES, "You now keep Validation CoEEC College Store"));

  const aliUser = await db.user.findUniqueOrThrow({ where: { emailLower: ALI } });
  m = mark();
  await call(HEAD, "PATCH", `/places/${lab.id}`, { custodianId: aliUser.id, note: "Ali runs the robotics practicals this term" });
  check("P12", "the head changes who runs it: ✉ both people", mailed(m, ALI, `You now run ${place.name}`) && mailed(m, NEWBIE, `${place.name} has a new custodian`));
  check("P12", "a custodian can't rename the place", await refused(403, () => call(ALI, "PATCH", `/places/${lab.id}`, { name: "Renamed by the custodian" })));
}

// ── P13 + P14: categories, and a lab's changes ──────────────────────────────

const reading = (over: Record<string, unknown> = {}) => ({ key: "reading", label: "Reading", type: "TEXT", options: [], summary: false, longText: false, required: false, sortOrder: 0, ...over });

async function categoriesAndLabChanges() {
  // Ali's first lab by name — the robotics lab P12 handed him sorts after it.
  const aliLab = await labOf(ALI);
  const groups = await get<any[]>(ALI, "/resources/category-groups");
  let m = mark();
  const cat = await post<any>(ALI, "/resources/categories", { name: "Validation Bench Meter", iconKey: "Box", groupId: groups[0].id, countingMode: "SERIALIZED", impairRule: "NEVER", isPlace: false, templateChildren: [], fields: [reading()] });
  check("P13", "a custodian's new category applies at once, looked after by CSE", cat.stewardName === "Computer Science and Engineering", cat.stewardName);
  check("P13", "✉ the head is told it was added", mailed(m, HEAD, /added the category Validation Bench Meter$/));
  check("P13", "a custodian can't make a place category", await refused(403, () => post(ALI, "/resources/categories", { name: "Validation Hall", iconKey: "Box", groupId: groups[0].id, countingMode: "SERIALIZED", impairRule: "NEVER", isPlace: true, templateChildren: [], fields: [] })));

  // P14 — the custodian's edits go into the lab's changes, not straight into the register.
  const computer = await db.item.findFirstOrThrow({ where: { category: { key: "computer" }, status: "WORKING", deletedAt: null, parent: { parentId: aliLab.id } } });
  const staged = await post<any>(ALI, "/resources/items/changes", { kind: "setStatus", itemIds: [computer.id], value: "BROKEN", note: "No display" });
  const meterAdd = await post<any>(ALI, "/resources/items/changes", { kind: "createItem", parentId: aliLab.id, categoryId: cat.id, count: 1, name: "Bench meter", props: { reading: "16" } });
  check("P14", "the edits are kept in the lab's changes", staged.staged?.labItemId === aliLab.id && meterAdd.staged?.labItemId === aliLab.id, [staged.staged, meterAdd.staged]);
  const still = await db.item.findUniqueOrThrow({ where: { id: computer.id } });
  check("P14", "the register is unchanged until the head approves", still.status === "WORKING");
  m = mark();
  const sent = await post<any>(ALI, `/resources/labs/${aliLab.id}/versions/draft/submit`);
  check("P14", "✉ the head is asked to decide", mailed(m, HEAD, `${aliLab.name}: changes are waiting for your approval`));
  check("P14", "only the lab's head may decide", await refused(403, () => post(CHEM_HEAD, `/resources/lab-commits/${sent.id}/decide`, { decision: "APPROVE" })));
  m = mark();
  const decided = await post<any>(HEAD, `/resources/lab-commits/${sent.id}/decide`, { decision: "APPROVE", note: "validated" });
  const now = await db.item.findUniqueOrThrow({ where: { id: computer.id } });
  const meter = await db.item.findFirst({ where: { parentId: aliLab.id, categoryId: cat.id, deletedAt: null } });
  check("P14", "approved: the register now has both changes", decided.status === "APPLIED" && now.status === "BROKEN" && !!meter, [decided.status, now.status, !!meter]);
  check("P14", "✉ the custodian hears they were approved", mailed(m, ALI, `${aliLab.name}: your changes were approved`));

  // P13 again — a change to values the category already holds waits for the head.
  const fresh = await get<any>(ALI, `/resources/categories/${cat.id}`);
  m = mark();
  const saved = await call<any>(ALI, "PATCH", `/resources/categories/${cat.id}`, { expectedVersion: fresh.version, fields: [reading({ type: "NUMBER" })] });
  check("P13", "retyping a detail that holds values waits for the head", saved.status === "PENDING" && saved.category.fields[0].type === "TEXT", [saved.status, saved.category.fields[0].type]);
  check("P13", "✉ the head is asked", mailed(m, HEAD, "A change to Validation Bench Meter is waiting for your approval"));
  m = mark();
  const approved = await post<any>(HEAD, `/resources/category-changes/${saved.change.id}/decide`, { approve: true });
  const meterAfter = await db.item.findUniqueOrThrow({ where: { id: meter!.id } });
  check("P13", "approved: the value is converted, not erased", approved.status === "APPROVED" && (meterAfter.props as Record<string, unknown>).reading === 16, [(meterAfter.props as Record<string, unknown>).reading]);
  check("P13", "✉ the custodian hears it was approved", mailed(m, ALI, "Your change to Validation Bench Meter was approved"));
}

// ── M: the mail tour — follow every emailed link ────────────────────────────

const ORIGIN = "http://localhost:3100";
/** Workspace screens a notice may open (app/(workspace)). */
const SCREENS = new Set(["home", "register", "places", "schedule", "approvals", "purchasing", "external-requests", "categories", "dashboard", "change-log", "admin", "me"]);

function bodyOf(n: string): string {
  const eml = fs.readFileSync(`e2e/mail/${n}.eml`, "utf8");
  const qp = eml.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  const b64 = [...eml.matchAll(/\r?\n\r?\n([A-Za-z0-9+/=\r\n]{40,})/g)].map((x) => Buffer.from(x[1].replace(/\s/g, ""), "base64").toString("utf8")).join("\n");
  return `${qp}\n${b64}`;
}

/** Does the id a link names exist? */
async function exists(kind: string, id: string): Promise<boolean> {
  const find: Record<string, () => Promise<unknown>> = {
    transfer: () => db.changeRequest.findUnique({ where: { id } }),
    "lab-commit": () => db.labCommitRequest.findUnique({ where: { id } }),
    purchase: () => db.purchaseRequest.findUnique({ where: { id } }),
    booking: () => db.reservation.findUnique({ where: { id } }),
    "category-change": () => db.categoryChange.findUnique({ where: { id } }),
    place: () => db.item.findUnique({ where: { id } }),
    category: () => db.resourceCategory.findUnique({ where: { id } }),
    external: () => db.externalRequest.findUnique({ where: { id } }),
    need: () => db.needLine.findUnique({ where: { id } }),
    import: () => db.importRecord.findUnique({ where: { id } }),
    request: () => db.purchaseRequest.findUnique({ where: { id } }),
    procurement: () => db.procurement.findUnique({ where: { id } }),
  };
  return !!(await (find[kind] ?? (async () => null))());
}

async function mailTour(fromMark: number) {
  const seen = new Set<string>();
  let links = 0;
  const generic: string[] = [];
  for (const mail of since(fromMark)) {
    const to = mail.to[0]?.replace(/[<>]/g, "").trim().toLowerCase();
    const hrefs = [...bodyOf(mail.n).matchAll(/href="([^"]+)"/g)].map((x) => x[1].replace(/&amp;/g, "&")).filter((h) => h.startsWith(ORIGIN));
    for (const href of hrefs) {
      const url = new URL(href);
      const screen = url.pathname.split("/")[1];
      if (!SCREENS.has(screen)) continue; // the portal, an invitation, a reset: public pages with their own tokens
      const target = `${url.pathname}${url.search}`;
      if (seen.has(`${to} ${target}`)) continue;
      seen.add(`${to} ${target}`);
      links++;
      const label = `“${mail.subject}” → ${target}`;

      // The exact item: every id the link names must exist.
      const ids: Array<[string, string]> = [];
      const focus = url.searchParams.get("focus");
      if (focus?.includes(":")) ids.push(focus.split(":") as [string, string]);
      else if (screen === "external-requests" && focus) ids.push(["external", focus]);
      if (screen === "places" && url.pathname.split("/")[2]) ids.push(["place", url.pathname.split("/")[2]]);
      if (screen === "schedule" && url.searchParams.get("lab")) ids.push(["place", url.searchParams.get("lab")!]);
      for (const key of ["need", "import", "request", "procurement"] as const) if (screen === "purchasing" && url.searchParams.get(key)) ids.push([key, url.searchParams.get(key)!]);
      if (screen === "categories" && url.searchParams.get("id")) ids.push(["category", url.searchParams.get("id")!]);
      if (screen === "categories" && url.searchParams.get("change")) ids.push(["category-change", url.searchParams.get("change")!]);
      if (!ids.length) generic.push(label);
      const missing: string[] = [];
      for (const [kind, id] of ids) if (!(await exists(kind, id))) missing.push(`${kind}:${id}`);
      if (missing.length) check("M", `link names a real item: ${label}`, false, missing);

      // Signed out, it goes to sign-in and comes back to exactly this page.
      const out = await fetch(href, { redirect: "manual" });
      const loc = out.headers.get("location") ?? "";
      const next = loc ? new URL(loc, ORIGIN).searchParams.get("next") : null;
      // Compared decoded: `focus=purchase%3Aid` and `focus=purchase:id` are the same link.
      const back = next ? new URL(next, ORIGIN) : null;
      const same = !!back && back.pathname === url.pathname && JSON.stringify([...back.searchParams]) === JSON.stringify([...url.searchParams]);
      if (!(out.status >= 300 && out.status < 400 && same)) check("M", `signed out, sign-in keeps the link: ${label}`, false, [out.status, loc]);

      // Signed in as the person it was sent to, the screen opens.
      const user = await db.user.findUnique({ where: { emailLower: to }, include: { roles: true } });
      if (!user || user.roles.some((r) => r.kind === "EXTERNAL")) continue;
      const res = await fetch(href, { headers: { cookie: `lrms_session=${await sessionOf(to)}` }, redirect: "manual" });
      if (res.status !== 200) check("M", `opens for ${to}: ${label}`, false, res.status);

      // The bell has the same notice, pointing at the same place.
      const bell = await db.notification.findFirst({ where: { userId: user.id, path: target } });
      if (!bell) check("M", `the bell has it too: ${label}`, false, to);
    }
  }
  const failures = results.filter((r) => r.path === "M" && !r.ok).length;
  check("M", `${links} emailed links followed: a real screen, sign-in returns to it, it opens, the bell agrees`, links > 20 && failures === 0, { links, failures });
  // Withdrawn notices have nothing left to open; anything else names its item.
  const unexpected = generic.filter((g) => !/withdrawn/i.test(g));
  check("M", "every link names its exact item (withdrawn notices aside)", unexpected.length === 0, unexpected);
}

// ── P10–P11: external requests ──────────────────────────────────────────────

const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");

async function requesterAccount(email: string, organisation: string): Promise<string> {
  let m = mark();
  await call("anon", "POST", "/public/signup", { organisation, name: "Ms. Requester", email, phone: "+251911000777", password: "outside-pass-1" }).catch(async () => {
    const res = await fetch(`${BASE}/public/signup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ organisation, name: "Ms. Requester", email, phone: "+251911000777", password: "outside-pass-1" }) });
    if (!res.ok) throw new Error(`signup → ${res.status}: ${await res.text()}`);
  });
  check("P10", `✉ ${email} gets a confirmation link`, mailed(m, email, /Confirm your email/));
  const login = () => fetch(`${BASE}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "outside-pass-1" }) });
  const early = await login();
  check("P10", "sign-in refused before the email is confirmed", early.status === 401);
  const token = lastBodyTo(email).match(/verify\?token=([\w-]+)/)?.[1];
  const verified = await fetch(`${BASE}/public/verify-email`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
  check("P10", "the link confirms the account", verified.ok);
  m = mark();
  const res = await login();
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
  check("P10", "the requester signs in with their password", res.ok && cookie.startsWith("lrms_session="));
  return `cookie:${cookie}`;
}

async function submitExternal(requester: string, payload: Record<string, unknown>, withLetter = true): Promise<{ id: string; reference: string }> {
  const form = new FormData();
  form.set("payload", JSON.stringify(payload));
  if (withLetter) form.set("letter", new Blob([PDF], { type: "application/pdf" }), "letter.pdf");
  return call(requester, "POST", "/portal/requests", form, true);
}

const SHEET = "https://docs.google.com/spreadsheets/d/validation";

/** AVP → CoEEC → CSE: the request reaches the head. */
async function downTheLine(id: string) {
  const coeec = await node("COEEC");
  const cse = await node("CSE");
  let m = mark();
  await post(AVP, `/external-requests/${id}/forward`, { orgNodeIds: [coeec.id], note: "Please check capacity" });
  check("P10", "✉ the dean gets it from the AVP", mailed(m, DEAN, /^External request EXT-.* for College of Electrical/));
  let dto = await get<any>(DEAN, `/external-requests/${id}`);
  const college = dto.assignments.find((a: any) => a.level === "COLLEGE");
  m = mark();
  dto = await post<any>(DEAN, `/external-requests/assignments/${college.id}/forward`, { orgNodeIds: [cse.id] });
  check("P10", "✉ the CSE head gets it from the dean", mailed(m, HEAD, /^External request EXT-.* for Computer Science/));
  const dept = dto.assignments.find((a: any) => a.orgNodeId === cse.id);
  return { collegeId: college.id as string, deptId: dept.id as string };
}

async function upTheLine(id: string, parts: { collegeId: string; deptId: string }, amountSantim: number) {
  let m = mark();
  await post(HEAD, `/external-requests/assignments/${parts.deptId}/submit`, { sheetUrl: SHEET, amountSantim });
  check("P10", "✉ the dean gets the department's answer", mailed(m, DEAN, /answered EXT-/));
  await post(DEAN, `/external-requests/assignments/${parts.deptId}/review`, { decision: "APPROVE" });
  m = mark();
  await post(DEAN, `/external-requests/assignments/${parts.collegeId}/submit`, { note: "One department hosts it" });
  check("P10", "✉ the AVP gets the college's answer", mailed(m, AVP, /answered EXT-/));
  return post<any>(AVP, `/external-requests/assignments/${parts.collegeId}/review`, { decision: "APPROVE" });
}

async function external() {
  const requester = await requesterAccount("outside.requester@example.org", "Addis Data Institute");
  const date = dayAhead(20);
  const [labKind, setupKind, whiteboard] = [await catId("lab"), await catId("setup"), await catId("whiteboard")];
  const who = { organizationName: "Addis Data Institute", contactName: "Ms. Requester", contactEmail: "outside.requester@example.org", contactPhone: "+251911000777" };

  // The requester builds the labs they need: the kind of place, how many, what each must have.
  const catalog = await (await fetch(`${BASE}/public/catalog`)).json();
  check("P10", "the public catalogue offers places to build on and what a lab can be asked to have", catalog.groups.flatMap((g: any) => g.categories).some((c: any) => c.id === labKind && c.isPlace) && catalog.setupKinds.some((k: any) => k.id === whiteboard), catalog.setupKinds?.length);
  check("P10", "a lab setup must be built on a kind of place", await refused(400, () => submitExternal(requester, { kind: "FACILITY", ...who, purpose: "A workshop for forty people, two days.", windows: [{ date, start: "09:00", end: "12:00" }], lines: [], setups: [{ placeCategoryId: whiteboard, count: 1, needs: [] }] })));
  let m = mark();
  const created = await submitExternal(requester, {
    kind: "FACILITY",
    ...who,
    purpose: "A two-day data science workshop for 40 government employees.",
    windows: [{ date, start: "09:00", end: "12:00" }],
    lines: [],
    setups: [{ placeCategoryId: labKind, count: 2, needs: [{ categoryId: setupKind, qty: 10 }, { categoryId: whiteboard, qty: 1 }] }],
  });
  check("P10", "✉ requester and AVP told it arrived", mailed(m, "outside.requester@example.org", `Request ${created.reference} received`) && mailed(m, AVP, `New external request ${created.reference}`));
  check("P10", "a staff account can't read the requester's page", await refused(403, () => get(ALI, `/portal/requests/${created.id}`)));

  const parts = await downTheLine(created.id);
  const ext = `/external-requests/${created.id}`;
  const book = `/external-requests/assignments/${parts.deptId}/book`;
  const submit = `/external-requests/assignments/${parts.deptId}/submit`;

  // The head books places: Ali's lab (its whiteboard went to ChemE in P8) and both of Yohannes's.
  const aliLab = await labOf(ALI);
  const yUser = await db.user.findUniqueOrThrow({ where: { emailLower: YOHANNES } });
  const yLabs = await db.item.findMany({ where: { custodianId: yUser.id, parentId: null, deletedAt: null, category: { key: "lab" } }, orderBy: { name: "asc" } });
  const places = await get<any[]>(HEAD, `/external-requests/assignments/${parts.deptId}/places`);
  const placeOf = (id: string) => places.find((p) => p.id === id);
  check(
    "P10",
    "the head sees which labs fit: Ali's is short of a whiteboard, Yohannes's two fit",
    JSON.stringify(placeOf(aliLab.id)?.missing.map((x: any) => x.categoryName)) === '["Whiteboard"]' && yLabs.length === 2 && yLabs.every((l) => placeOf(l.id)?.missing.length === 0),
    [placeOf(aliLab.id)?.missing, yLabs.map((l) => placeOf(l.id)?.missing)],
  );
  check("P10", "another department's head can't book CSE's places", await refused(403, () => get(CHEM_HEAD, `/external-requests/assignments/${parts.deptId}/places`)));
  m = mark();
  let dto = await post<any>(HEAD, book, { labIds: [aliLab.id, ...yLabs.map((l) => l.id)], note: "For the data science workshop" });
  check("P10", "✉ each custodian is asked to hold their place", mailed(m, ALI, `Hold ${aliLab.name} for ${created.reference}`) && mailed(m, YOHANNES, `Hold ${yLabs[0].name} for ${created.reference}`));
  const asked = (labId: string) => dto.holds.find((h: any) => h.labItemId === labId && h.state === "REQUESTED");
  const answer = (holdId: string) => `/external-requests/holds/${holdId}/answer`;
  const aliHold = asked(aliLab.id);
  const yHolds = yLabs.map((l) => asked(l.id));
  check("P10", "a lab without what each lab must have can't be held", dto.holdChecks.some((c: any) => c.reservationId === aliHold.id && c.blocked === "SHORT") && (await refused(409, () => post(ALI, answer(aliHold.id), { decision: "HOLD" }))), dto.holdChecks);
  check("P10", "a custodian answers only their own place", await refused(403, () => post(ALI, answer(yHolds[0].id), { decision: "HOLD" })));
  m = mark();
  await post(ALI, answer(aliHold.id), { decision: "WAIT", note: "Borrowing a whiteboard from Chemical Engineering" });
  check("P10", "✉ the head hears Ali is waiting for a loan", mailed(m, HEAD, `${aliLab.name}: waiting for a loan for ${created.reference}`));
  dto = await post<any>(YOHANNES, answer(yHolds[0].id), { decision: "HOLD" });
  check("P10", "one lab held: the coverage counts it", dto.coverage.windows[0].rows[0].have === 1 && !dto.coverage.complete, dto.coverage);
  dto = await post<any>(YOHANNES, answer(yHolds[1].id), { decision: "HOLD" });
  check("P10", "everything covered: Ali's request is no longer needed and can't be held", dto.coverage.complete && dto.holdChecks.some((c: any) => c.reservationId === aliHold.id && c.blocked === "COVERED") && (await refused(409, () => post(ALI, answer(aliHold.id), { decision: "HOLD" }))), dto.holdChecks);
  const spare = places.find((p) => !p.asked && ![aliLab.id, ...yLabs.map((l) => l.id)].includes(p.id));
  check("P10", "nothing is left to book once covered (only a replacement)", await refused(409, () => post(HEAD, book, { labIds: [spare.id] })));

  // The contact persons are the custodians holding the places; each needs a phone.
  check("P10", "sending up is refused while a holder has no phone", await refused(400, () => post(HEAD, submit, { sheetUrl: SHEET, amountSantim: 1 })));
  check("P10", "a phone number must look like one", await refused(400, () => post(YOHANNES, "/auth/phone", { phone: "call me" })));
  await post(YOHANNES, "/auth/phone", { phone: "+251911123456" });
  const headDept = (await get<any>(HEAD, ext)).assignments.find((a: any) => a.id === parts.deptId);
  check("P10", "the contact is the custodian holding the places, with the phone they set", headDept.holders.length === 1 && headDept.holders[0].phone === "+251911123456" && headDept.holders[0].places.length === 2, headDept.holders);
  check("P10", "the head may send up without waiting for Ali", headDept.can.submit === true);
  await upTheLine(created.id, parts, 1_250_000);
  const sentUp = await get<any>(HEAD, ext);
  check("P10", "Ali's unanswered hold request is withdrawn", sentUp.holds.find((h: any) => h.id === aliHold.id)?.state === "CANCELLED", sentUp.holds.map((h: any) => h.state));

  const avpView = await get<any>(AVP, ext);
  check("P10", "the AVP can quote, suggested from the approved department", avpView.can.quote && avpView.suggestedQuoteSantim === 1_250_000, [avpView.can.quote, avpView.suggestedQuoteSantim]);
  m = mark();
  await post(AVP, `${ext}/quote`, { amountSantim: 1_250_000, paymentDeadline: dayAhead(10), note: "Includes lab assistants" });
  check("P10", "✉ the requester gets the quote", mailed(m, "outside.requester@example.org", `Quote for request ${created.reference}`));
  let mine = await get<any>(requester, `/portal/requests/${created.id}`);
  check("P10", "requester sees their setups, the breakdown, bank details and the two held labs: no contacts yet", mine.setups.length === 1 && mine.quote.breakdown.length === 1 && !!mine.quote.bank && mine.bookings.length === 2 && !mine.bookings[0].confirmed && mine.contacts.length === 0, { setups: mine.setups, bookings: mine.bookings });

  m = mark();
  const receipt = "https://receipts.example.org/telebirr/FAKE-12500";
  const paid = await post<any>(requester, `/portal/requests/${created.id}/payments`, { provider: "TELEBIRR", reference: "FAKE-12500", receiptLink: receipt });
  check("P10", "verified payment → PAID, waiting for the AVP", paid.outcome === "VERIFIED" && paid.tracking.status === "PAID", [paid.outcome, paid.tracking.status]);
  check("P10", "✉ the AVP is asked to confirm the payment", mailed(m, AVP, `${created.reference} is paid: confirm the payment`));
  const avpPay = await get<any>(AVP, ext);
  check("P10", "the AVP sees the requester's receipt link and the account to check it against", avpPay.payments[0]?.receiptLink === receipt && JSON.stringify(avpPay).includes("1000370930353"), avpPay.payments[0]);
  check("P10", "a head can't confirm the payment", await refused(403, () => post(HEAD, `${ext}/confirm`, {})));
  m = mark();
  const confirmed = await post<any>(AVP, `${ext}/confirm`, {});
  check("P10", "the AVP confirms → SCHEDULED, contacts revealed", confirmed.status === "SCHEDULED" && !!confirmed.contactsRevealedAt);
  check("P10", "✉ requester (with contacts), custodian and head", mailed(m, "outside.requester@example.org", `Booking confirmed: ${created.reference}`) && mailed(m, YOHANNES, `Booking confirmed on your calendar: ${created.reference}`) && mailed(m, HEAD, `${created.reference} is paid and booked`));
  check("P10", "the confirmation email lists the contact person's phone", /\+251911123456/.test(lastBodyTo("outside.requester@example.org")));
  mine = await get<any>(requester, `/portal/requests/${created.id}`);
  check("P10", "requester now sees the booked labs and who to call", mine.bookings.every((b: any) => b.confirmed) && mine.contacts[0]?.people.length === 1 && mine.contacts[0].people[0].phone === "+251911123456", { bookings: mine.bookings, contacts: mine.contacts });

  // P11 — a sample analysis on a machine: the head asks the custodian directly.
  const sampleDate = dayAhead(22);
  const machine = await db.item.findFirstOrThrow({
    where: { category: { key: "computer" }, status: "WORKING", deletedAt: null, parent: { parentId: aliLab.id } },
    include: { parent: { select: { name: true } } },
  });
  const s = await submitExternal(requester, {
    kind: "SAMPLE_ANALYSIS",
    ...who,
    purpose: "Benchmark our dataset on a lab workstation.",
    windows: [{ date: sampleDate, start: "09:00", end: "11:00" }],
    lines: [],
    sample: { categoryId: await catId("computer"), sampleCount: 3, analysis: "Run the benchmark suite and report timings" },
  });
  const sParts = await downTheLine(s.id);
  const aliUser = await db.user.findUniqueOrThrow({ where: { emailLower: ALI } });
  m = mark();
  await post(HEAD, `/external-requests/assignments/${sParts.deptId}/assign`, { tasks: [{ custodianId: aliUser.id, want: "One workstation computer" }] });
  check("P11", "✉ the custodian is asked", mailed(m, ALI, /^Hold (rooms|a machine) for EXT-/));
  const aliDto = await get<any>(ALI, `/external-requests/${s.id}`);
  check("P11", "Ali may hold in his own lab only", aliDto.role === "CUSTODIAN" && aliDto.holdRooms.map((r: any) => r.id).includes(aliLab.id));
  await post(ALI, `/external-requests/${s.id}/hold`, { itemIds: [machine.id], date: sampleDate, start: "09:00", end: "11:00" });
  const sTask = (await get<any>(ALI, `/external-requests/${s.id}`)).assignments.find((a: any) => a.id === sParts.deptId).tasks[0];
  await post(ALI, `/external-requests/tasks/${sTask.id}/finish`, { outcome: "DONE" });
  // Ali is the contact, so he needs a phone: his head sets it for him.
  const withPhone = await post<any>(HEAD, `/people/${aliUser.id}/phone`, { phone: "+251 911 555 010" });
  check("P11", "the head sets a custodian's phone", withPhone.phone === "+251 911 555 010", withPhone.phone);
  await upTheLine(s.id, sParts, 300_000);
  await post(AVP, `/external-requests/${s.id}/quote`, { amountSantim: 300_000, paymentDeadline: dayAhead(10) });
  const sMine = await get<any>(requester, `/portal/requests/${s.id}`);
  check("P11", "the requester sees the machine held, in its lab", sMine.kind === "SAMPLE_ANALYSIS" && sMine.bookings[0]?.place === `${machine.name}: ${aliLab.name}`, sMine.bookings);

  // A packaged offer, declined, then edited and sent again (a second requester: an account
  // sends three requests a day).
  const second = await requesterAccount("training.office@example.org", "Oromia Statistics Agency");
  const who2 = { organizationName: "Oromia Statistics Agency", contactName: "Ms. Requester", contactEmail: "training.office@example.org", contactPhone: "+251911000777" };
  const offer = catalog.offers?.find((o: any) => o.key === "EXAM");
  check("P10", "the catalogue offers packaged requests, with the seats a typical lab has", !!offer && offer.placeCategoryId === labKind && offer.seatCategoryId === setupKind && offer.seatsPerPlace >= 1, catalog.offers?.map((o: any) => [o.key, o.seatsPerPlace]));
  const labs = Math.ceil(60 / offer.seatsPerPlace);
  const examBody = {
    kind: "FACILITY",
    ...who2,
    purpose: "A recruitment examination for 60 candidates.",
    windows: [{ date: dayAhead(24), start: "09:00", end: "12:00" }],
    lines: [],
    offerKey: "EXAM",
    peopleCount: 60,
    setups: [{ placeCategoryId: labKind, count: labs, needs: [{ categoryId: setupKind, qty: Math.ceil(60 / labs) }] }],
  };
  const exam = await submitExternal(second, examBody);
  check("P10", "an offer that doesn't exist is refused", await refused(400, () => submitExternal(second, { ...examBody, offerKey: "PICNIC" })));
  m = mark();
  await post(AVP, `/external-requests/${exam.id}/decline`, { note: "That is the university's own examination week. Any week after it works." });
  check("P10", "✉ the requester hears it was declined, and that they can send it again", mailed(m, "training.office@example.org", `Request ${exam.reference}`) && /Edit and send again/.test(lastBodyTo("training.office@example.org")));
  const closed = await get<any>(second, `/portal/requests/${exam.id}`);
  check("P10", "declined: the requester sees why, what they chose, and may edit and send it again", closed.status === "DECLINED" && closed.canSendAgain === true && closed.offer?.name === "Examination" && closed.offer.people === 60 && /examination week/.test(closed.closingNote ?? ""), [closed.status, closed.canSendAgain, closed.offer]);
  check("P10", "another requester can't send it again", await refused(404, () => submitExternal(requester, { ...examBody, resubmitOf: exam.id }, false)));
  m = mark();
  const again = await submitExternal(second, { ...examBody, windows: [{ date: dayAhead(31), start: "09:00", end: "12:00" }], resubmitOf: exam.id }, false);
  const avpAgain = await get<any>(AVP, `/external-requests/${again.id}`);
  check(
    "P10",
    "sent again as a new request: linked to the first, its letter kept, the reason it was closed shown to the AVP",
    again.reference !== exam.reference && avpAgain.resubmitOf?.reference === exam.reference && /examination week/.test(avpAgain.resubmitOf.closingNote ?? "") && avpAgain.letter.fileName === "letter.pdf" && avpAgain.offer?.people === 60,
    [avpAgain.resubmitOf, avpAgain.letter, avpAgain.offer],
  );
  check("P10", "✉ the AVP is told it was edited and sent again", mailed(m, AVP, `New external request ${again.reference}`) && /sent it again/.test(lastBodyTo(AVP)));
  const old = await get<any>(second, `/portal/requests/${exam.id}`);
  check("P10", "the declined one points at what replaced it, and can't be sent again twice", old.resubmittedAs?.reference === again.reference && old.canSendAgain === false && (await refused(409, () => submitExternal(second, { ...examBody, resubmitOf: exam.id }, false))));
}

// ── P15: who does what (2026-10-02) ─────────────────────────────────────────

async function whoDoesWhat() {
  const aliLab = await labOf(ALI);
  const store = await mainStore();
  const aliUser = await db.user.findUniqueOrThrow({ where: { emailLower: ALI } });
  const yUser = await db.user.findUniqueOrThrow({ where: { emailLower: YOHANNES } });
  const keeperUser = await db.user.findUniqueOrThrow({ where: { emailLower: KEEPER } });
  const changes = "/resources/items/changes";

  // Bookings follow the post, not the "manager" label.
  const slot = { itemIds: [aliLab.id], date: dayAhead(30), start: "09:00", end: "10:00", title: "Validation practical", onBehalfOfNote: "Second-year section B" };
  const bars: boolean[] = [];
  for (const who of [DEAN, AVP, CMD]) bars.push(await refused(403, () => post(who, "/scheduling/bookings", slot)));
  check("P15", "a dean, the AVP and the CMD don't book rooms", bars.every(Boolean), bars);
  const booked = await post<any>(ALI, "/scheduling/bookings", slot);
  check("P15", "the custodian books their own lab", typeof booked.id === "string", booked.state);

  // Custody and ownership are Property Administration's to change.
  const chairInLab = await db.item.findFirstOrThrow({ where: { parentId: aliLab.id, category: { key: "chair" }, deletedAt: null } });
  check("P15", "a custodian can't change who holds something", await refused(403, () => post(ALI, changes, { kind: "setCustodian", itemIds: [chairInLab.id], value: yUser.id, note: "Mine to give" })));
  check("P15", "Property Administration must say why", await refused(400, () => post(PROP, changes, { kind: "setCustodian", itemIds: [chairInLab.id], value: yUser.id })));
  await post(PROP, changes, { kind: "setCustodian", itemIds: [chairInLab.id], value: yUser.id, note: "Reassigned after the audit" });
  check("P15", "Property Administration changes it, at once", (await db.item.findUniqueOrThrow({ where: { id: chairInLab.id } })).custodianId === yUser.id);
  await post(PROP, changes, { kind: "setCustodian", itemIds: [chairInLab.id], value: aliUser.id, note: "Back to its lab's custodian" });

  // The store keeper's "Mine" is the stores they keep.
  const mine = await get<any>(KEEPER, "/resources/items?mode=flat");
  const rows: any[] = mine.rows ?? mine.items ?? [];
  check("P15", "the store keeper's Mine is what is in the stores they keep", rows.length > 0 && rows.every((r) => r.custodianId === keeperUser.id), rows.length);

  // A store's changes are decided by Property Administration.
  const table = await db.item.findFirstOrThrow({ where: { parentId: store.id, category: { key: "table" }, status: "WORKING", deletedAt: null } });
  const staged = await post<any>(KEEPER, changes, { kind: "setStatus", itemIds: [table.id], value: "BROKEN", note: "A leg is cracked" });
  check("P15", "the keeper's edit waits in the store's changes", staged.staged?.labItemId === store.id && (await db.item.findUniqueOrThrow({ where: { id: table.id } })).status === "WORKING", staged.staged);
  let m = mark();
  const sent = await post<any>(KEEPER, `/resources/labs/${store.id}/versions/draft/submit`);
  check("P15", "✉ Property Administration is asked to decide", mailed(m, PROP, `${store.name}: changes are waiting for your approval`));
  check("P15", "a department head can't decide a store's changes", await refused(403, () => post(HEAD, `/resources/lab-commits/${sent.id}/decide`, { decision: "APPROVE" })));
  m = mark();
  const decided = await post<any>(PROP, `/resources/lab-commits/${sent.id}/decide`, { decision: "APPROVE", note: "validated" });
  check("P15", "approved by Property Administration: the register changes", decided.status === "APPLIED" && (await db.item.findUniqueOrThrow({ where: { id: table.id } })).status === "BROKEN", decided.status);
  check("P15", "✉ the keeper hears it was approved", mailed(m, KEEPER, `${store.name}: your changes were approved`));

  // People: the ADAA reaches the college's custodians; a dean manages nobody.
  const byAdaa = await post<any>(ADAA, `/people/${aliUser.id}/phone`, { phone: "+251 911 555 011" });
  check("P15", "the ADAA sets a college custodian's phone; a dean can't", byAdaa.phone === "+251 911 555 011" && (await refused(403, () => post(DEAN, `/people/${aliUser.id}/phone`, { phone: "+251 911 555 012" }))));
}

// ── Run ─────────────────────────────────────────────────────────────────────

async function main() {
  const start = mark();
  await setup();
  for (const [name, fn] of [
    ["purchase and imports", purchaseAndImports],
    ["needs", needs],
    ["movements", movements],
    ["external requests", external],
    ["who does what", whoDoesWhat],
    ["places", places],
    ["categories and lab changes", categoriesAndLabChanges],
    ["mail tour", () => mailTour(start)],
  ] as const) {
    try {
      await fn();
    } catch (e) {
      check(name, "ran to the end", false, e instanceof Error ? e.message : String(e));
    }
  }
  fs.writeFileSync("e2e/validation-2026-10-03.json", JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) process.exitCode = 1;
}

main().finally(() => db.$disconnect());
