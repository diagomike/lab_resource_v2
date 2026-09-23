/**
 * Seeds the org chart and the people who run it — a CLEAN SLATE (2026-09-22): the
 * administrator, the Chemical Engineering people, and one clearly named role account
 * per post the purchase and approval chains need. The 17 CSE lab custodians (ARAs) are
 * real people and are seeded with their labs by prisma/cse-lab-data.ts (run through
 * resource-seed.ts); rename any role account to the real person later from
 * People & roles.
 *
 *   ASTU (AVP)
 *   ├─ College of Electrical Engineering and Computing (CoEEC dean)
 *   │   ├─ Software Engineering (SE head — cross-department checks only)
 *   │   └─ Computer Science and Engineering (CSE head)
 *   ├─ College of Mechanical, Chemical and Materials Engineering
 *   │   └─ Chemical Engineering (head.chem)
 *   └─ Procurement Office, code PROC (procurement officer)
 *
 * Idempotent by wipe-and-rebuild: every run clears the tables it owns and regenerates
 * ids. That wipe (every User, UserRole, OrgNode, Session, ...) is exactly why this
 * refuses to run against production below. `prisma/bootstrap.ts` is the
 * production-safe equivalent (creates only the first SYS_ADMIN and the root).
 */
import { PrismaClient, type RoleKind } from "@prisma/client";
// @node-rs/argon2 — see lib/server/auth/auth.ts's own note on why, not the `argon2`
// package.
import * as argon2 from "@node-rs/argon2";
import { computeClosureRows } from "../lib/server/org/closure-algorithm";

if (process.env.NODE_ENV === "production") {
  console.error("prisma/seed.ts refuses to run with NODE_ENV=production — this wipes every User/OrgNode. Use prisma/bootstrap.ts instead.");
  process.exit(1);
}

const prisma = new PrismaClient();

const SEED_PASSWORD = "astu1234";
const UNIVERSITY_NAME = "Adama Science and Technology University";

async function main() {
  console.log("Seeding lab_resource_v2 (org chart + people, clean slate)…");

  await prisma.orgNodeAssignment.deleteMany({});
  await prisma.orgClosure.deleteMany({});
  await prisma.orgEdge.deleteMany({});
  await prisma.session.deleteMany({});
  await prisma.invitation.deleteMany({});
  await prisma.passwordReset.deleteMany({});
  await prisma.loginAttempt.deleteMany({});
  await prisma.homeNodeChange.deleteMany({});
  // OrgNode.userId must be released before users can go.
  await prisma.orgNode.updateMany({ data: { userId: null } });
  await prisma.orgNode.deleteMany({});
  await prisma.userRole.deleteMany({});
  await prisma.user.deleteMany({});

  const passwordHash = await argon2.hash(SEED_PASSWORD);
  const person = (email: string, name: string, roles: RoleKind[], homeNodeId: string | null, title?: string) =>
    prisma.user.create({
      data: { email, emailLower: email.toLowerCase(), name, title, passwordHash, status: "ACTIVE", homeNodeId, roles: { create: roles.map((kind) => ({ kind })) } },
    });

  const admin = await person("admin@astu.edu.et", "System Administrator", ["SYS_ADMIN"], null);

  // ── Org chart ────────────────────────────────────────────────────────────
  const node = (name: string, level: number, kind: "UNIVERSITY" | "COLLEGE" | "DEPARTMENT" | "OFFICE", code: string) =>
    prisma.orgNode.create({ data: { name, level, kind, code } });
  const university = await node(UNIVERSITY_NAME, 0, "UNIVERSITY", "ASTU");
  const coeec = await node("College of Electrical Engineering and Computing", 1, "COLLEGE", "COEEC");
  const comcme = await node("College of Mechanical, Chemical and Materials Engineering", 1, "COLLEGE", "COMCME");
  const proc = await node("Procurement Office", 1, "OFFICE", "PROC");
  const se = await node("Software Engineering", 2, "DEPARTMENT", "SE");
  const cse = await node("Computer Science and Engineering", 2, "DEPARTMENT", "CSE");
  const chem = await node("Chemical Engineering", 2, "DEPARTMENT", "CHEM");

  const edges = [
    { parentId: university.id, childId: coeec.id },
    { parentId: university.id, childId: comcme.id },
    { parentId: university.id, childId: proc.id },
    { parentId: coeec.id, childId: se.id },
    { parentId: coeec.id, childId: cse.id },
    { parentId: comcme.id, childId: chem.id },
  ];
  await prisma.orgEdge.createMany({ data: edges });
  await prisma.orgClosure.createMany({ data: computeClosureRows([university.id, coeec.id, comcme.id, proc.id, se.id, cse.id, chem.id], edges) });

  // ── Posts: role accounts (rename to the real person later) + ChemE's own ─────
  const occupy = async (nodeId: string, userId: string) => {
    await prisma.orgNode.update({ where: { id: nodeId }, data: { userId } });
    await prisma.orgNodeAssignment.create({ data: { nodeId, userId, assignedById: admin.id, reason: "Seeded" } });
  };
  const avp = await person("avp@astu.edu.et", "Academic Vice President (AVP)", ["MANAGER"], null, "Academic Vice President");
  const dean = await person("coeec.dean@astu.edu.et", "CoEEC Dean", ["MANAGER"], coeec.id, "Dean, College of Electrical Engineering and Computing");
  const cseHead = await person("cse.head@astu.edu.et", "CSE Department Head", ["MANAGER", "STAFF"], cse.id, "Head, Computer Science and Engineering");
  const seHead = await person("se.head@astu.edu.et", "SE Department Head", ["MANAGER", "STAFF"], se.id, "Head, Software Engineering");
  const procurement = await person("procurement@astu.edu.et", "Procurement Officer", ["PROCUREMENT"], proc.id, "Procurement Office");
  await person("store.keeper@astu.edu.et", "Main Store Keeper", ["STORE_KEEPER", "STAFF"], university.id, "ASTU Main Store");
  const chemHead = await person("head.chem@astu.edu.et", "Head, Chemical Engineering", ["MANAGER", "STAFF"], chem.id);
  await person("custodian.chem@astu.edu.et", "Hanna Bekele", ["CUSTODIAN", "STAFF"], chem.id);

  await occupy(university.id, avp.id);
  await occupy(coeec.id, dean.id);
  await occupy(cse.id, cseHead.id);
  await occupy(se.id, seHead.id);
  await occupy(proc.id, procurement.id);
  await occupy(chem.id, chemHead.id);

  console.log(`  7 org nodes: ASTU > CoEEC > {SE, CSE}; CoMCME > ChemE; Procurement Office (PROC)`);
  console.log(`  admin@astu.edu.et, avp@, coeec.dean@, cse.head@, se.head@, procurement@, store.keeper@ (all / ${SEED_PASSWORD})`);
  console.log(`  Chemical Engineering: head.chem@, custodian.chem@ (Hanna Bekele)`);
  console.log(`  The 17 CSE lab custodians come with their labs — run prisma/resource-seed.ts next.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
