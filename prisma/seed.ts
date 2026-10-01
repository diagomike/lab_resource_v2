/**
 * Seeds the org chart and the people who run it — a CLEAN SLATE (2026-09-22): the
 * administrator, the Chemical Engineering people, and one clearly named role account
 * per post the purchase and approval chains need. The 17 CSE lab custodians (ARAs) are
 * real people and are seeded with their labs by prisma/cse-lab-data.ts (run through
 * resource-seed.ts); rename any role account to the real person later from
 * People & roles.
 *
 *   ASTU (AVP)
 *   ├─ the five colleges, each with its departments and an Associate Dean of Academic
 *   │  Affairs office (adaa.<college>@ — creates the college's labs and stores):
 *   │   ├─ CoEEC (dean): CSE (head), SE (head), ECE, EPCE
 *   │   ├─ CoMCME: Chemical Engineering (head.chem), Mechanical, Materials
 *   │   ├─ CoCEA: Civil, Water Resources, Architecture
 *   │   ├─ CoANS: Applied Chemistry, Biology, Geology, Physics, Mathematics
 *   │   └─ CoHSS
 *   ├─ College Managing Director, code CMD (cmd@ — purchases after the dean, permanent transfers)
 *   ├─ Property Administration, code PROP (property.admin@ — Main Store movements)
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
import { ensureIctMaintenance } from "./seed-ict-maintenance";
import { ensureCmdOffice } from "./seed-cmd-office";
import { ensurePropertyOffice } from "./seed-property-office";

if (process.env.NODE_ENV === "production") {
  console.error("prisma/seed.ts refuses to run with NODE_ENV=production — this wipes every User/OrgNode. Use prisma/bootstrap.ts instead.");
  process.exit(1);
}

const prisma = new PrismaClient();

const SEED_PASSWORD = "astu1234";

/** ASTU's colleges and their departments (astu.edu.et, 2026). Codes are what other seed
 *  files and the e2e suites look nodes up by — CSE, SE and CHEM above all. */
