/**
 * Builds, on a freshly reset E2E clone, the moment the user guide's screenshots show: every
 * role with something real waiting for them. Everything goes through the app's own API, as
 * the people themselves would do it (sessions minted, as in validate-approval-lines.ts).
 *
 *   node e2e/reset-demo.mjs
 *   node e2e/mail-sink.mjs                                    (another terminal)
 *   node e2e/with-env.mjs npx next start -p 3100              (after `next build`; or next dev)
 *   node e2e/with-env.mjs npx tsx e2e/stage-guide.ts
 *   node e2e/guide-shots.mjs                                  (the screenshots)
 *
 * What is left waiting, and for whom:
 *  - Ali (custodian, B510-R8): changes staged in his lab, not sent; a booking request for his lab
 *  - Yohannes's lab: changes sent → the CSE head decides
 *  - the CSE head: two open lab needs; the changes above
 *  - the CoEEC dean: a purchase request built from lab needs
 *  - procurement: one request to approve, one placed order to move along
 *  - Property Administration: an arrived order to record; a store handover to approve
 *  - the store keeper: an import record to load
 *  - the CMD: a permanent transfer across colleges
 *  - the AVP: a new outside request, and one answered by the college, ready to quote
 */
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import { generateToken, hashToken } from "../lib/server/auth/token";

if (!process.env.DATABASE_URL?.includes("lrms_v2_e2e")) throw new Error("stage-guide.ts runs against lrms_v2_e2e only");
const db = new PrismaClient();
const BASE = "http://localhost:3100/api";

const tokens = new Map<string, string>();
async function sessionOf(email: string): Promise<string> {
  const hit = tokens.get(email);
  if (hit) return hit;
  const user = await db.user.findUniqueOrThrow({ where: { emailLower: email.toLowerCase() } });
  const token = generateToken();
  await db.session.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 86_400_000), userAgent: "stage-guide" } });
  tokens.set(email, token);
  return token;
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
  if (!res.ok) throw new Error(`${method} ${path} as ${who.slice(0, 40)} → ${res.status}: ${json?.message ?? text}`);
  return json as T;
}
const get = <T = any>(w: string, p: string) => call<T>(w, "GET", p);
const post = <T = any>(w: string, p: string, b: unknown = {}) => call<T>(w, "POST", p, b);

const ADMIN = "admin@astu.edu.et";
const HEAD = "cse.head@astu.edu.et";
const DEAN = "coeec.dean@astu.edu.et";
const AVP = "avp@astu.edu.et";
const CMD = "cmd@astu.edu.et";
const PROP = "property.admin@astu.edu.et";
const PROC = "procurement@astu.edu.et";
const KEEPER = "store.keeper@astu.edu.et";
const ALI = "alikibretmuhamed@gmail.com";
const YOHANNES = "yohanesalemu0069@gmail.com";
const KEBEDE = "kabetagane22@gmail.com";
const HANNA = "custodian.chem@astu.edu.et";

