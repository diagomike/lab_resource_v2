#!/usr/bin/env node
/**
 * Takes the user guide's screenshots (docs/user-guide/img/) from the E2E clone on :3100,
 * after e2e/stage-guide.ts has left something waiting for every role. Light theme,
 * 1280×800, signed in per role through the sign-in page; personal email addresses (the
 * seeded ARAs' real ones) are masked before each shot.
 *
 *   node e2e/guide-shots.mjs                 every shot
 *   node e2e/guide-shots.mjs head approvers  only shots whose file path contains a word
 *
 * Playwright isn't a dependency of this app: the sister app's copy drives the installed Chrome.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium, request: pwRequest } = require(path.resolve("../sc_feedback_v2/node_modules/playwright-core"));

const BASE = "http://localhost:3100";
const OUT = "docs/user-guide/img";
const PASSWORD = "astu1234";
const S = JSON.parse(fs.readFileSync("e2e/.guide-state.json", "utf8"));

const WHO = {
  admin: "admin@astu.edu.et",
  head: "cse.head@astu.edu.et",
  dean: "coeec.dean@astu.edu.et",
  adaa: "adaa.coeec@astu.edu.et",
  avp: "avp@astu.edu.et",
  cmd: "cmd@astu.edu.et",
  prop: "property.admin@astu.edu.et",
  proc: "procurement@astu.edu.et",
  keeper: "store.keeper@astu.edu.et",
  ali: "alikibretmuhamed@gmail.com",
};

/** Waits for the page to settle: no "Loading…" text and no skeleton rows. */
async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page
    .waitForFunction(() => !/Loading/.test(document.body.innerText) && !document.querySelector(".animate-pulse"), null, { timeout: 15_000 })
    .catch(() => {});
  await page.waitForTimeout(400);
}

async function mask(page) {
  await page.evaluate(() => {
    const keep = /@(astu\.edu\.et|example\.org)$/i;
    const re = /\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;
    const fix = (s) => s.replace(re, (m, first, domain) => (keep.test(m) ? m : `${first}•••@${domain}`));
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (re.test(n.nodeValue)) n.nodeValue = fix(n.nodeValue);
    for (const el of document.querySelectorAll("input, textarea")) if (re.test(el.value)) el.value = fix(el.value);
  });
}

