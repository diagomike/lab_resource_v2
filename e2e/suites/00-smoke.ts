import { get, check, ev, done } from "../lib";
async function main() {
  for (const a of ["admin", "headSe", "custSe", "student", "disabled"]) {
    await check("S0", `S0-me-${a}`, `session works for ${a}`, async () => {
      const r = await get(a, "/auth/me");
      return { ok: a === "disabled" ? r.status === 401 : r.status === 200, evidence: ev(r) };
    });
  }
  await done();
}
main();
