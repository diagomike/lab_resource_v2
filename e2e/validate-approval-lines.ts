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
 * Paths (the plan's Phase 6 list):
 *   P1 purchase ladder         head → dean → CMD → AVP → procurement → pipeline (✉ Property Admin)
 *   P2 import from the PR      Property Admin records it (✉ keeper) → keeper loads (over-load refused) → PR closes
 *   P3 standalone EGP import   recorded → loaded
 *   P4 store → a lab           receiving head → Property Admin → custodian accepts
 *   P5 needs feed purchasing   custodian asks (✉ head, badge) → head declines one (✉) → builds a request from the other
 *   P6 request from the store  keeper → receiving head → Property Admin → receipt
 *   P7 return to the store     owning head → Property Admin → keeper accepts
 *   P8 permanent transfers     same college: … → CMD; across colleges: … → CMD → Property Admin
 *   P9 loan                    unchanged: no CMD, no Property Admin; the owner stays
 *   P10 external (rooms)       sign up → verify → request → AVP → dean → head → 2 custodians → back up → quote → pay → AVP confirms
 *   P11 external (sample)      a machine held instead of a room
 *   P12 places from above      an invited custodian; the ADAA adds a lab for them (✉); custodians and other
 *                              departments' heads can't; the head changes who runs it (✉ both)
 *   P13 categories             a custodian's new category applies at once (✉ head); a change to data it
 *                              holds waits for the head, then converts the values
 *   P14 a lab's changes        staged in the lab's changes, not the register → sent (✉ head) → approved (✉)
 *   M  the mail tour           every emailed link: a real screen, the exact item, sign-in returns to it,
 *                              it opens for the person it was sent to, and the bell has the same notice
 * Writes e2e/validation-2026-10-02.json and prints a PASS/FAIL line per check.
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

/** Decides every remaining step of a transfer as whoever holds it, in order. */
async function walkTransfer(id: string): Promise<any> {
  for (let guard = 0; guard < 12; guard++) {
    const req = await get<any>("admin@astu.edu.et", `/resources/transfers/${id}`);
    if (req.status !== "PENDING") return req;
    const step = req.steps.find((s: any) => s.status === "PENDING");
    const who = await db.user.findUniqueOrThrow({ where: { id: step.approverId } });
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

async function purchaseAndImports() {
  const cse = await node("CSE");
  const [chair, computer] = [await catId("chair"), await catId("computer")];
  const pr = await post<any>(HEAD, "/resources/purchase-requests", {
    title: "Validation: two chairs and two desktops",
    orgNodeId: cse.id,
    lines: [
      { name: "Lab Chair", qty: 2, unit: "pcs", categoryId: chair, estimatedUnitCost: 1500, fromNeedIds: [] },
      { name: "Desktop Computer", qty: 2, unit: "pcs", categoryId: computer, estimatedUnitCost: 45000, fromNeedIds: [] },
    ],
  });
  const order = pr.steps.filter((s: any) => s.status !== "SKIPPED").map((s: any) => s.label);
  check("P1", "ladder is dean → CMD → AVP → procurement", JSON.stringify(order) === JSON.stringify([
    "College — College of Electrical Engineering and Computing",
    "College Managing Director",
    "University — Adama Science and Technology University",
    "Procurement Office",
  ]), order);

  let m = mark();
  await post(DEAN, `/resources/purchase-requests/${pr.id}/decide`, { decision: "APPROVE", note: "validated" });
  check("P1", "✉ CMD is next after the dean", mailed(m, CMD, `${pr.reference} is waiting for your approval`));
  check("P1", "the AVP can't decide before the CMD", await refused(403, () => post(AVP, `/resources/purchase-requests/${pr.id}/decide`, { decision: "APPROVE" })));
  m = mark();
  await post(CMD, `/resources/purchase-requests/${pr.id}/decide`, { decision: "APPROVE", note: "validated" });
  check("P1", "✉ AVP is next after the CMD", mailed(m, AVP, `${pr.reference} is waiting for your approval`));
  await post(AVP, `/resources/purchase-requests/${pr.id}/decide`, { decision: "APPROVE", note: "validated" });
  const placed = await post<any>(PROC, `/resources/purchase-requests/${pr.id}/decide`, { decision: "APPROVE", note: "validated" });
  check("P1", "approved → Order placed", placed.stage === "ORDER_PLACED", placed.stage);
  await post(PROC, `/resources/purchase-requests/${pr.id}/advance`, { note: "Buyer found" });
  await post(PROC, `/resources/purchase-requests/${pr.id}/advance`, { note: "On delivery" });
  m = mark();
  const arrived = await post<any>(PROC, `/resources/purchase-requests/${pr.id}/advance`, { note: "Arrived" });
  check("P1", "arrived at the main store", arrived.stage === "IN_STORE", arrived.stage);
  check("P1", "✉ Property Admin (not the store keeper) is told it arrived", mailed(m, PROP, `${pr.reference} has arrived at the main store`) && !mailed(m, KEEPER, `${pr.reference} has arrived at the main store`));

  // P2 — the import record from the PR, loaded by the keeper.
  check("P2", "the store keeper can't record an import", await refused(403, () => post(KEEPER, "/resources/imports", { source: "PURCHASE_REQUEST", purchaseRequestId: pr.id, lines: [{ name: "x", categoryId: chair, qty: 1 }] })));
  m = mark();
  const imp = await post<any>(PROP, "/resources/imports", {
    source: "PURCHASE_REQUEST",
    purchaseRequestId: pr.id,
    supplier: "Validation Supplies PLC",
    lines: [
      { name: "Lab Chair", categoryId: chair, qty: 2, unit: "pcs", purchaseLineId: pr.lines[0].id },
      { name: "Desktop Computer", categoryId: computer, qty: 2, unit: "pcs", spec: "HP ProDesk 400 G7", purchaseLineId: pr.lines[1].id },
    ],
  });
  check("P2", "IMP reference", /^IMP-\d{4}-\d{3}$/.test(imp.reference), imp.reference);
  check("P2", "✉ the store keeper is told to load it", mailed(m, KEEPER, `${imp.reference} is ready to load into the store`));
  check("P2", "recording more than was ordered is refused", await refused(409, () => post(PROP, "/resources/imports", { source: "PURCHASE_REQUEST", purchaseRequestId: pr.id, lines: [{ name: "Lab Chair", categoryId: chair, qty: 1, purchaseLineId: pr.lines[0].id }] })));
  const store = await mainStore();
  await post(KEEPER, `/resources/imports/${imp.id}/load`, { lineId: imp.lines[0].id, qty: 1, storeParentId: store.id });
  check("P2", "loading more than arrived is refused", await refused(409, () => post(KEEPER, `/resources/imports/${imp.id}/load`, { lineId: imp.lines[0].id, qty: 5, storeParentId: store.id })));
  await post(KEEPER, `/resources/imports/${imp.id}/load`, { lineId: imp.lines[0].id, qty: 1, storeParentId: store.id });
  m = mark();
  const loaded = await post<any>(KEEPER, `/resources/imports/${imp.id}/load`, { lineId: imp.lines[1].id, qty: 2, storeParentId: store.id });
  const closed = await get<any>(HEAD, `/resources/purchase-requests/${pr.id}`);
  check("P2", "import LOADED and the PR CLOSED", loaded.status === "LOADED" && closed.stage === "CLOSED", [loaded.status, closed.stage]);
  check("P2", "✉ the head is told it is in the store", mailed(m, HEAD, `${pr.reference} is in the store`));
  const inStore = await db.item.count({ where: { parentId: store.id, deletedAt: null, name: { startsWith: "Desktop Computer" } } });
  check("P2", "2 desktops are now items in the Main Store", inStore === 2, inStore);

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

  // P4 — store → a lab.
  const chair = await db.item.findFirstOrThrow({ where: { parentId: store.id, name: { startsWith: "Lab Chair" }, deletedAt: null } });
  let m = mark();
  const p4 = await transfer(KEEPER, { itemIds: [chair.id], transfer: { targetParentId: aliLab.id, targetOrgNodeId: cse.id, targetCustodianId: aliUser.id, transferOwnership: true } });
  check("P4", "chain: receiving head → Property Admin → custodian accepts", JSON.stringify(p4.request.steps.map((s: any) => s.selector)) === JSON.stringify(["TARGET_HEAD", "NODE_OCCUPANT", "TARGET_CUSTODIAN"]), approvers(p4.request));
  check("P4", "✉ the receiving head, and the custodian it's for", mailed(m, HEAD, /A transfer is waiting for you/) && mailed(m, ALI, /Coming to you from the store/));
  check("P4", "Procurement is not on it", !approvers(p4.request).some((a) => a.includes("Procurement")));
  const p4done = await walkTransfer(p4.request.id);
  const chairAfter = await db.item.findUniqueOrThrow({ where: { id: chair.id } });
  check("P4", "applied: owner CSE, custodian Ali, in his lab", p4done.status === "APPLIED" && chairAfter.ownerOrgNodeId === cse.id && chairAfter.custodianId === aliUser.id && chairAfter.parentId === aliLab.id);

  // P6 — Ali asks for a table from the store.
  const table = await db.item.findFirstOrThrow({ where: { parentId: store.id, category: { key: "table" }, deletedAt: null } });
  const p6 = await transfer(ALI, { itemIds: [table.id], transfer: { targetParentId: aliLab.id, targetOrgNodeId: "", targetCustodianId: null } });
  check("P6", "request from the store: keeper → CSE head → Property Admin → receipt", p6.request.movement === "FROM_STORE" && JSON.stringify(p6.request.steps.map((s: any) => s.selector)) === JSON.stringify(["ITEM_CUSTODIAN", "TARGET_HEAD", "NODE_OCCUPANT", "REQUESTER_RECEIPT"]), approvers(p6.request));
  await walkTransfer(p6.request.id);
  const tableAfter = await db.item.findUniqueOrThrow({ where: { id: table.id } });
  check("P6", "given, not lent: owner CSE, custodian Ali", tableAfter.ownerOrgNodeId === cse.id && tableAfter.custodianId === aliUser.id);

  // P7 — Ali returns his teacher chair to the store.
  const teacherChair = await childNamed(aliLab.id, "Teacher Chair");
  const p7 = await transfer(ALI, { itemIds: [teacherChair.id], transfer: { targetParentId: store.id, targetOrgNodeId: "", targetCustodianId: null } });
  check("P7", "return to the store: CSE head → Property Admin → keeper accepts", p7.request.movement === "TO_STORE" && JSON.stringify(p7.request.steps.map((s: any) => s.selector)) === JSON.stringify(["OWNER_HEAD", "NODE_OCCUPANT", "TARGET_CUSTODIAN"]), approvers(p7.request));
  await walkTransfer(p7.request.id);
  const tcAfter = await db.item.findUniqueOrThrow({ where: { id: teacherChair.id } });
  check("P7", "owned by the university, in the keeper's custody", tcAfter.parentId === store.id && tcAfter.ownerOrgNodeId === store.ownerOrgNodeId && tcAfter.custodianId === store.custodianId);

  // P8 — permanent: inside CoEEC (Ali → Yohannes), and across colleges (Ali → Hanna, ChemE).
  const teacherTable = await childNamed(aliLab.id, "Teacher Table");
  const yUser = await db.user.findUniqueOrThrow({ where: { emailLower: YOHANNES } });
  const p8a = await transfer(YOHANNES, { itemIds: [teacherTable.id], transfer: { targetParentId: yLab.id, targetOrgNodeId: "", targetCustodianId: null, permanent: true } });
  check("P8", "same college: Ali → CSE head (once) → CMD → receipt", p8a.request.movement === "PERMANENT" && JSON.stringify(approvers(p8a.request)) === JSON.stringify([
    "Current custodian (Ali Kibret Muhamed)",
    "Head — Computer Science and Engineering (CSE Department Head)",
    "College Managing Director (College Managing Director (CMD))",
    "Confirm receipt (Yohannes Alemu)",
  ]), approvers(p8a.request));
  await walkTransfer(p8a.request.id);
  const ttAfter = await db.item.findUniqueOrThrow({ where: { id: teacherTable.id } });
  check("P8", "custody moved to Yohannes (same owning department)", ttAfter.custodianId === yUser.id && ttAfter.parentId === yLab.id);

  const whiteboard = await childNamed(aliLab.id, "Whiteboard");
  const chem = await node("CHEM");
  const hannaUser = await db.user.findUniqueOrThrow({ where: { emailLower: HANNA } });
  const p8b = await transfer(HANNA, { itemIds: [whiteboard.id], transfer: { targetParentId: hannaLab.id, targetOrgNodeId: "", targetCustodianId: null, permanent: true } });
  check("P8", "across colleges: … → ChemE head → CMD → Property Admin → receipt", JSON.stringify(p8b.request.steps.map((s: any) => s.selector)) === JSON.stringify(["ITEM_CUSTODIAN", "OWNER_HEAD", "TARGET_HEAD", "NODE_OCCUPANT", "NODE_OCCUPANT", "REQUESTER_RECEIPT"]) && approvers(p8b.request).some((a) => a.startsWith("Property Administration")), approvers(p8b.request));
  await walkTransfer(p8b.request.id);
  const wbAfter = await db.item.findUniqueOrThrow({ where: { id: whiteboard.id } });
  check("P8", "ownership moved to ChemE, custody to Hanna", wbAfter.ownerOrgNodeId === chem.id && wbAfter.custodianId === hannaUser.id);

  // P9 — a loan across colleges: no central office, the owner stays.
  const rack = await childNamed(aliLab.id, "Switch Rack");
  const p9 = await transfer(HANNA, { itemIds: [rack.id], transfer: { targetParentId: hannaLab.id, targetOrgNodeId: "", targetCustodianId: null } });
  check("P9", "loan: custodian → owning head → receiving head → receipt; no CMD, no Property Admin", p9.request.movement === "LOAN" && JSON.stringify(p9.request.steps.map((s: any) => s.selector)) === JSON.stringify(["ITEM_CUSTODIAN", "OWNER_HEAD", "TARGET_HEAD", "REQUESTER_RECEIPT"]), approvers(p9.request));
  await walkTransfer(p9.request.id);
  const rackAfter = await db.item.findUniqueOrThrow({ where: { id: rack.id } });
  check("P9", "the owner stays CSE, custody stays with Ali", rackAfter.ownerOrgNodeId === cse.id && rackAfter.custodianId === aliUser.id && rackAfter.currentOrgNodeId === chem.id);
}

// ── P5: needs feed purchasing ───────────────────────────────────────────────

async function needs() {
  const aliLab = await labOf(ALI);
  const cse = await node("CSE");
  let m = mark();
  const wanted = await post<any>(ALI, "/resources/needs", { labItemId: aliLab.id, name: "Soldering station", qty: 3, unit: "pcs", priority: "ESSENTIAL", kind: "NEW", reason: "The embedded systems practical has 3 benches without one", spec: "Temperature-controlled, 60 W" });
  check("P5", "✉ the head hears what the lab needs", mailed(m, HEAD, `${aliLab.name} needs Soldering station`));
  const counts = await get<any>(HEAD, "/home/counts");
  check("P5", "the head's Purchasing badge counts it", counts.purchasing >= 1, counts);
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

  const place = { categoryId: labKind, name: "Validation Robotics Lab — B510-R30", ownerOrgNodeId: cse.id, custodianId: newbie.id, props: { block: "510", room: "30", seats: 24, purpose: "Robotics practicals" } };
  check("P12", "a custodian can't add a lab", await refused(403, () => post(ALI, "/places", place)));
  check("P12", "another department's head can't add one in CSE", await refused(403, () => post(CHEM_HEAD, "/places", place)));
  const offered = await get<any[]>(ADAA, `/places/custodians?unit=${cse.id}`);
  check("P12", "the ADAA is offered the department's custodians", offered.some((u) => u.id === newbie.id), offered.length);
  let m = mark();
  const lab = await post<any>(ADAA, "/places", place);
  check("P12", "the ADAA adds a CSE lab", lab.name === place.name && lab.custodianId === newbie.id);
  check("P12", "✉ the custodian hears they run it", mailed(m, NEWBIE, `You now run ${place.name}`));
  const note = await db.notification.findFirst({ where: { userId: newbie.id, title: `You now run ${place.name}` } });
  check("P12", "…and the bell has it, linking to the lab", note?.path === `/places/${lab.id}`, note?.path);
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
  // Withdrawn notices have nothing left to open, and the lab needs and arrivals tabs are
  // the item's own short queue; anything else should name its item.
  const unexpected = generic.filter((g) => !/withdrawn/i.test(g) && !/→ \/purchasing\?tab=(needs|arrivals)$/.test(g));
  check("M", "every link names its exact item (withdrawn notices and the needs/arrivals queues aside)", unexpected.length === 0, unexpected);
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

async function submitExternal(requester: string, payload: Record<string, unknown>): Promise<{ id: string; reference: string }> {
  const form = new FormData();
  form.set("payload", JSON.stringify(payload));
  form.set("letter", new Blob([PDF], { type: "application/pdf" }), "letter.pdf");
  return call(requester, "POST", "/portal/requests", form, true);
}

/** AVP → CoEEC → CSE, the head asking the given custodians. */
async function downTheLine(id: string, custodians: Array<{ email: string; want: string }>) {
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
  const people = await db.user.findMany({ where: { emailLower: { in: custodians.map((c) => c.email) } } });
  m = mark();
  await post(HEAD, `/external-requests/assignments/${dept.id}/assign`, { tasks: custodians.map((c) => ({ custodianId: people.find((p) => p.emailLower === c.email)!.id, want: c.want })) });
  check("P10", "✉ each custodian asked", custodians.every((c) => mailed(m, c.email, /^Hold (rooms|a machine) for EXT-/)));
  return { collegeId: college.id as string, deptId: dept.id as string };
}

async function upTheLine(id: string, parts: { collegeId: string; deptId: string }, amountSantim: number) {
  let m = mark();
  await post(HEAD, `/external-requests/assignments/${parts.deptId}/submit`, {
    sheetUrl: "https://docs.google.com/spreadsheets/d/validation",
    amountSantim,
    contacts: [{ name: "Ali Kibret Muhamed", role: "Lab responsible, B510-R8", phone: "+251911123456" }, { name: "CSE Department Office", phone: "+251221100000" }],
  });
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
  let m = mark();
  const created = await submitExternal(requester, {
    kind: "FACILITY",
    organizationName: "Addis Data Institute",
    contactName: "Ms. Requester",
    contactEmail: "outside.requester@example.org",
    contactPhone: "+251911000777",
    purpose: "A two-day data science workshop for 40 government employees.",
    windows: [{ date, start: "09:00", end: "12:00" }],
    lines: [{ description: "Two computer labs with internet", quantity: 2 }],
  });
  check("P10", "✉ requester and AVP told it arrived", mailed(m, "outside.requester@example.org", `Request ${created.reference} received`) && mailed(m, AVP, `New external request ${created.reference}`));
  check("P10", "a staff account can't read the requester's page", await refused(403, () => get(ALI, `/portal/requests/${created.id}`)));

  const aliLab = await labOf(ALI);
  const parts = await downTheLine(created.id, [
    { email: ALI, want: "B510-R8, mornings" },
    { email: YOHANNES, want: "Your lab, as a second room" },
  ]);
  const aliDto = await get<any>(ALI, `/external-requests/${created.id}`);
  check("P10", "Ali may hold his own lab only", aliDto.role === "CUSTODIAN" && aliDto.holdRooms.map((r: any) => r.id).includes(aliLab.id));
  await post(ALI, `/external-requests/${created.id}/hold`, { itemIds: [aliLab.id], date, start: "09:00", end: "12:00" });
  check("P10", "the head can't answer while a custodian hasn't", await refused(409, () => post(HEAD, `/external-requests/assignments/${parts.deptId}/submit`, { sheetUrl: "https://docs.google.com/x", amountSantim: 1, contacts: [{ name: "x y", phone: "0911000000" }] })));
  const tasks = (await get<any>(HEAD, `/external-requests/${created.id}`)).assignments.find((a: any) => a.id === parts.deptId).tasks;
  let mm = mark();
  await post(ALI, `/external-requests/tasks/${tasks.find((t: any) => t.custodianName.startsWith("Ali")).id}/finish`, { outcome: "DONE", note: "Held 09:00–12:00" });
  await post(YOHANNES, `/external-requests/tasks/${tasks.find((t: any) => t.custodianName.startsWith("Yohannes")).id}/finish`, { outcome: "DECLINED", note: "My lab has an exam that day" });
  check("P10", "✉ the head hears from both custodians", since(mm).filter((x) => x.to.some((t) => t.includes(HEAD))).length === 2);
  await upTheLine(created.id, parts, 1_250_000);
  const avpView = await get<any>(AVP, `/external-requests/${created.id}`);
  check("P10", "the AVP can quote, suggested from the approved department", avpView.can.quote && avpView.suggestedQuoteSantim === 1_250_000, [avpView.can.quote, avpView.suggestedQuoteSantim]);
  m = mark();
  await post(AVP, `/external-requests/${created.id}/quote`, { amountSantim: 1_250_000, paymentDeadline: dayAhead(10), note: "Includes lab assistants" });
  check("P10", "✉ the requester gets the quote", mailed(m, "outside.requester@example.org", `Quote for request ${created.reference}`));
  let mine = await get<any>(requester, `/portal/requests/${created.id}`);
  check("P10", "requester sees the breakdown, bank details and the held room — no contacts yet", mine.quote.breakdown.length === 1 && !!mine.quote.bank && mine.bookings.length === 1 && !mine.bookings[0].confirmed && mine.contacts.length === 0, { breakdown: mine.quote.breakdown, bookings: mine.bookings });

  m = mark();
  const paid = await post<any>(requester, `/portal/requests/${created.id}/payments`, { provider: "TELEBIRR", reference: "FAKE-12500" });
  check("P10", "verified payment → PAID, waiting for the AVP", paid.outcome === "VERIFIED" && paid.tracking.status === "PAID", [paid.outcome, paid.tracking.status]);
  check("P10", "✉ the AVP is asked to confirm the payment", mailed(m, AVP, `${created.reference} is paid — confirm the payment`));
  check("P10", "a head can't confirm the payment", await refused(403, () => post(HEAD, `/external-requests/${created.id}/confirm`, {})));
  m = mark();
  const confirmed = await post<any>(AVP, `/external-requests/${created.id}/confirm`, {});
  check("P10", "the AVP confirms → SCHEDULED, contacts revealed", confirmed.status === "SCHEDULED" && !!confirmed.contactsRevealedAt);
  check("P10", "✉ requester (with contacts), custodian and head", mailed(m, "outside.requester@example.org", `Booking confirmed — ${created.reference}`) && mailed(m, ALI, `Booking confirmed on your calendar — ${created.reference}`) && mailed(m, HEAD, `${created.reference} is paid and booked`));
  check("P10", "the confirmation email lists the contact persons", /\+251911123456/.test(lastBodyTo("outside.requester@example.org")));
  mine = await get<any>(requester, `/portal/requests/${created.id}`);
  check("P10", "requester now sees the booked room and who to call", mine.bookings.every((b: any) => b.confirmed) && mine.contacts[0]?.people.length === 2, { bookings: mine.bookings, contacts: mine.contacts });

  // P11 — a sample analysis on a machine.
  const sampleDate = dayAhead(22);
  const machine = await db.item.findFirstOrThrow({
    where: { category: { key: "computer" }, status: "WORKING", deletedAt: null, parent: { parentId: aliLab.id } },
    include: { parent: { select: { name: true } } },
  });
  const s = await submitExternal(requester, {
    kind: "SAMPLE_ANALYSIS",
    organizationName: "Addis Data Institute",
    contactName: "Ms. Requester",
    contactEmail: "outside.requester@example.org",
    contactPhone: "+251911000777",
    purpose: "Benchmark our dataset on a lab workstation.",
    windows: [{ date: sampleDate, start: "09:00", end: "11:00" }],
    lines: [],
    sample: { categoryId: await catId("computer"), sampleCount: 3, analysis: "Run the benchmark suite and report timings" },
  });
  const sParts = await downTheLine(s.id, [{ email: ALI, want: "One workstation computer" }]);
  await post(ALI, `/external-requests/${s.id}/hold`, { itemIds: [machine.id], date: sampleDate, start: "09:00", end: "11:00" });
  const sTask = (await get<any>(ALI, `/external-requests/${s.id}`)).assignments.find((a: any) => a.id === sParts.deptId).tasks[0];
  await post(ALI, `/external-requests/tasks/${sTask.id}/finish`, { outcome: "DONE" });
  await upTheLine(s.id, sParts, 300_000);
  await post(AVP, `/external-requests/${s.id}/quote`, { amountSantim: 300_000, paymentDeadline: dayAhead(10) });
  const sMine = await get<any>(requester, `/portal/requests/${s.id}`);
  check("P11", "the requester sees the machine held, in its lab", sMine.kind === "SAMPLE_ANALYSIS" && sMine.bookings[0]?.place === `${machine.name} — ${aliLab.name}`, sMine.bookings);
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
  fs.writeFileSync("e2e/validation-2026-10-02.json", JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) process.exitCode = 1;
}

main().finally(() => db.$disconnect());
