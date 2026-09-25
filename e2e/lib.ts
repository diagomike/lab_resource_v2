/**
 * Shared driver for the E2E campaign suites (docs/e2e-findings-2026-09-15.md).
 * Run a suite with: node e2e/with-env.mjs npx tsx e2e/suites/<file>.ts
 */
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";

if (!process.env.DATABASE_URL?.includes("lrms_v2_e2e")) throw new Error("E2E suites run against lrms_v2_e2e only");

export const db = new PrismaClient();
export const BASE = "http://localhost:3100";

type Session = { id: string; email: string; token: string };
export const S: Record<string, Session> = JSON.parse(fs.readFileSync("e2e/.sessions.json", "utf8"));

export interface Res<T = any> {
  status: number;
  body: T;
  ms: number;
}

/** Calls the app's API as a cast member (or anonymously with actor = null). */
export async function api<T = any>(actor: string | null, method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<Res<T>> {
  const headers: Record<string, string> = { ...extraHeaders };
  if (actor) headers.cookie = `lrms_session=${S[actor].token}`;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const t = Date.now();
  const res = await fetch(`${BASE}/api${path}`, { method, headers, body: payload, redirect: "manual" });
  const text = await res.text();
  let parsed: any = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, body: parsed, ms: Date.now() - t };
}

export const get = <T = any>(a: string | null, p: string) => api<T>(a, "GET", p);
export const post = <T = any>(a: string | null, p: string, b?: unknown) => api<T>(a, "POST", p, b ?? {});
export const patch = <T = any>(a: string | null, p: string, b?: unknown) => api<T>(a, "PATCH", p, b ?? {});
export const put = <T = any>(a: string | null, p: string, b?: unknown) => api<T>(a, "PUT", p, b ?? {});
export const del = <T = any>(a: string | null, p: string) => api<T>(a, "DELETE", p);

export type Result = "PASS" | "FAIL" | "BLOCKED" | "INFO";

interface CaseRecord {
  suite: string;
  id: string;
  title: string;
  result: Result;
  hypothesis?: string;
  evidence: unknown;
  at: string;
}

const RESULTS = "e2e/results.json";
function load(): CaseRecord[] {
  return fs.existsSync(RESULTS) ? JSON.parse(fs.readFileSync(RESULTS, "utf8")) : [];
}

/** Records a case outcome (replacing an earlier record with the same id). */
export function record(suite: string, id: string, title: string, result: Result, evidence: unknown, hypothesis?: string) {
  const all = load().filter((r) => r.id !== id);
  all.push({ suite, id, title, result, hypothesis, evidence, at: new Date().toISOString() });
  fs.writeFileSync(RESULTS, JSON.stringify(all, null, 2));
  const tag = result === "PASS" ? "✔" : result === "FAIL" ? "✘" : result === "BLOCKED" ? "■" : "ℹ";
  console.log(`${tag} ${id} ${title}${result === "PASS" ? "" : `\n    ${JSON.stringify(evidence).slice(0, 600)}`}`);
}

/** A case whose expectation is a predicate on the observed values. */
export async function check(suite: string, id: string, title: string, fn: () => Promise<{ ok: boolean; evidence: unknown; hypothesis?: string }>) {
  if (process.env.E2E_ONLY && !new RegExp(process.env.E2E_ONLY).test(id)) return false;
  try {
    const { ok, evidence, hypothesis } = await fn();
    record(suite, id, title, ok ? "PASS" : "FAIL", evidence, hypothesis);
    return ok;
  } catch (err) {
    record(suite, id, title, "BLOCKED", { error: (err as Error).message, stack: (err as Error).stack?.split("\n").slice(0, 3) });
    return false;
  }
}

/** Short evidence of a response. */
export function ev(r: Res, extra: Record<string, unknown> = {}) {
  const body = typeof r.body === "string" ? r.body.slice(0, 300) : r.body;
  return { status: r.status, body: trim(body), ...extra };
}
function trim(v: unknown): unknown {
  const s = JSON.stringify(v);
  if (s && s.length > 800) return JSON.parse(JSON.stringify(v, (_k, val) => (Array.isArray(val) && val.length > 5 ? [...val.slice(0, 5), `…${val.length - 5} more`] : val)));
  return v;
}

export async function nodeId(name: string) {
  return (await db.orgNode.findFirstOrThrow({ where: { name } })).id;
}
export async function userId(email: string) {
  return (await db.user.findUniqueOrThrow({ where: { emailLower: email.toLowerCase() } })).id;
}
export const uniq = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** Every mail the sink caught since a sequence number. */
export function mailsSince(n: number): { n: string; to: string[]; subject: string; raw: string }[] {
  const idx = "e2e/mail/index.jsonl";
  if (!fs.existsSync(idx)) return [];
  return fs
    .readFileSync(idx, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((m) => Number(m.n) > n)
    .map((m) => ({ ...m, raw: fs.readFileSync(`e2e/mail/${m.n}.eml`, "utf8") }));
}
export function mailSeq(): number {
  const idx = "e2e/mail/index.jsonl";
  if (!fs.existsSync(idx)) return 0;
  const lines = fs.readFileSync(idx, "utf8").trim().split("\n").filter(Boolean);
  return lines.length ? Number(JSON.parse(lines[lines.length - 1]).n) : 0;
}

/** Mints an extra session for any user (e.g. an account created mid-suite) and
 *  registers it under `key` for api(). */
export async function mintAs(key: string, userIdValue: string, expiresInMs = 86_400_000) {
  const { generateToken, hashToken } = await import("../lib/server/auth/token");
  const token = generateToken();
  const user = await db.user.findUniqueOrThrow({ where: { id: userIdValue } });
  await db.session.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + expiresInMs), userAgent: "e2e-campaign" } });
  S[key] = { id: user.id, email: user.email, token };
  return token;
}

/** Raw page request (no /api prefix), for proxy/redirect checks. */
export async function page(actor: string | null, path: string) {
  const headers: Record<string, string> = {};
  if (actor) headers.cookie = `lrms_session=${S[actor].token}`;
  const res = await fetch(`${BASE}${path}`, { headers, redirect: "manual" });
  return { status: res.status, location: res.headers.get("location") };
}

export async function done() {
  await db.$disconnect();
}
