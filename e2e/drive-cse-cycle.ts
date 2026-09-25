/**
 * Drives the CSE end-to-end cycle (Phase D of the 2026-09-22 fix round) through the app's
 * own HTTP API on :3100 — never by writing the database. Sessions are minted (the driver
 * never submits a password), one per person, on the E2E clone only.
 *
 *   node e2e/with-env.mjs npx tsx e2e/drive-cse-cycle.ts <step> [--skip-ali]
 *
 * Steps:
 *   ideals        each custodian proposes their lab's ideal (25 workstations, 25 outlets)
 *   approve-ideals the CSE head approves every pending ideal proposal
 *   purchasables  prints the department's purchasables (what the head will compile)
 *   compile       the CSE head compiles one purchase request from the purchasables
 *   chain         dean → AVP → College Managing Director (when the office exists) →
 *                 procurement approve it
 *   pipeline      procurement advances it to "arrived at the main store"
 *   receive       the store keeper receives every line into the Main Store (partially first)
 *   handover      the store keeper hands each lab its share
 *   accept        the CSE head approves each handover; each custodian accepts
 *   report        per-lab Ideal · Current · Gap and attention counts
 */
import { PrismaClient } from "@prisma/client";
import { generateToken, hashToken } from "../lib/server/auth/token";

/** `--dev`: the dev database lrms_v2 through the app on :3000. Start that server with
 *  the "dev-nomail" launch config, so no step emails the real ARAs. */
const dev = process.argv.includes("--dev");
if (!dev && !process.env.DATABASE_URL?.includes("lrms_v2_e2e")) throw new Error("drive-cse-cycle.ts runs against lrms_v2_e2e (or lrms_v2 with --dev)");
const db = new PrismaClient();
const BASE = dev ? "http://localhost:3000/api" : "http://localhost:3100/api";
const skipAli = process.argv.includes("--skip-ali");
/** `--only B510-R8` limits a step to labs whose name contains the text. */
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
/** `--what workstations,outlets` limits handover to those batches (re-issuing one that was rejected). */
const what = process.argv.includes("--what") ? process.argv[process.argv.indexOf("--what") + 1].split(",") : null;
const ALI = "alikibretmuhamed@gmail.com";

const tokens = new Map<string, string>();
async function as(email: string): Promise<string> {
  const hit = tokens.get(email);
  if (hit) return hit;
  const user = await db.user.findUniqueOrThrow({ where: { emailLower: email.toLowerCase() } });
  const token = generateToken();
  await db.session.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 86_400_000), userAgent: "cse-cycle-driver" } });
  tokens.set(email, token);
  return token;
}

async function call<T = any>(email: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { cookie: `lrms_session=${await as(email)}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} as ${email} → ${res.status}: ${json?.message ?? text}`);
  return json as T;
}
const get = <T = any>(e: string, p: string) => call<T>(e, "GET", p);
const post = <T = any>(e: string, p: string, b: unknown = {}) => call<T>(e, "POST", p, b);

const HEAD = "cse.head@astu.edu.et";
const DEAN = "coeec.dean@astu.edu.et";
const AVP = "avp@astu.edu.et";
const CMD = "cmd@astu.edu.et";
const PROC = "procurement@astu.edu.et";
const KEEPER = "store.keeper@astu.edu.et";

async function cseLabs() {
  const cse = await db.orgNode.findUniqueOrThrow({ where: { code: "CSE" } });
  const labs = await db.item.findMany({ where: { ownerOrgNodeId: cse.id, parentId: null, deletedAt: null }, include: { custodian: { select: { email: true } } }, orderBy: { name: "asc" } });
  return { cse, labs: labs.filter((l) => (!skipAli || l.custodian.email !== ALI) && (!only || l.name.includes(only))) };
}
const catId = async (key: string) => (await db.resourceCategory.findUniqueOrThrow({ where: { key } })).id;