const node = (code: string) => db.orgNode.findUniqueOrThrow({ where: { code } });
const catId = async (key: string) => (await db.resourceCategory.findUniqueOrThrow({ where: { key } })).id;
async function labOf(email: string) {
  const u = await db.user.findUniqueOrThrow({ where: { emailLower: email } });
  return db.item.findFirstOrThrow({ where: { custodianId: u.id, parentId: null, deletedAt: null, category: { key: "lab" } }, orderBy: { name: "asc" } });
}
const mainStore = () => db.item.findFirstOrThrow({ where: { parentId: null, deletedAt: null, name: "ASTU Main Store" } });
const dayAhead = (n: number) => new Date(Date.now() + 3 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
const say = (s: string) => console.log(`✓ ${s}`);

/** Decides a purchase's steps until `stopBefore` is the one waiting (or it is placed). */
async function climb(prId: string, stopBefore: string | null) {
  for (let guard = 0; guard < 8; guard++) {
    const pr = await get(HEAD, `/resources/purchase-requests/${prId}`);
    const step = pr.steps.find((s: any) => s.status === "PENDING");
    if (!step || (stopBefore && step.label.startsWith(stopBefore))) return pr;
    const who = await db.user.findUniqueOrThrow({ where: { id: step.approverId } });
    await post(who.email, `/resources/purchase-requests/${prId}/decide`, { decision: "APPROVE", note: "Agreed." });
  }
}

async function main() {
  const cse = await node("CSE");
  const [chair, computer, monitor] = await Promise.all(["chair", "computer", "monitor"].map(catId));
  const aliLab = await labOf(ALI);
  const yLab = await labOf(YOHANNES);
  const hannaLab = await labOf(HANNA);
  const aliUser = await db.user.findUniqueOrThrow({ where: { emailLower: ALI } });
  const store = await mainStore();

  // The walkthrough's Act 1: labs are bookable rooms, computers bookable machines, both public.
  await db.resourceCategory.update({ where: { key: "lab" }, data: { bookingMode: "ROOM", publicListed: true } });
  await db.resourceCategory.update({ where: { key: "computer" }, data: { bookingMode: "EQUIPMENT", publicListed: true } });

  // ── Needs and purchases ──
  const scope = await post(ALI, "/resources/needs", { labItemId: aliLab.id, name: "Digital oscilloscope", qty: 4, unit: "pcs", priority: "ESSENTIAL", kind: "NEW", reason: "The signals practical runs 4 benches with one scope between them", spec: "100 MHz, 2-channel" });
  const cable = await post(KEBEDE, "/resources/needs", { labItemId: (await labOf(KEBEDE)).id, name: "HDMI cable", qty: 10, unit: "pcs", priority: "IMPORTANT", kind: "NEW", reason: "Projector and monitor cables are worn out" });
  const prDean = await post(HEAD, "/resources/purchase-requests", {
    title: "Computer Science and Engineering: lab needs, October 2026",
    orgNodeId: cse.id,
    lines: [
      { name: "Digital oscilloscope", qty: 4, unit: "pcs", estimatedUnitCost: 38500, justification: "B510-R8 (4): one scope per bench for the signals practical", fromNeedIds: [scope.id] },
      { name: "HDMI cable", qty: 10, unit: "pcs", estimatedUnitCost: 450, justification: "Replaces worn cables in B508-R13 and B510-R13", fromNeedIds: [cable.id] },
    ],
  });
  say(`${prDean.reference} waits on the dean`);

  const broken = await db.item.findFirst({ where: { status: "BROKEN", deletedAt: null, custodianId: aliUser.id, category: { key: "monitor" } } });
  await post(ALI, "/resources/needs", { labItemId: aliLab.id, name: "Soldering station", qty: 3, unit: "pcs", priority: "ESSENTIAL", kind: "NEW", reason: "The embedded systems practical has 3 benches without one", spec: "Temperature-controlled, 60 W" });
  await post(ALI, "/resources/needs", { labItemId: aliLab.id, name: "Monitor", qty: 1, unit: "pcs", categoryId: monitor, priority: "IMPORTANT", kind: broken ? "REPLACEMENT" : "NEW", ...(broken ? { replacesItemIds: [broken.id] } : {}), reason: "A workstation has had no screen since last term", spec: '22" IPS, HDMI' });
  say("two open needs for the CSE head");

  const prProc = await post(HEAD, "/resources/purchase-requests", { title: "Network lab switches", orgNodeId: cse.id, lines: [{ name: "24-port managed switch", qty: 2, unit: "pcs", estimatedUnitCost: 32000, justification: "The networking practical's racks have one switch each" }] });
  await climb(prProc.id, "Procurement");
  say(`${prProc.reference} waits on procurement`);

  const prPlaced = await post(HEAD, "/resources/purchase-requests", { title: "Teaching lab projectors", orgNodeId: cse.id, lines: [{ name: "Projector", qty: 3, unit: "pcs", estimatedUnitCost: 41000, justification: "Three labs have no working projector" }] });
  await climb(prPlaced.id, null);
  say(`${prPlaced.reference} is an order to move along`);

  const prArrived = await post(HEAD, "/resources/purchase-requests", {
    title: "Workstation refresh, B510-R8",
    orgNodeId: cse.id,
    lines: [
      { name: "Lab Chair", qty: 10, unit: "pcs", categoryId: chair, estimatedUnitCost: 1500, justification: "Broken chairs" },
      { name: "Desktop Computer", qty: 4, unit: "pcs", categoryId: computer, estimatedUnitCost: 45000, justification: "Four workstations without a computer" },
    ],
  });
  await climb(prArrived.id, null);
  for (const note of ["Buyer found", "On delivery", "Arrived at the main store"]) await post(PROC, `/resources/purchase-requests/${prArrived.id}/advance`, { note });
  say(`${prArrived.reference} has arrived — Property Administration records it`);

  const prLoad = await post(HEAD, "/resources/purchase-requests", { title: "Embedded lab benches", orgNodeId: cse.id, lines: [{ name: "Lab Chair", qty: 6, unit: "pcs", categoryId: chair, estimatedUnitCost: 1500, justification: "New benches" }] });
  await climb(prLoad.id, null);
  for (const note of ["Buyer found", "On delivery", "Arrived"]) await post(PROC, `/resources/purchase-requests/${prLoad.id}/advance`, { note });
  const imp = await post(PROP, "/resources/imports", { source: "PURCHASE_REQUEST", purchaseRequestId: prLoad.id, supplier: "Adama Furniture PLC", lines: [{ name: "Lab Chair", categoryId: chair, qty: 6, unit: "pcs", spec: "Stackable, grey", purchaseLineId: prLoad.lines[0].id }] });
  say(`${imp.reference} is ready for the store keeper to load`);

  // ── A lab's changes ──
  const yComputer = await db.item.findFirstOrThrow({ where: { category: { key: "computer" }, status: "WORKING", deletedAt: null, parent: { parentId: yLab.id } } });
  await post(YOHANNES, "/resources/items/changes", { kind: "setStatus", itemIds: [yComputer.id], value: "BROKEN", note: "No display, the GPU fan stopped" });
  const yChair = await db.item.findFirstOrThrow({ where: { category: { key: "chair" }, deletedAt: null, parentId: yLab.id } });
  await post(YOHANNES, "/resources/items/changes", { kind: "setStatus", itemIds: [yChair.id], value: "BROKEN", note: "Broken leg" });
  await post(YOHANNES, `/resources/labs/${yLab.id}/versions/draft/submit`);
  say(`${yLab.name}'s changes wait on the CSE head`);

  const aliMonitor = await db.item.findFirstOrThrow({ where: { category: { key: "monitor" }, status: "WORKING", deletedAt: null, parent: { parent: { parentId: aliLab.id } } } });
  await post(ALI, "/resources/items/changes", { kind: "setStatus", itemIds: [aliMonitor.id], value: "BROKEN", note: "No signal" });
  say(`${aliLab.name} has changes staged, not sent`);

  // ── Movements ──
  const ws = await db.item.findFirstOrThrow({ where: { parentId: aliLab.id, deletedAt: null, name: { startsWith: "Workstation" } }, orderBy: { name: "desc" } });
  const perm = await post(HANNA, "/resources/transfers", { input: { kind: "transferItem", itemIds: [ws.id], transfer: { targetParentId: hannaLab.id, targetOrgNodeId: "", targetCustodianId: null, permanent: true }, note: "Our process-control practical needs a second workstation this year" } });
  for (let guard = 0; guard < 6; guard++) {
    const req = await get(HANNA, `/resources/transfers/${perm.request.id}`);
    const step = req.steps.find((s: any) => s.status === "PENDING");
    if (!step || step.label.startsWith("College Managing Director")) break;
    const who = await db.user.findUniqueOrThrow({ where: { id: step.approverId } });
    await post(who.email, `/resources/transfers/${perm.request.id}/decide`, { decision: "APPROVE", note: "Agreed." });
  }
  say(`a permanent transfer of ${ws.name} waits on the CMD`);

  const storeChair = await db.item.findFirst({ where: { parentId: store.id, deletedAt: null, name: { startsWith: "Lab Chair" } } });
  const set = storeChair ?? (await db.item.findFirstOrThrow({ where: { parentId: store.id, deletedAt: null }, orderBy: { name: "asc" } }));
  const handover = await post(KEEPER, "/resources/transfers", { input: { kind: "transferItem", itemIds: [set.id], transfer: { targetParentId: aliLab.id, targetOrgNodeId: cse.id, targetCustodianId: aliUser.id, transferOwnership: true } } });
  await post(HEAD, `/resources/transfers/${handover.request.id}/decide`, { decision: "APPROVE", note: "Yes, for the new bench" });
  say(`a store handover of ${set.name} waits on Property Administration`);

  // ── A booking request for Ali's lab ──
  await post(KEBEDE, "/scheduling/bookings", { itemIds: [aliLab.id], date: dayAhead(3), start: "14:00", end: "16:00", title: "Operating systems practical", onBehalfOfNote: "3rd-year section 2", participantCount: 20 });
  say("a booking request waits on Ali");

  // ── Outside requests ──
  const requester = await requesterAccount("outside.requester@example.org", "Addis Data Institute");
  const fresh = await submitExternal(requester, {
    kind: "FACILITY",
    organizationName: "Addis Data Institute",
    contactName: "Ms. Requester",
    contactEmail: "outside.requester@example.org",
    contactPhone: "+251911000777",
    purpose: "A two-day data science workshop for 40 government employees.",
    windows: [{ date: dayAhead(20), start: "09:00", end: "12:00" }],
    lines: [{ description: "Two computer labs with internet", quantity: 2 }],
  });
  say(`${fresh.reference} is new on the AVP's desk`);

  const date = dayAhead(25);
  const answered = await submitExternal(requester, {
    kind: "FACILITY",
    organizationName: "Addis Data Institute",
    contactName: "Ms. Requester",
    contactEmail: "outside.requester@example.org",
    contactPhone: "+251911000777",
    purpose: "A one-day Python training for 20 analysts.",
    windows: [{ date, start: "09:00", end: "12:00" }],
    lines: [{ description: "One computer lab", quantity: 1 }],
  });
  const coeec = await node("COEEC");
  await post(AVP, `/external-requests/${answered.id}/forward`, { orgNodeIds: [coeec.id], note: "Please check capacity" });
  let dto = await get(DEAN, `/external-requests/${answered.id}`);
  const college = dto.assignments.find((a: any) => a.level === "COLLEGE");
  dto = await post(DEAN, `/external-requests/assignments/${college.id}/forward`, { orgNodeIds: [cse.id] });
  const dept = dto.assignments.find((a: any) => a.orgNodeId === cse.id);
  await post(HEAD, `/external-requests/assignments/${dept.id}/assign`, { tasks: [{ custodianId: aliUser.id, want: "B510-R8, the morning" }] });
  await post(ALI, `/external-requests/${answered.id}/hold`, { itemIds: [aliLab.id], date, start: "09:00", end: "12:00" });
  const task = (await get(ALI, `/external-requests/${answered.id}`)).assignments.find((a: any) => a.id === dept.id).tasks[0];
  await post(ALI, `/external-requests/tasks/${task.id}/finish`, { outcome: "DONE", note: "Held 09:00–12:00" });
  await post(HEAD, `/external-requests/assignments/${dept.id}/submit`, { sheetUrl: "https://docs.google.com/spreadsheets/d/cost-sheet", amountSantim: 1_250_000, contacts: [{ name: "Ali Kibret Muhamed", role: "Lab responsible, B510-R8", phone: "+251911123456" }] });
  await post(DEAN, `/external-requests/assignments/${dept.id}/review`, { decision: "APPROVE" });
  await post(DEAN, `/external-requests/assignments/${college.id}/submit`, { note: "One department hosts it" });
  await post(AVP, `/external-requests/assignments/${college.id}/review`, { decision: "APPROVE" });
  say(`${answered.reference} is ready for the AVP to quote`);

  void ADMIN;
  void CMD;

  // What the screenshot script (e2e/guide-shots.mjs) opens directly.
  const state = {
    aliLab: aliLab.id,
    yLab: yLab.id,
    store: store.id,
    storeItem: set.id,
    // Untouched: the custodian's Change dialog and the keeper's Move dialog open on these.
    aliMonitor: (await db.item.findFirstOrThrow({ where: { category: { key: "monitor" }, status: "WORKING", deletedAt: null, id: { not: aliMonitor.id }, parent: { parent: { parentId: aliLab.id } } } })).id,
    storeItem2: (await db.item.findFirstOrThrow({ where: { parentId: store.id, deletedAt: null, id: { not: set.id }, name: { startsWith: "Chair" } }, orderBy: { name: "asc" } })).id,
    prDean: prDean.id,
    prProc: prProc.id,
    prPlaced: prPlaced.id,
    prArrived: prArrived.id,
    imp: imp.id,
    perm: perm.request.id,
    handover: handover.request.id,
    extNew: fresh.id,
    extQuote: answered.id,
  };
  fs.writeFileSync("e2e/.guide-state.json", JSON.stringify(state, null, 2));
  say("wrote e2e/.guide-state.json");
}

const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");

async function requesterAccount(email: string, organisation: string): Promise<string> {
  const body = { organisation, name: "Ms. Requester", email, phone: "+251911000777", password: "outside-pass-1" };
  const signup = await fetch(`${BASE}/public/signup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!signup.ok) throw new Error(`signup → ${signup.status}: ${await signup.text()}`);
  // Confirmed directly: this script stages screens, it doesn't test the email link (the validator does).
  await db.user.update({ where: { emailLower: email }, data: { status: "ACTIVE" } });
  await db.invitation.updateMany({ where: { emailLower: email, intendedRole: "EXTERNAL", consumedAt: null }, data: { consumedAt: new Date() } });
  const res = await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: body.password }) });
  if (!res.ok) throw new Error(`requester login → ${res.status}: ${await res.text()}`);
  return `cookie:${(res.headers.get("set-cookie") ?? "").split(";")[0]}`;
}

async function submitExternal(requester: string, payload: Record<string, unknown>): Promise<{ id: string; reference: string }> {
  const form = new FormData();
  form.set("payload", JSON.stringify(payload));
  form.set("letter", new Blob([PDF], { type: "application/pdf" }), "letter.pdf");
  return call(requester, "POST", "/portal/requests", form, true);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