const COLLEGES: Array<{ code: string; short: string; name: string; departments: Array<[code: string, name: string]> }> = [
  {
    code: "COEEC",
    short: "CoEEC",
    name: "College of Electrical Engineering and Computing",
    departments: [
      ["CSE", "Computer Science and Engineering"],
      ["SE", "Software Engineering"],
      ["ECE", "Electronics and Communication Engineering"],
      ["EPCE", "Electrical Power and Control Engineering"],
    ],
  },
  {
    code: "COMCME",
    short: "CoMCME",
    name: "College of Mechanical, Chemical and Materials Engineering",
    departments: [
      ["CHEM", "Chemical Engineering"],
      ["ME", "Mechanical Engineering"],
      ["MSE", "Materials Science and Engineering"],
    ],
  },
  {
    code: "COCEA",
    short: "CoCEA",
    name: "College of Civil Engineering and Architecture",
    departments: [
      ["CE", "Civil Engineering"],
      ["WRE", "Water Resources Engineering"],
      ["ARCH", "Architecture"],
    ],
  },
  {
    code: "COANS",
    short: "CoANS",
    name: "College of Applied Natural Sciences",
    departments: [
      ["ACHEM", "Applied Chemistry"],
      ["ABIO", "Applied Biology"],
      ["AGEO", "Applied Geology"],
      ["APHY", "Applied Physics"],
      ["AMATH", "Applied Mathematics"],
    ],
  },
  { code: "COHSS", short: "CoHSS", name: "College of Humanities and Social Sciences", departments: [] },
];
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
  const proc = await node("Procurement Office", 1, "OFFICE", "PROC");
  const edges: Array<{ parentId: string; childId: string }> = [{ parentId: university.id, childId: proc.id }];
  const nodeIds = [university.id, proc.id];
  const byCode = new Map<string, string>();
  const adaaOffices: Array<{ college: string; officeId: string; short: string }> = [];
  for (const c of COLLEGES) {
    const college = await node(c.name, 1, "COLLEGE", c.code);
    edges.push({ parentId: university.id, childId: college.id });
    nodeIds.push(college.id);
    byCode.set(c.code, college.id);
    for (const [code, name] of c.departments) {
      const dept = await node(name, 2, "DEPARTMENT", code);
      edges.push({ parentId: college.id, childId: dept.id });
      nodeIds.push(dept.id);
      byCode.set(code, dept.id);
    }
    const office = await node(`Associate Dean of Academic Affairs, ${c.short}`, 2, "OFFICE", `${c.code}-ADAA`);
    edges.push({ parentId: college.id, childId: office.id });
    nodeIds.push(office.id);
    adaaOffices.push({ college: c.code, officeId: office.id, short: c.short });
  }
  await prisma.orgEdge.createMany({ data: edges });
  await prisma.orgClosure.createMany({ data: computeClosureRows(nodeIds, edges) });
  const coeec = { id: byCode.get("COEEC")! };
  const se = { id: byCode.get("SE")! };
  const cse = { id: byCode.get("CSE")! };
  const chem = { id: byCode.get("CHEM")! };

  // ── Posts: role accounts (rename to the real person later) + ChemE's own ─────
  const occupy = async (nodeId: string, userId: string) => {
    await prisma.orgNode.update({ where: { id: nodeId }, data: { userId } });
    await prisma.orgNodeAssignment.create({ data: { nodeId, userId, assignedById: admin.id, reason: "Seeded" } });
  };
  const avp = await person("avp@astu.edu.et", "Academic Vice President (AVP)", ["MANAGER"], null, "Academic Vice President");
  const dean = await person("coeec.dean@astu.edu.et", "CoEEC Dean", ["MANAGER"], coeec.id, "Dean, College of Electrical Engineering and Computing");
  const cseHead = await person("cse.head@astu.edu.et", "CSE Department Head", ["MANAGER"], cse.id, "Head, Computer Science and Engineering");
  const seHead = await person("se.head@astu.edu.et", "SE Department Head", ["MANAGER"], se.id, "Head, Software Engineering");
  const procurement = await person("procurement@astu.edu.et", "Procurement Officer", ["PROCUREMENT"], proc.id, "Procurement Office");
  await person("store.keeper@astu.edu.et", "Main Store Keeper", ["STORE_KEEPER"], university.id, "ASTU Main Store");
  const chemHead = await person("head.chem@astu.edu.et", "Head, Chemical Engineering", ["MANAGER"], chem.id);
  await person("custodian.chem@astu.edu.et", "Hanna Bekele", ["CUSTODIAN"], chem.id);

  await occupy(university.id, avp.id);
  await occupy(coeec.id, dean.id);
  await occupy(cse.id, cseHead.id);
  await occupy(se.id, seHead.id);
  await occupy(proc.id, procurement.id);
  await occupy(chem.id, chemHead.id);
  // Each college's ADAA: homed in (and occupying) the college's ADAA office.
  for (const o of adaaOffices) {
    const adaa = await person(`adaa.${o.college.toLowerCase()}@astu.edu.et`, `${o.short} ADAA`, ["ADAA"], o.officeId, `Associate Dean of Academic Affairs, ${o.short}`);
    await occupy(o.officeId, adaa.id);
  }

  // The ICT Maintenance Office: a post that reads the whole university (see its own file).
  await ensureIctMaintenance(prisma, SEED_PASSWORD);
  // The College Managing Director: purchases after the dean, and permanent transfers (see its own file).
  await ensureCmdOffice(prisma, SEED_PASSWORD);
  // Property Administration: every Main Store movement (see its own file).
  await ensurePropertyOffice(prisma, SEED_PASSWORD);

  console.log(`  ${nodeIds.length + 3} org nodes: ASTU > ${COLLEGES.map((c) => c.short).join(", ")} (each with its departments and an ADAA office); PROC, ICT, CMD, PROP`);
  console.log(`  admin@astu.edu.et, avp@, cmd@, property.admin@, coeec.dean@, cse.head@, se.head@, procurement@, store.keeper@, adaa.<college>@ e.g. adaa.coeec@ (all / ${SEED_PASSWORD})`);
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