const SHOTS = [
  // ── Getting started ──
  { file: "getting-started/01-sign-in.jpg", as: null, url: "/login" },
  {
    file: "getting-started/02-accept-invite.jpg",
    as: null,
    prepare: async (ctx) => {
      const admin = await apiAs(ctx, WHO.admin);
      const r = await admin.post(`${BASE}/api/people`, { data: { name: "Meron Tadesse", email: `meron.tadesse.${Date.now().toString(36)}@example.org`, roles: ["CUSTODIAN"], homeNodeId: await nodeIdOf(admin, "CSE") } });
      const body = await r.json();
      return new URL(body.inviteUrl).pathname + new URL(body.inviteUrl).search;
    },
  },
  {
    file: "getting-started/05-reset-password.jpg",
    as: null,
    prepare: async (ctx) => {
      const before = mailCount();
      await (await pwRequest.newContext()).post(`${BASE}/api/auth/forgot-password`, { data: { email: WHO.head } });
      const token = await waitForMail(before, WHO.head, /reset-password\?token=([\w-]+)/);
      return `/reset-password?token=${token}`;
    },
  },
  { file: "getting-started/07-home.jpg", as: "head", url: "/home" },
  { file: "getting-started/08-bell.jpg", as: "head", url: "/home", act: (p) => p.getByRole("button", { name: /^Updates/ }).click() },
  { file: "getting-started/09-account-menu.jpg", as: "head", url: "/home", act: (p) => p.getByRole("button", { name: "Your account" }).click() },

  // ── Custodian (Ali) ──
  { file: "custodian/01-home.jpg", as: "ali", url: "/home" },
  { file: "custodian/02-my-labs.jpg", as: "ali", url: "/places" },
  { file: "custodian/03-lab-page.jpg", as: "ali", url: () => `/places/${S.aliLab}` },
  { file: "custodian/04-resources.jpg", as: "ali", url: "/register" },
  {
    file: "custodian/05-change.jpg",
    as: "ali",
    url: () => `/register?item=${S.aliMonitor}`,
    act: async (p) => {
      await p.getByRole("button", { name: "Change this…" }).click();
      await p.getByRole("dialog", { name: /^Change/ }).getByRole("combobox").first().selectOption({ label: "Broken" });
    },
  },
  { file: "custodian/06-my-changes.jpg", as: "ali", url: () => `/places/${S.aliLab}?tab=draft` },
  { file: "custodian/07-ask.jpg", as: "ali", url: "/purchasing?tab=needs" },
  { file: "custodian/08-bookings.jpg", as: "ali", url: "/schedule" },
  { file: "custodian/09-category.jpg", as: "ali", url: "/categories" , act: async (p) => { await p.getByText("Computer", { exact: true }).first().click(); } },

  // ── Head ──
  { file: "head/01-home.jpg", as: "head", url: "/home" },
  { file: "head/02-lab-changes.jpg", as: "head", url: "/approvals?kind=lab-commit" },
  { file: "head/03-labs.jpg", as: "head", url: "/places" },
  { file: "head/04-add-lab.jpg", as: "head", url: "/places", act: (p) => p.getByRole("button", { name: /Add a lab or store/ }).click() },
  { file: "head/05-needs.jpg", as: "head", url: "/purchasing?tab=needs" },
  {
    file: "head/06-build.jpg",
    as: "head",
    url: "/purchasing?tab=needs",
    act: async (p) => {
      for (const box of await p.getByRole("checkbox", { name: /^Choose/ }).all()) await box.check();
      await p.getByRole("button", { name: /Build a request from/ }).click();
    },
  },

  // ── ADAA ──
  { file: "adaa/01-home.jpg", as: "adaa", url: "/home" },
  { file: "adaa/02-labs.jpg", as: "adaa", url: "/places" },

  // ── Approvers ──
  { file: "approvers/00-avp-home.jpg", as: "avp", url: "/home" },
  { file: "approvers/01-purchase-card.jpg", as: "dean", url: () => `/approvals?focus=purchase:${S.prDean}` },
  { file: "approvers/02-send-back.jpg", as: "dean", url: () => `/approvals?focus=purchase:${S.prDean}`, act: (p) => p.getByRole("button", { name: "Send back for revision" }).click() },
  { file: "approvers/03-transfer-details.jpg", as: "cmd", url: () => `/approvals?focus=transfer:${S.perm}` },
  { file: "approvers/05-procurement-approve.jpg", as: "proc", url: () => `/approvals?focus=purchase:${S.prProc}`, act: (p) => p.getByRole("button", { name: "Approve", exact: true }).first().click() },
  { file: "approvers/06-external-request.jpg", as: "avp", url: () => `/external-requests?focus=${S.extNew}` },
  { file: "approvers/08-send-quote.jpg", as: "avp", url: () => `/external-requests?focus=${S.extQuote}`, act: (p) => p.getByRole("button", { name: "Send quote…" }).click() },

  // ── Procurement ──
  { file: "procurement/01-pipeline.jpg", as: "proc", url: "/purchasing?tab=pipeline" },
  // Advance acts at once, so the shot shows the note typed in, not the click.
  { file: "procurement/02-advance.jpg", as: "proc", url: "/purchasing?tab=pipeline", act: (p) => p.getByPlaceholder("Optional note").first().fill("Abyssinia Tech won the tender") },

  // ── Store keeper ──
  { file: "store-keeper/01-load.jpg", as: "keeper", url: () => `/purchasing?tab=arrivals&import=${S.imp}` },
  { file: "store-keeper/02-move.jpg", as: "keeper", url: () => `/register?item=${S.storeItem2}`, act: async (p) => {
    await p.getByRole("button", { name: "Move to another place…" }).first().click();
    await p.getByPlaceholder(/Search the lab/).fill("B510-R8");
    await p.getByRole("dialog", { name: /^Move/ }).getByRole("button", { name: /Software Laboratory B510-R8/ }).first().click();
  } },

  // ── System admin ──
  { file: "admin/01-home.jpg", as: "admin", url: "/home" },
  { file: "admin/02-organisation.jpg", as: "admin", url: "/admin/org-structure" },
  { file: "admin/03-people.jpg", as: "admin", url: "/admin/people" },
  { file: "admin/04-category.jpg", as: "admin", url: "/categories", act: async (p) => { await p.getByText("Computer", { exact: true }).first().click(); } },

  // ── Property Administration ──
  { file: "property-admin/01-arrivals.jpg", as: "prop", url: () => `/purchasing?tab=arrivals&request=${S.prArrived}` },
  { file: "property-admin/02-approve-movement.jpg", as: "prop", url: () => `/approvals?focus=transfer:${S.handover}` },

  // ── Portal ──
  { file: "portal/01-portal.jpg", as: null, url: "/portal" },
];

