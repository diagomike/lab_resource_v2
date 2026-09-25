/** Suite A — auth & sessions (API-level; password flows are in e2e/auth-check.ts). */
import { api, get, post, page, check, ev, db, done, mintAs, mailSeq, mailsSince, uniq, S } from "../lib";
import { hashToken, generateToken } from "../../lib/server/auth/token";

const A = "A";

async function main() {
  await check(A, "A-01", "no cookie → 401 on /auth/me", async () => {
    const r = await get(null, "/auth/me");
    return { ok: r.status === 401, evidence: ev(r) };
  });

  await check(A, "A-02", "forged cookie → 401", async () => {
    const r = await api(null, "GET", "/auth/me", undefined, { cookie: "lrms_session=not-a-real-token" });
    return { ok: r.status === 401, evidence: ev(r) };
  });

  await check(A, "A-03", "expired session → 401", async () => {
    const u = await db.user.findUniqueOrThrow({ where: { emailLower: "staff.se@e2e.test" } });
    const token = generateToken();
    await db.session.create({ data: { userId: u.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() - 1000) } });
    const r = await api(null, "GET", "/auth/me", undefined, { cookie: `lrms_session=${token}` });
    return { ok: r.status === 401, evidence: ev(r) };
  });

  await check(A, "A-04", "disabled account's live session refused on next request", async () => {
    const r = await get("disabled", "/auth/me");
    return { ok: r.status === 401, evidence: ev(r) };
  });

  await check(A, "A-05", "logout deletes the session server-side", async () => {
    const u = await db.user.findUniqueOrThrow({ where: { emailLower: "staff.chem@e2e.test" } });
    await mintAs("tmpLogout", u.id);
    const out = await post("tmpLogout", "/auth/logout");
    const after = await get("tmpLogout", "/auth/me");
    return { ok: out.status < 300 && after.status === 401, evidence: { logout: out.status, meAfter: after.status } };
  });

  await check(A, "A-06", "proxy: protected page redirects to /login when signed out; /portal and /api are not redirected", async () => {
    const reg = await page(null, "/register");
    const portal = await page(null, "/portal");
    const apiRes = await get(null, "/resources/items");
    return {
      ok: reg.status >= 300 && reg.status < 400 && /login/.test(reg.location ?? "") && portal.status === 200 && apiRes.status === 401,
      evidence: { register: reg, portal: portal.status, api: apiRes.status },
    };
  });

  await check(A, "A-07", "a signed-in student cannot reach admin API routes", async () => {
    const r1 = await get("student", "/people");
    const r2 = await post("student", "/org/nodes", { name: "x", level: 1, kind: "COLLEGE", parentIds: [] });
    return { ok: r1.status === 403 && r2.status === 403, evidence: { people: ev(r1), createNode: ev(r2) } };
  });

  await check(A, "A-08", "org chart (names, occupants, emails) readable by any signed-in account, incl. student", async () => {
    const r = await get("student", "/org/nodes?scope=all");
    const withEmail = Array.isArray(r.body) ? r.body.filter((n: any) => n.occupant?.email).map((n: any) => `${n.name} → ${n.occupant.email}`) : [];
    // Recorded as a finding if a student can enumerate every office holder's email.
    return { ok: !(r.status === 200 && withEmail.length > 0), evidence: { status: r.status, occupantEmailsVisibleToStudent: withEmail } };
  });

  await check(A, "A-09", "custodian directory (/people/custodians) exposes university-wide emails to a custodian", async () => {
    const r = await get("custSe", "/people/custodians");
    const foreign = Array.isArray(r.body) ? r.body.filter((p: any) => p.homeNodeName && p.homeNodeName !== "Software Engineering").map((p: any) => `${p.name} <${p.email}> (${p.homeNodeName})`) : [];
    return { ok: true, evidence: { status: r.status, total: Array.isArray(r.body) ? r.body.length : null, foreignSample: foreign.slice(0, 5) } };
  });

  await check(A, "A-10", "H2 — forgot-password mails a reset link to an INVITED (never registered) account", async () => {
    const email = `${uniq("invited")}@e2e.test`;
    const inv = await post("admin", "/people", { name: "Invited Only", email, roles: ["STAFF"] });
    const seq = mailSeq();
    const fp = await post(null, "/auth/forgot-password", { email });
    await new Promise((r) => setTimeout(r, 800));
    const mails = mailsSince(seq).filter((m) => m.to.join(",").includes(email) && /reset/i.test(m.subject));
    const resets = await db.passwordReset.count({ where: { user: { emailLower: email } } });
    return {
      ok: mails.length === 0 && resets === 0,
      evidence: { invite: inv.status, forgot: fp.status, resetRows: resets, resetMails: mails.map((m) => m.subject) },
      hypothesis: "H2",
    };
  });

  await check(A, "A-11", "forgot-password answers identically for unknown and known emails (no enumeration)", async () => {
    const a = await post(null, "/auth/forgot-password", { email: "nobody-here@e2e.test" });
    const b = await post(null, "/auth/forgot-password", { email: "staff.se@e2e.test" });
    return { ok: a.status === b.status && JSON.stringify(a.body) === JSON.stringify(b.body), evidence: { unknown: ev(a), known: ev(b) } };
  });

  await check(A, "A-12", "forgot-password has no per-email/IP throttle (20 requests in a row)", async () => {
    const before = await db.passwordReset.count({ where: { user: { emailLower: "staff.chem@e2e.test" } } });
    const statuses: number[] = [];
    for (let i = 0; i < 20; i++) statuses.push((await post(null, "/auth/forgot-password", { email: "staff.chem@e2e.test" })).status);
    const after = await db.passwordReset.count({ where: { user: { emailLower: "staff.chem@e2e.test" } } });
    // F-010 fix: the answer stays 201 either way (no enumeration oracle), but only 3 resets per hour actually go out.
    return { ok: after - before <= 3 && statuses.every((s) => s === 201), evidence: { statuses: [...new Set(statuses)], resetRowsCreated: after - before } };
  });

  void S;
  await done();
}

main();