async function ideals() {
  const { labs } = await cseLabs();
  const [setup, outlet] = await Promise.all([catId("setup"), catId("outlet")]);
  for (const lab of labs) {
    const who = lab.custodian.email;
    const ws = await db.item.count({ where: { parentId: lab.id, categoryId: setup, deletedAt: null } });
    const rack = await db.item.findFirstOrThrow({ where: { parentId: lab.id, name: "Switch Rack", deletedAt: null } });
    const outlets = await db.item.count({ where: { parentId: rack.id, categoryId: outlet, deletedAt: null } });
    await post(who, `/resources/labs/${lab.id}/versions/ideal/start`);
    if (ws < 25) await post(who, `/resources/labs/${lab.id}/versions/ideal/ops`, { kind: "createItem", parentId: lab.id, categoryId: setup, count: 25 - ws, name: "Workstation" });
    if (outlets < 25) await post(who, `/resources/labs/${lab.id}/versions/ideal/ops`, { kind: "createItem", parentId: rack.id, categoryId: outlet, count: 25 - outlets, name: "Network Outlet" });
    const req = await post(who, `/resources/labs/${lab.id}/versions/ideal/submit`);
    console.log(`  ${lab.name}: +${25 - ws} workstations, +${25 - outlets} outlets → ${req.status}`);
  }
}

async function approveIdeals() {
  const inbox = await get<any[]>(HEAD, "/resources/lab-commits?box=inbox");
  for (const r of inbox.filter((x) => x.targetKind === "IDEAL" && (!skipAli || !x.labName.match(/B510-R(8|9)$/)))) {
    const d = await post(HEAD, `/resources/lab-commits/${r.id}/decide`, { decision: "APPROVE", note: "Ideal capacity agreed: 25 workstations." });
    console.log(`  ${r.labName}: ${d.status}`);
  }
}

async function purchasables() {
  const { cse } = await cseLabs();
  const p = await get(HEAD, `/resources/departments/${cse.id}/purchasables`);
  console.log(`  ${p.orgNodeName}: ${p.labCount} labs with an approved ideal`);
  for (const r of p.rows) console.log(`    ${r.categoryName.padEnd(20)} ideal ${String(r.idealQty).padStart(4)} current ${String(r.actualCount).padStart(4)} gap ${String(r.gap).padStart(4)} broken ${String(r.brokenCount).padStart(4)}`);
  return p;
}

/** The request the head compiles: whole workstations and outlets for the gap, plus the
 *  parts and chairs to repair what is broken (chosen from the purchasables view). */
async function compile() {
  const { cse } = await cseLabs();
  const p = await purchasables();
  const row = (name: string) => p.rows.find((r: any) => r.categoryName === name);
  const lines = [
    { name: "Workstation Setup", qty: row("Workstation Setup").gap, unit: "Set", categoryId: row("Workstation Setup").categoryId, estimatedUnitCost: 65000, justification: "Complete workstations (PC, monitor, peripherals, table, chair) to bring every CSE lab to its approved ideal of 25." },
    { name: "Network Outlet", qty: row("Network Outlet").gap, unit: "pcs", categoryId: row("Network Outlet").categoryId, estimatedUnitCost: 900, justification: "Outlets for the five new workstations per lab (rooms were wired for 20)." },
    { name: "RAM", qty: row("RAM").brokenCount, unit: "pcs", categoryId: row("RAM").categoryId, estimatedUnitCost: 3500, justification: "Replace failed memory in broken lab PCs." },
    { name: "Storage", qty: row("Storage").brokenCount, unit: "pcs", categoryId: row("Storage").categoryId, estimatedUnitCost: 4500, justification: "Replace failed drives in broken lab PCs." },
    { name: "Monitor", qty: row("Monitor").brokenCount, unit: "pcs", categoryId: row("Monitor").categoryId, estimatedUnitCost: 12000, justification: "Replace failed monitors in broken lab PCs." },
    { name: "Chair", qty: row("Chair").brokenCount, unit: "pcs", categoryId: row("Chair").categoryId, estimatedUnitCost: 2500, justification: "Replace broken workstation chairs." },
  ].filter((l) => l.qty > 0);
  const pr = await post(HEAD, "/resources/purchase-requests", { title: "CSE labs — bring every lab to its approved ideal and repair broken PCs and chairs", orgNodeId: cse.id, lines });
  console.log(`  compiled ${pr.reference} (${pr.stage}): ${pr.lines.map((l: any) => `${l.name}×${l.qty}`).join(", ")}`);
  console.log(`  chain: ${pr.steps.map((s: any) => `${s.label}:${s.status}`).join(" → ")}`);
}

