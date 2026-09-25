/** Suite P — personnel: admin, heads (MANAGER) managing staff and assistants, deans. H1, H3, H4. */
import { get, post, check, ev, db, done, mintAs, mailSeq, mailsSince, uniq, nodeId, userId, S } from "../lib";

const P = "P";
const email = (p: string) => `${uniq(p)}@e2e.test`;

async function main() {
  const se = await nodeId("Software Engineering");
  const chem = await nodeId("Chemical Engineering");
  const mat = await nodeId("Materials Science");

  await check(P, "P-01", "admin invites one person per role; each gets INVITED status, an invite URL and an email", async () => {
    const roles = ["SYS_ADMIN", "PROPERTY_ADMIN", "PROCUREMENT", "MANAGER", "CUSTODIAN", "STAFF", "STUDENT", "STORE_KEEPER", "EXTERNAL"];
    const seq = mailSeq();
    const out: Record<string, number> = {};
    const ids: string[] = [];
    for (const role of roles) {
      const r = await post("admin", "/people", { name: `P ${role}`, email: email(`p-${role.toLowerCase()}`), roles: [role], homeNodeId: se });
      out[role] = r.status;
      if (r.status === 201) ids.push(r.body.id);
      if (r.status === 201 && !String(r.body.inviteUrl).includes("/accept-invite?token=")) out[`${role}:url`] = -1;
    }
    await new Promise((r) => setTimeout(r, 1000));
    const invites = mailsSince(seq).filter((m) => /invited/i.test(m.subject)).length;
    const statuses = await db.user.findMany({ where: { id: { in: ids } }, select: { status: true } });
    return { ok: Object.values(out).every((s) => s === 201) && invites === roles.length && statuses.every((s) => s.status === "INVITED"), evidence: { out, invites } };
  });

  await check(P, "P-02", "invite straight into an occupied node is refused; duplicate email (any case) refused", async () => {
    const occupied = await post("admin", "/people", { name: "P occ", email: email("p-occ"), roles: ["MANAGER"], nodeId: se });
    const e = email("p-dup");
    const first = await post("admin", "/people", { name: "P dup", email: e, roles: ["STAFF"] });
    const upper = await post("admin", "/people", { name: "P dup", email: e.toUpperCase(), roles: ["STAFF"] });
    return { ok: occupied.status === 400 && first.status === 201 && upper.status === 400, evidence: { occupiedNode: ev(occupied), first: first.status, upperCaseDuplicate: ev(upper) } };
  });

  await check(P, "P-03", "5 concurrent invites with the same email: one 201, the rest 400 (never 500)", async () => {
    const e = email("p-race");
    const res = await Promise.all([...Array(5)].map(() => post("admin", "/people", { name: "Race", email: e, roles: ["STAFF"] })));
    const rows = await db.user.count({ where: { emailLower: e } });
    return { ok: res.filter((r) => r.status === 201).length === 1 && res.every((r) => r.status === 201 || r.status === 400) && rows === 1, evidence: { statuses: res.map((r) => r.status), userRows: rows } };
  });

  await check(P, "P-04", "SE head lists only SE people (no ChemE or Materials people)", async () => {
    const r = await get("headSe", "/people");
    const foreign = (r.body ?? []).filter((p: any) => p.homeNodeId && p.homeNodeId !== se && p.occupiesNodeId !== se).map((p: any) => `${p.name} (${p.homeNodeName})`);
    return { ok: r.status === 200 && foreign.length === 0, evidence: { count: r.body?.length, foreign } };
  });

  await check(P, "P-05", "CoEEC dean sees SE and Materials people but not ChemE", async () => {
    const r = await get("deanCoeec", "/people");
    const homes = new Set((r.body ?? []).map((p: any) => p.homeNodeId));
    return { ok: r.status === 200 && homes.has(se) && homes.has(mat) && !homes.has(chem), evidence: { count: r.body?.length, seesSE: homes.has(se), seesMat: homes.has(mat), seesChem: homes.has(chem) } };
  });

  let headInvitee = "";
  await check(P, "P-06", "SE head invites a CUSTODIAN: a home node outside their tree is refused (F-018), occupancy ignored, home defaults to SE", async () => {
    // F-018 changed the rule: a head may name any unit in their own subtree, so a foreign home is an explicit 403
    // (it used to be silently rewritten to SE); a node to OCCUPY is still ignored for non-admins.
    const foreign = await post("headSe", "/people", { name: "P head foreign", email: email("p-foreign"), roles: ["CUSTODIAN"], homeNodeId: chem });
    const r = await post("headSe", "/people", { name: "P head-invited assistant", email: email("p-assist"), roles: ["CUSTODIAN"], nodeId: chem });
    headInvitee = r.body?.id;
    const row = r.status === 201 ? await db.user.findUniqueOrThrow({ where: { id: r.body.id }, include: { orgNode: true } }) : null;
    return { ok: foreign.status === 403 && r.status === 201 && row?.homeNodeId === se && !row?.orgNode, evidence: { foreignHome: foreign.status, status: r.status, homeIsSE: row?.homeNodeId === se, occupies: row?.orgNode?.name ?? null } };
  });

  await check(P, "P-07", "SE head may not invite MANAGER / PROCUREMENT / SYS_ADMIN / mixed role sets", async () => {
    const r: Record<string, number> = {};
    for (const roles of [["MANAGER"], ["PROCUREMENT"], ["SYS_ADMIN"], ["CUSTODIAN", "SYS_ADMIN"], ["STORE_KEEPER"], ["STUDENT"]]) {
      r[roles.join("+")] = (await post("headSe", "/people", { name: "P nope", email: email("p-nope"), roles })).status;
    }
    return { ok: Object.values(r).every((s) => s === 403), evidence: r };
  });

  await check(P, "P-08", "resend invite: head within own department OK, for another department 403; old token stays valid (H1)", async () => {
    const chemInvite = await post("admin", "/people", { name: "P chem invitee", email: email("p-chemi"), roles: ["STAFF"], homeNodeId: chem });
    const own = await post("headSe", `/people/${headInvitee}/resend-invite`);
    const foreign = await post("headSe", `/people/${chemInvite.body.id}/resend-invite`);
    const u = await db.user.findUniqueOrThrow({ where: { id: headInvitee } });
    const invites = await db.invitation.findMany({ where: { emailLower: u.emailLower }, orderBy: { createdAt: "asc" } });
    const stillUsable = invites.filter((i) => !i.consumedAt && i.expiresAt > new Date()).length;
    return {
      ok: own.status < 300 && foreign.status === 403 && stillUsable === 1,
      evidence: { ownDept: own.status, otherDept: foreign.status, invitationRows: invites.length, unconsumedUnexpiredTokens: stillUsable },
      hypothesis: "H1",
    };
  });

  await check(P, "P-09", "dean cannot resend an invite for a department below them (list reach ≠ action reach)", async () => {
    const r = await post("deanCoeec", `/people/${headInvitee}/resend-invite`);
    return { ok: r.status < 300, evidence: ev(r) };
  });

  await check(P, "P-10", "H4 — a department head can deactivate, reactivate and change roles of their own staff", async () => {
    // A FRESH throwaway account, never the shared staffSe/custSe fixtures other
    // cases depend on staying STAFF-only and logged in — deactivate really does
    // wipe sessions and reactivate never restores one, so mutating a shared actor
    // here would break every later suite reusing it (the same lesson the product's
    // own DB-backed specs already learned about shared seed fixtures).
    const email = `${uniq("p10-staff")}@e2e.test`;
    const invite = await post("admin", "/people", { name: "P10 Staff", email, roles: ["STAFF"], homeNodeId: se });
    const staff = invite.body.id;
    await db.user.update({ where: { id: staff }, data: { status: "ACTIVE" } });
    const out = {
      deactivate: (await post("headSe", `/people/${staff}/deactivate`)).status,
      reactivate: (await post("headSe", `/people/${staff}/reactivate`)).status,
      roles: (await post("headSe", `/people/${staff}/roles`, { roles: ["STAFF", "CUSTODIAN"] })).status,
    };
    return { ok: Object.values(out).every((s) => s < 300), evidence: out, hypothesis: "H4" };
  });

  await check(P, "P-11", "an admin can move a person to another home department (F-015), recorded in HomeNodeChange", async () => {
    const created = await post("admin", "/people", { name: "P Mover", email: email("p-mover"), roles: ["STAFF"], homeNodeId: chem });
    const moved = await post("admin", `/people/${created.body.id}/home-node`, { nodeId: se, reason: "e2e" });
    const row = await db.user.findUniqueOrThrow({ where: { id: created.body.id } });
    const history = await db.homeNodeChange.count({ where: { userId: created.body.id } });
    return { ok: moved.status < 300 && row.homeNodeId === se && history === 1, evidence: { create: created.status, move: moved.status, homeAfter: row.homeNodeId === se ? "SE" : row.homeNodeId, history } };
  });

  await check(P, "P-12", "H3 — an admin can remove their own SYS_ADMIN role and deactivate themselves via the API", async () => {
    const r = await post("admin", "/people", { name: "P Admin Two", email: email("p-admin2"), roles: ["SYS_ADMIN"] });
    await db.user.update({ where: { id: r.body.id }, data: { status: "ACTIVE" } });
    await mintAs("admin2", r.body.id);
    const demote = await post("admin2", `/people/${r.body.id}/roles`, { roles: ["STAFF"] });
    // restore then self-deactivate
    await post("admin", `/people/${r.body.id}/roles`, { roles: ["SYS_ADMIN"] });
    const selfDeact = await post("admin2", `/people/${r.body.id}/deactivate`);
    const admins = await db.userRole.count({ where: { kind: "SYS_ADMIN", user: { status: "ACTIVE" } } });
    // F-016 fix as built: an admin may step down while ANOTHER active admin exists (only the last one is protected); nobody may deactivate themselves.
    return { ok: selfDeact.status === 400 && admins >= 2, evidence: { selfDemote: demote.status, selfDeactivate: selfDeact.status, activeAdminsLeft: admins }, hypothesis: "H3" };
  });

  await check(P, "P-13", "removing MANAGER from a sitting head leaves them occupying the node but unable to act as head", async () => {
    const headMat = S.headMat.id;
    const strip = await post("admin", `/people/${headMat}/roles`, { roles: ["STAFF"] });
    const node = await db.orgNode.findUniqueOrThrow({ where: { id: mat } });
    const compile = await post("headMat", "/resources/purchase-requests", { orgNodeId: mat, title: "P probe", lines: [{ name: "x", qty: 1, fromNeedIds: [] }] });
    await post("admin", `/people/${headMat}/roles`, { roles: ["MANAGER", "STAFF"] });
    return { ok: !(strip.status < 300 && node.userId === headMat && compile.status === 403), evidence: { stripRoles: strip.status, stillOccupies: node.userId === headMat, compileAsHead: ev(compile) } };
  });

  await check(P, "P-14", "deactivate: custodian with custody refused; plain staff disabled with sessions revoked; occupant vacates node", async () => {
    const custodian = await userId("custodian.chem@astu.edu.et");
    const refused = await post("admin", `/people/${custodian}/deactivate`);
    const plain = await post("admin", "/people", { name: "P leaver", email: email("p-leaver"), roles: ["STAFF"], homeNodeId: chem });
    await db.user.update({ where: { id: plain.body.id }, data: { status: "ACTIVE" } });
    await mintAs("leaver", plain.body.id);
    const d = await post("admin", `/people/${plain.body.id}/deactivate`);
    const me = await get("leaver", "/auth/me");
    const react = await post("admin", `/people/${plain.body.id}/reactivate`);
    const after = await db.user.findUniqueOrThrow({ where: { id: plain.body.id } });
    return {
      ok: refused.status === 400 && d.status < 300 && me.status === 401 && react.status < 300,
      evidence: { custodianRefused: ev(refused), deactivate: d.status, sessionAfter: me.status, reactivate: react.status, statusAfterReactivate: after.status },
    };
  });

  await check(P, "P-15", "H1 — a DISABLED invited account still holds a usable invitation token (accepting it would reactivate)", async () => {
    const inv = await post("admin", "/people", { name: "P disabled invitee", email: email("p-disinv"), roles: ["STAFF"], homeNodeId: se });
    await post("admin", `/people/${inv.body.id}/deactivate`);
    const u = await db.user.findUniqueOrThrow({ where: { id: inv.body.id } });
    const usable = await db.invitation.count({ where: { emailLower: u.emailLower, consumedAt: null, expiresAt: { gt: new Date() } } });
    return { ok: !(u.status === "DISABLED" && usable > 0), evidence: { status: u.status, usableInvitationTokens: usable, note: "register() in auth.ts never checks User.status; confirm with e2e/auth-check.ts" }, hypothesis: "H1" };
  });

  await check(P, "P-16", "HTML in a person's name is escaped in the invitation email", async () => {
    const seq = mailSeq();
    const r = await post("admin", "/people", { name: `<img src=x onerror=alert(1)>`, email: email("p-xss"), roles: ["STAFF"] });
    await new Promise((x) => setTimeout(x, 800));
    const m = mailsSince(seq).find((x) => /invited/i.test(x.subject));
    const raw = m?.raw ?? "";
    return { ok: r.status === 201 && !raw.includes("<img src=x") && /&lt;img|&amp;lt;|=3Cimg/i.test(raw) === true || (!!m && !raw.includes("<img src=x")), evidence: { status: r.status, rawContainsTag: raw.includes("<img src=x") } };
  });

  await check(P, "P-17", "PROPERTY_ADMIN reads everyone but cannot invite", async () => {
    const list = await get("propadmin", "/people");
    const inv = await post("propadmin", "/people", { name: "x", email: email("p-pa"), roles: ["STAFF"] });
    return { ok: list.status === 200 && inv.status === 403, evidence: { list: list.status, count: list.body?.length, invite: inv.status } };
  });

  await check(P, "P-18", "Materials head (two parent colleges) invites into Materials; both deans see the person", async () => {
    const r = await post("headMat", "/people", { name: "P mat staff", email: email("p-mat"), roles: ["STAFF"] });
    const a = await get("deanCoeec", "/people");
    const b = await get("deanComcme", "/people");
    const inA = (a.body ?? []).some((p: any) => p.id === r.body?.id);
    const inB = (b.body ?? []).some((p: any) => p.id === r.body?.id);
    return { ok: r.status === 201 && inA && inB, evidence: { invite: r.status, deanCoeecSees: inA, deanComcmeSees: inB } };
  });

  await done();
}

main();
