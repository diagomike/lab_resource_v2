/**
 * Validates the 2026-09-28 approval-line round end to end, through the app's own HTTP API
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
 *   P5 store → a person        Staff holdings; head → Property Admin → the person accepts; head returns it
 *   P6 request from the store  keeper → receiving head → Property Admin → receipt
 *   P7 return to the store     owning head → Property Admin → keeper accepts
 *   P8 permanent transfers     same college: … → CMD; across colleges: … → CMD → Property Admin
 *   P9 loan                    unchanged: no CMD, no Property Admin; the owner stays
 *   P10 external (rooms)       sign up → verify → request → AVP → dean → head → 2 custodians → back up → quote → pay → AVP confirms
 *   P11 external (sample)      a machine held instead of a room
 * Writes e2e/validation-2026-09-28.json and prints a PASS/FAIL line per check.
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

  // P5 — store → a person (a lecturer invited through the app), then back to the store.
  const lecturerEmail = "mt.lecturer@example.org";
  await post(ADMIN, "/people", { name: "MT Lecturer", email: lecturerEmail, roles: ["STAFF"], homeNodeId: cse.id });
  const inviteToken = lastBodyTo(lecturerEmail).match(/accept-invite\?token=([\w-]+)/)?.[1];
  await call("anon", "POST", "/auth/register", { token: inviteToken, name: "MT Lecturer", password: "astu1234-lecturer" }).catch(async () => {
    const res = await fetch(`${BASE}/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: inviteToken, name: "MT Lecturer", password: "astu1234-lecturer" }) });
    if (!res.ok) throw new Error(`register → ${res.status}`);
  });
  const lecturer = await db.user.findUniqueOrThrow({ where: { emailLower: lecturerEmail } });
  check("P5", "the lecturer registered through the invitation", lecturer.status === "ACTIVE");
  const laptop = await db.item.findFirstOrThrow({ where: { parentId: store.id, name: { startsWith: "Laptop" }, deletedAt: null } });
  m = mark();
  const p5 = await transfer(KEEPER, { itemIds: [laptop.id], transfer: { targetParentId: "", targetOrgNodeId: "", targetCustodianId: null, transferOwnership: true, issueToUserId: lecturer.id } });
  const holdings = await db.item.findFirst({ where: { parentId: null, ownerOrgNodeId: cse.id, category: { key: "staff-holdings" }, deletedAt: null } });
  check("P5", "Staff holdings — CSE created, the head answers for it", !!holdings && holdings.name === `Staff holdings — ${cse.name}` && holdings.custodianId === (await node("CSE")).userId, holdings?.name);
  check("P5", "chain: head → Property Admin → the lecturer accepts", JSON.stringify(p5.request.steps.map((s: any) => [s.selector, s.approverName])) === JSON.stringify([["TARGET_HEAD", "CSE Department Head"], ["NODE_OCCUPANT", "Property Administrator"], ["TARGET_CUSTODIAN", "MT Lecturer"]]), approvers(p5.request));
  check("P5", "✉ the lecturer hears it is coming", mailed(m, lecturerEmail, /Coming to you from the store/));
  await walkTransfer(p5.request.id);
  const laptopAfter = await db.item.findUniqueOrThrow({ where: { id: laptop.id } });
  check("P5", "applied: in Staff holdings, the lecturer is custodian", laptopAfter.parentId === holdings?.id && laptopAfter.custodianId === lecturer.id);
  check("P5", "the lecturer can't edit it (asks instead)", await refused(403, () => post(lecturerEmail, "/resources/items/changes", { input: { kind: "setStatus", itemIds: [laptop.id], value: "BROKEN" } })) || await refused(403, () => post(lecturerEmail, "/resources/items/changes", { kind: "setStatus", itemIds: [laptop.id], value: "BROKEN" })));
  const back = await transfer(HEAD, { itemIds: [laptop.id], transfer: { targetParentId: store.id, targetOrgNodeId: "", targetCustodianId: null } });
  check("P5", "the head returns it: lecturer → Property Admin → keeper", back.request.movement === "TO_STORE" && JSON.stringify(approvers(back.request)) === JSON.stringify(["Current custodian (MT Lecturer)", "Property Administration (Property Administrator)", "Receiving custodian accepts (Main Store Keeper)"]), approvers(back.request));
  await walkTransfer(back.request.id);
  const laptopHome = await db.item.findUniqueOrThrow({ where: { id: laptop.id } });
  check("P5", "back in the Main Store, owned by the university", laptopHome.parentId === store.id && laptopHome.ownerOrgNodeId === store.ownerOrgNodeId);

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
  await setup();
  for (const [name, fn] of [
    ["purchase and imports", purchaseAndImports],
    ["movements", movements],
    ["external requests", external],
  ] as const) {
    try {
      await fn();
    } catch (e) {
      check(name, "ran to the end", false, e instanceof Error ? e.message : String(e));
    }
  }
  fs.writeFileSync("e2e/validation-2026-09-28.json", JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) process.exitCode = 1;
}

main().finally(() => db.$disconnect());