async function latestRequest() {
  const cse = await db.orgNode.findUniqueOrThrow({ where: { code: "CSE" } });
  return db.purchaseRequest.findFirstOrThrow({ where: { orgNodeId: cse.id }, orderBy: { createdAt: "desc" }, include: { lines: true, steps: true } });
}

async function chain() {
  const pr = await latestRequest();
  for (const [who, note] of [
    [DEAN, "Justified by the labs' approved ideals and broken-equipment counts."],
    [AVP, "Approved for this budget year."],
    [PROC, "Approved — order will be placed on EGP."],
  ] as const) {
    const r = await post(who, `/resources/purchase-requests/${pr.id}/decide`, { decision: "APPROVE", note });
    console.log(`  ${who}: stage ${r.stage}`);
  }
}

async function pipeline() {
  const pr = await latestRequest();
  for (const note of ["Buyer found on EGP (tender CSE-2026-09).", "Dispatched by the supplier.", "Delivered to the ASTU Main Store."]) {
    const r = await post(PROC, `/resources/purchase-requests/${pr.id}/advance`, { note });
    console.log(`  → ${r.stage}`);
  }
}

async function receive() {
  const pr = await latestRequest();
  const store = await db.item.findFirstOrThrow({ where: { name: "ASTU Main Store", parentId: null, deletedAt: null } });
  for (const line of pr.lines) {
    const total = Number(line.qty);
    // A partial receipt first, then the rest — the line stays open in between.
    const first = Math.max(1, Math.floor(total / 2));
    let r = await post(KEEPER, `/resources/purchase-requests/${pr.id}/receive`, { lineId: line.id, qty: first, categoryId: line.categoryId, storeParentId: store.id });
    if (total - first > 0) r = await post(KEEPER, `/resources/purchase-requests/${pr.id}/receive`, { lineId: line.id, qty: total - first, categoryId: line.categoryId, storeParentId: store.id });
    console.log(`  ${line.name}: received ${total} → request ${r.stage ?? r.request?.stage ?? "ok"}`);
  }
  const after = await latestRequest();
  console.log(`  request stage: ${(await db.purchaseRequest.findUniqueOrThrow({ where: { id: after.id } })).stage}`);
}

/** Each lab's share of what arrived: its missing workstations and outlets, and parts
 *  and chairs for what is broken in it. Workstations and parts go into the lab, outlets
 *  into its switch rack. */
