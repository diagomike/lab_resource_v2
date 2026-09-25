import { db, S } from "./lib";
async function main() {
  const u = await db.user.findUniqueOrThrow({ where: { emailLower: "staff.se@e2e.test" }, include: { roles: true, sessions: true } });
  console.log(JSON.stringify({ id: u.id, status: u.status, roles: u.roles.map(r=>r.kind), sessionCount: u.sessions.length, sessionTokenMatches: u.sessions.length }, null, 2));
  console.log("expected id from S.staffSe:", S.staffSe.id, "match:", S.staffSe.id === u.id);
  await db.$disconnect();
}
main();