// ── helpers ──

function mailCount() {
  const f = "e2e/mail/index.jsonl";
  return fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean).length : 0;
}
async function waitForMail(after, to, re) {
  for (let i = 0; i < 40; i++) {
    const lines = fs.readFileSync("e2e/mail/index.jsonl", "utf8").trim().split("\n").filter(Boolean).slice(after).map((l) => JSON.parse(l));
    const hit = lines.reverse().find((m) => m.to.some((t) => t.toLowerCase().includes(to)));
    if (hit) {
      const eml = fs.readFileSync(`e2e/mail/${hit.n}.eml`, "utf8");
      const qp = eml.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
      const b64 = [...eml.matchAll(/\r?\n\r?\n([A-Za-z0-9+/=\r\n]{40,})/g)].map((m) => Buffer.from(m[1].replace(/\s/g, ""), "base64").toString("utf8")).join("\n");
      const m = `${qp}\n${b64}`.match(re);
      if (m) return m[1];
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no mail to ${to} matching ${re}`);
}
/** An API client signed in as someone — its own cookie jar, apart from the page's. */
async function apiAs(_ctx, email) {
  const api = await pwRequest.newContext();
  const res = await api.post(`${BASE}/api/auth/login`, { data: { email, password: PASSWORD } });
  if (!res.ok()) throw new Error(`login ${email} → ${res.status()}`);
  return api;
}
async function nodeIdOf(request, code) {
  const r = await request.get(`${BASE}/api/org/nodes`);
  const list = await r.json();
  const flat = Array.isArray(list) ? list : list.nodes ?? [];
  return flat.find((n) => n.code === code)?.id;
}

async function signIn(page, email) {
  await page.goto(`${BASE}/login`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('input[type="password"]').press("Enter");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 });
}

const filters = process.argv.slice(2);
const browser = await chromium.launch({ channel: "chrome" });
const contexts = new Map();
async function contextFor(role) {
  if (contexts.has(role)) return contexts.get(role);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("sc-theme", "light");
    } catch {}
  });
  if (role) {
    const page = await ctx.newPage();
    await signIn(page, WHO[role]);
    await page.close();
  }
  contexts.set(role, ctx);
  return ctx;
}

let ok = 0;
const failed = [];
for (const shot of SHOTS) {
  if (filters.length && !filters.some((f) => shot.file.includes(f))) continue;
  try {
    const ctx = shot.as ? await contextFor(shot.as) : await browser.newContext({ viewport: { width: 1280, height: 800 } });
    if (!shot.as) await ctx.addInitScript(() => { try { localStorage.setItem("sc-theme", "light"); } catch {} });
    const url = shot.prepare ? await shot.prepare(ctx) : typeof shot.url === "function" ? shot.url() : shot.url;
    const page = await ctx.newPage();
    await page.goto(`${BASE}${url}`);
    await settle(page);
    if (shot.act) {
      await shot.act(page);
      await settle(page);
    }
    await mask(page);
    fs.mkdirSync(path.dirname(path.join(OUT, shot.file)), { recursive: true });
    await page.screenshot({ path: path.join(OUT, shot.file), type: "jpeg", quality: 85 });
    await page.close();
    if (!shot.as) await ctx.close();
    ok++;
    console.log(`✓ ${shot.file}`);
  } catch (e) {
    failed.push(shot.file);
    console.log(`✘ ${shot.file}: ${e.message.split("\n")[0]}`);
  }
}
await browser.close();
console.log(`\n${ok} taken${failed.length ? `, ${failed.length} failed: ${failed.join(", ")}` : ""}`);
if (failed.length) process.exitCode = 1;