async function handover() {
  const { cse, labs } = await cseLabs();
  const store = await db.item.findFirstOrThrow({ where: { name: "ASTU Main Store", parentId: null, deletedAt: null } });
  const key = async (k: string) => catId(k);
  const [setup, outlet, ram, storage, monitor, chair] = await Promise.all(["setup", "outlet", "ram", "storage", "monitor", "chair"].map(key));
  // Items already promised to a lab by a pending handover stay in the store until it is
  // accepted — never offer them twice.
  const promised = new Set(
    (await db.changeRequest.findMany({ where: { status: "PENDING" }, select: { baseVersions: true } })).flatMap((r) => Object.keys((r.baseVersions ?? {}) as object)),
  );
  const inStore = async (categoryId: string) =>
    (await db.item.findMany({ where: { parentId: store.id, categoryId, deletedAt: null }, orderBy: { name: "asc" }, select: { id: true } })).filter((i) => !promised.has(i.id));
  const pool: Record<string, string[]> = {};
  for (const [k, c] of Object.entries({ setup, outlet, ram, storage, monitor, chair })) pool[k] = (await inStore(c)).map((i) => i.id);

  for (const lab of labs) {
    const s = await get(HEAD, `/resources/labs/${lab.id}/states`);
    const stat = (id: string) => s.idealStats.find((r: any) => r.categoryId === id);
    const brokenOf = async (categoryId: string) => {
      const iva = await get<any[]>(HEAD, `/resources/labs/${lab.id}/ideal-vs-actual`);
      return iva.find((r) => r.categoryId === categoryId)?.brokenItems.filter((b: any) => b.status === "BROKEN").length ?? 0;
    };
    const take = (k: string, n: number) => pool[k].splice(0, Math.max(0, n));
    const rack = await db.item.findFirstOrThrow({ where: { parentId: lab.id, name: "Switch Rack", deletedAt: null } });
    const batches: Array<[string, string[], string]> = [
      ["workstations", take("setup", stat(setup)?.gap ?? 0), lab.id],
      ["outlets", take("outlet", stat(outlet)?.gap ?? 0), rack.id],
      ["RAM", take("ram", await brokenOf(ram)), lab.id],
      ["storage", take("storage", await brokenOf(storage)), lab.id],
      ["monitors", take("monitor", await brokenOf(monitor)), lab.id],
      ["chairs", take("chair", await brokenOf(chair)), lab.id],
    ];
    const parts: string[] = [];
    for (const [label, itemIds, target] of batches) {
      if (!itemIds.length || (what && !what.includes(label))) continue;
      const r = await post(KEEPER, "/resources/transfers", {
        input: { kind: "transferItem", itemIds, transfer: { targetParentId: target, targetOrgNodeId: cse.id, targetCustodianId: lab.custodianId, transferOwnership: true } },
      });
      parts.push(`${itemIds.length} ${label} (${r.outcome})`);
    }
    console.log(`  ${lab.name}: ${parts.join(", ") || "nothing needed"}`);
  }
  console.log(`  left in store: ${Object.entries(pool).map(([k, v]) => `${k} ${v.length}`).join(", ")}`);
}

async function accept() {
  for (let round = 0; round < 3; round++) {
    const people = [HEAD, ...(await cseLabs()).labs.map((l) => l.custodian.email)];
    let decided = 0;
    for (const who of [...new Set(people)]) {
      const inbox = await get<any[]>(who, "/resources/transfers?box=inbox");
      for (const r of inbox) {
        await post(who, `/resources/transfers/${r.id}/decide`, { decision: "APPROVE", note: who === HEAD ? "Received into the lab's ideal." : "Accepted into my custody." });
        decided++;
      }
    }
    console.log(`  round ${round + 1}: ${decided} decisions`);
    if (!decided) break;
  }
  const pending = await db.changeRequest.count({ where: { status: "PENDING" } });
  console.log(`  transfers still pending: ${pending}`);
}

async function report() {
  const { labs } = await cseLabs();
  let open = 0;
  for (const lab of labs) {
    const s = await get(HEAD, `/resources/labs/${lab.id}/states`);
    const gaps = s.idealStats.filter((r: any) => r.gap > 0).map((r: any) => `${r.categoryName} ${r.gap}`);
    const attention = s.idealStats.filter((r: any) => r.needsAttention > 0).map((r: any) => `${r.categoryName} ${r.needsAttention}`);
    open += gaps.length;
    console.log(`  ${lab.name.padEnd(38)} gaps: ${gaps.join(", ") || "none"} | needs attention: ${attention.join(", ") || "none"}`);
  }
  console.log(`  labs with an open gap: ${open ? "some" : "none"}`);
}

const steps: Record<string, () => Promise<unknown>> = { ideals, "approve-ideals": approveIdeals, purchasables, compile, chain, pipeline, receive, handover, accept, report };
const step = process.argv[2];
if (!steps[step]) throw new Error(`step must be one of: ${Object.keys(steps).join(", ")}`);
console.log(`▶ ${step}${skipAli ? " (skipping Ali Kibret's labs — done in the browser)" : ""}${only ? ` (only ${only})` : ""}`);
steps[step]()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
