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
 *  - procurement: one request to start buying, one procurement under way (a line edited)
 *  - Property Administration: an arrived procurement to record; a store handover and a
 *    store's changes to approve
 *  - the store keeper: an import record to load; stock to distribute to the lab that asked
 *  - the CMD: a permanent transfer across colleges
 *  - the AVP: a new outside request (lab setups), and one answered by the college, ready to quote
 *  - the CSE head: an outside request to book places for, and one being held
 *  - Ali: a hold request his lab falls short for
 *  - Hanna (ChemE): instruments in every calibration status
 *  - a second requester: a declined request they can edit and send again
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
const BIRUK = "birukteferahunde@gmail.com";

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
  const [chair, computer, monitor, labKind, setupKind, whiteboard] = await Promise.all(["chair", "computer", "monitor", "lab", "setup", "whiteboard"].map(catId));
  const move = (id: string, body: Record<string, unknown>) => post(PROC, `/resources/procurements/${id}/move`, body);
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

  // A procurement under way: started from the request, placed on EGP, a buyer found, and
  // one line edited on the way (fewer found than asked).
  const prPlaced = await post(HEAD, "/resources/purchase-requests", {
    title: "Teaching lab projectors",
    orgNodeId: cse.id,
    lines: [
      { name: "Projector", qty: 3, unit: "pcs", estimatedUnitCost: 41000, justification: "Three labs have no working projector" },
      { name: "Projector ceiling mount", qty: 3, unit: "pcs", estimatedUnitCost: 3500, justification: "One per projector" },
    ],
  });
  const placed = await climb(prPlaced.id, null);
  const procMoving: string = (await get(HEAD, `/resources/purchase-requests/${prPlaced.id}`)).procurement.id;
  void placed;
  await move(procMoving, { stage: "PLACED_ON_EGP", egpReference: "EGP-2026/0457", note: "Tender floated for 10 days" });
  let moving = await move(procMoving, { stage: "BUYER_FOUND", supplier: "Abyssinia Tech PLC", note: "Abyssinia Tech won the tender" });
  await post(PROC, `/resources/procurements/${procMoving}/lines`, {
    reason: "The supplier has only two projectors of this model in stock",
    lines: moving.lines.map((l: any) => ({ id: l.id, name: l.name, categoryId: l.categoryId, qty: l.name === "Projector" ? 2 : l.qty, unit: l.unit, unitCost: l.unitCost, spec: l.spec, purchaseLineId: l.purchaseLineId })),
  });
  say(`${prPlaced.reference} is being bought: a procurement to move along`);

  const prArrived = await post(HEAD, "/resources/purchase-requests", {
    title: "Workstation refresh, B510-R8",
    orgNodeId: cse.id,
    lines: [
      { name: "Lab Chair", qty: 10, unit: "pcs", categoryId: chair, estimatedUnitCost: 1500, justification: "Broken chairs" },
      { name: "Desktop Computer", qty: 4, unit: "pcs", categoryId: computer, estimatedUnitCost: 45000, justification: "Four workstations without a computer" },
    ],
  });
  await climb(prArrived.id, null);
  const procArrived: string = (await get(HEAD, `/resources/purchase-requests/${prArrived.id}`)).procurement.id;
  const onTheWay = await move(procArrived, { stage: "ON_DELIVERY", egpReference: "EGP-2026/0461", supplier: "Adama Office Supplies" });
  // One desktop short on delivery: procurement records what came, Property Administration checks it.
  await move(procArrived, { stage: "ARRIVED", note: "Delivered to the main store", arrived: onTheWay.lines.map((l: any) => ({ lineId: l.id, qty: l.name === "Desktop Computer" ? 3 : l.qty })) });
  say(`${prArrived.reference} has arrived: Property Administration records it`);

  // Chairs a lab asked for: bought, arrived, recorded; the keeper loads them and sends them on.
  const kebedeLab = await labOf(KEBEDE);
  const chairNeed = await post(KEBEDE, "/resources/needs", { labItemId: kebedeLab.id, name: "Lab Chair", qty: 2, unit: "pcs", categoryId: chair, priority: "IMPORTANT", kind: "NEW", reason: "Two benches have no chair" });
  const prLoad = await post(HEAD, "/resources/purchase-requests", { title: "Embedded lab benches", orgNodeId: cse.id, lines: [{ name: "Lab Chair", qty: 6, unit: "pcs", categoryId: chair, estimatedUnitCost: 1500, justification: "New benches, and two chairs B508-R13 asked for", fromNeedIds: [chairNeed.id] }] });
  await climb(prLoad.id, null);
  const procLoad: string = (await get(HEAD, `/resources/purchase-requests/${prLoad.id}`)).procurement.id;
  const loadProc = await move(procLoad, { stage: "ARRIVED", egpReference: "EGP-2026/0449", supplier: "Adama Furniture PLC", note: "Delivered" });
  const imp = await post(PROP, "/resources/imports", { source: "PROCUREMENT", procurementId: procLoad, lines: loadProc.lines.map((l: any) => ({ name: l.name, categoryId: l.categoryId, qty: l.arrivedQty ?? l.qty, unit: l.unit ?? undefined, spec: "Stackable, grey", procurementLineId: l.id })) });
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
  say(`a store handover of ${set.name} waits on Property Administration`);

  // ── A booking request for Ali's lab ──
  await post(KEBEDE, "/scheduling/bookings", { itemIds: [aliLab.id], date: dayAhead(3), start: "14:00", end: "16:00", title: "Operating systems practical", onBehalfOfNote: "3rd-year section 2", participantCount: 20 });
  say("a booking request waits on Ali");

  // ── A store's changes: decided by Property Administration ──
  const storeTable = await db.item.findFirstOrThrow({ where: { parentId: store.id, deletedAt: null, category: { key: "table" } }, orderBy: { name: "desc" } });
  await post(KEEPER, "/resources/items/changes", { kind: "setStatus", itemIds: [storeTable.id], value: "BROKEN", note: "A leg cracked when it was unloaded" });
  await post(KEEPER, `/resources/labs/${store.id}/versions/draft/submit`);
  say(`${store.name}'s changes wait on Property Administration`);

  // ── Calibration: instruments in a ChemE lab, in every status ──
  const today = new Date().toISOString().slice(0, 10);
  const lastFor = (cycleMonths: number, dueInDays: number) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dueInDays);
    d.setUTCMonth(d.getUTCMonth() - cycleMonths);
    return d.toISOString().slice(0, 10);
  };
  const instruments: Array<[string, string, Record<string, unknown>, number | null]> = [
    ["analytical-balance", "Analytical balance AB-01", { manufacturer: "Sartorius", model: "Entris II", capacityG: 220, readabilityMg: 0.1 }, 150],
    ["analytical-balance", "Analytical balance AB-02", { manufacturer: "Ohaus", model: "Pioneer PX224", capacityG: 220, readabilityMg: 0.1 }, 9],
    ["ph-meter", "pH meter PH-01", { manufacturer: "Hanna Instruments", model: "HI5221" }, -62],
    ["ph-meter", "Conductivity meter CM-01", { manufacturer: "Mettler Toledo", model: "SevenCompact S230" }, null],
    ["drying-oven", "Drying oven DO-01", { manufacturer: "Memmert", model: "UN110", maxTempC: 300, volumeL: 108 }, 21],
  ];
  let calibrated = "";
  for (const [key, name, props, dueInDays] of instruments) {
    const cat = await db.resourceCategory.findUniqueOrThrow({ where: { key } });
    const made = await post(ADMIN, "/resources/items/changes", { kind: "createItem", parentId: hannaLab.id, categoryId: cat.id, count: 1, name, props: { ...props, ...(dueInDays === null ? {} : { lastCalibrated: lastFor(cat.calibrationCycleMonths ?? 12, dueInDays) }) } });
    if (name === "pH meter PH-01") calibrated = made.itemIds[0];
  }
  say(`${hannaLab.name} holds instruments in every calibration status`);

  // ── Outside requests ──
  const who = { organizationName: "Addis Data Institute", contactName: "Ms. Requester", contactEmail: "outside.requester@example.org", contactPhone: "+251911000777" };
  const twoLabs = [{ placeCategoryId: labKind, count: 2, needs: [{ categoryId: setupKind, qty: 21 }, { categoryId: whiteboard, qty: 1 }] }];
  const requester = await requesterAccount("outside.requester@example.org", "Addis Data Institute");
  // Built from the Training offer, for 40 people: two labs of 20, a whiteboard in each.
  const fresh = await submitExternal(requester, {
    kind: "FACILITY",
    ...who,
    purpose: "A two-day data science training for 40 government employees.",
    windows: [{ date: dayAhead(20), start: "09:00", end: "12:00" }],
    lines: [],
    offerKey: "TRAINING",
    peopleCount: 40,
    setups: [{ placeCategoryId: labKind, count: 2, needs: [{ categoryId: setupKind, qty: 20 }, { categoryId: whiteboard, qty: 1 }] }],
  });
  say(`${fresh.reference} is new on the AVP's desk`);

  const coeec = await node("COEEC");
  /** AVP → CoEEC → CSE: the request reaches the head. */
  const toTheHead = async (id: string) => {
    await post(AVP, `/external-requests/${id}/forward`, { orgNodeIds: [coeec.id], note: "Please check capacity" });
    const college = (await get(DEAN, `/external-requests/${id}`)).assignments.find((a: any) => a.level === "COLLEGE");
    const dto = await post(DEAN, `/external-requests/assignments/${college.id}/forward`, { orgNodeIds: [cse.id] });
    return { college: college.id as string, dept: dto.assignments.find((a: any) => a.orgNodeId === cse.id).id as string };
  };
  const holdOf = (dto: any, labId: string) => dto.holds.find((h: any) => h.labItemId === labId && h.state === "REQUESTED");

  // One answered by the college, ready to quote: Ali's lab holds it, and Ali is the contact.
  await post(ALI, "/auth/phone", { phone: "+251 911 123 456" });
  const date = dayAhead(25);
  const answered = await submitExternal(requester, { kind: "FACILITY", ...who, purpose: "A one-day Python training for 20 analysts.", windows: [{ date, start: "09:00", end: "12:00" }], lines: [], setups: [{ placeCategoryId: labKind, count: 1, needs: [{ categoryId: setupKind, qty: 20 }] }] });
  const up = await toTheHead(answered.id);
  let dto = await post(HEAD, `/external-requests/assignments/${up.dept}/book`, { labIds: [aliLab.id] });
  await post(ALI, `/external-requests/holds/${holdOf(dto, aliLab.id).id}/answer`, { decision: "HOLD" });
  await post(HEAD, `/external-requests/assignments/${up.dept}/submit`, { sheetUrl: "https://docs.google.com/spreadsheets/d/cost-sheet", amountSantim: 1_250_000 });
  await post(DEAN, `/external-requests/assignments/${up.dept}/review`, { decision: "APPROVE" });
  await post(DEAN, `/external-requests/assignments/${up.college}/submit`, { note: "One department hosts it" });
  await post(AVP, `/external-requests/assignments/${up.college}/review`, { decision: "APPROVE" });
  say(`${answered.reference} is ready for the AVP to quote`);

  // One for the head to book places for (nothing asked yet)…
  const toBook = await submitExternal(requester, { kind: "FACILITY", ...who, purpose: "A weekend bootcamp on data visualisation for 40 trainees.", windows: [{ date: dayAhead(28), start: "09:00", end: "17:00" }], lines: [], setups: twoLabs });
  await toTheHead(toBook.id);
  say(`${toBook.reference} waits for the CSE head to book places`);

  // …and one being held: Biruk's lab fits and is held; Ali's falls one workstation short.
  const birukLab = await db.item.findFirstOrThrow({ where: { name: "Software Laboratory B508-R9", parentId: null, deletedAt: null } });
  // (A second requester from here: an account sends three requests a day.)
  const requester2 = await requesterAccount("training.office@example.org", "Oromia Statistics Agency");
  const who2 = { organizationName: "Oromia Statistics Agency", contactName: "Ms. Requester", contactEmail: "training.office@example.org", contactPhone: "+251911000777" };
  const holding = await submitExternal(requester2, { kind: "FACILITY", ...who2, purpose: "A three-day statistics course for 40 survey officers.", windows: [{ date: dayAhead(27), start: "09:00", end: "12:00" }], lines: [], setups: twoLabs });
  const hp = await toTheHead(holding.id);
  dto = await post(HEAD, `/external-requests/assignments/${hp.dept}/book`, { labIds: [aliLab.id, birukLab.id], note: "Mornings only" });
  await post(BIRUK, `/external-requests/holds/${holdOf(dto, birukLab.id).id}/answer`, { decision: "HOLD" });
  say(`${holding.reference}: one lab held, Ali's asked but short`);

  // A declined request its requester can edit and send again.
  const declined = await submitExternal(requester2, {
    kind: "FACILITY",
    ...who2,
    purpose: "A recruitment examination for 60 candidates.",
    windows: [{ date: dayAhead(9), start: "09:00", end: "12:00" }],
    lines: [],
    offerKey: "EXAM",
    peopleCount: 60,
    setups: [{ placeCategoryId: labKind, count: 3, needs: [{ categoryId: setupKind, qty: 20 }] }],
  });
  await post(AVP, `/external-requests/${declined.id}/decline`, { note: "That is the university's own examination week. Any week after it works: please choose other dates." });
  say(`${declined.reference} was declined: the requester can edit it and send it again`);

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
    extBook: toBook.id,
    extHold: holding.id,
    extDeclined: declined.id,
    procMoving,
    procArrived,
    calibrated,
    hannaLab: hannaLab.id,
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
