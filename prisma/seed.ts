/**
 * Seeds the minimum needed to sign in and start building the org chart: one SYS_ADMIN and
 * the single UNIVERSITY root node — PLUS a small scoping fixture (two colleges, two
 * departments, a department head and a custodian per department) so cross-department
 * scope enforcement (ScopeService) has something real to exercise.
 *
 * The rest of the org chart (further colleges, departments, offices, personnel) is created
 * through the app itself, by design — see PROGRESS.md. This used to also seed a resource
 * register slice (a Lab category, three labs); that module was deleted — see
 * ~/.claude/plans/wait-i-want-gentle-haven.md — and its replacement will bring its own
 * seed data when it lands.
 *
 * Idempotent by wipe-and-rebuild: every run clears the tables it owns and regenerates ids.
 * That wipe (every User, UserRole, OrgNode, Session, ...) is exactly why this refuses to
 * run against production below — run against a real database, it would delete every
 * real custodian account. `prisma/bootstrap.ts` is the production-safe equivalent: an
 * idempotent upsert that creates nothing but the first SYS_ADMIN and the UNIVERSITY
 * root, never deletes anything, and is safe to re-run.
 */
import { PrismaClient } from "@prisma/client";
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
const SYS_ADMIN = { name: "System Administrator", email: "admin@astu.edu.et" };
const UNIVERSITY_NAME = "Adama Science and Technology University";

async function main() {
  console.log("Seeding lab_resource_v2…");

  await prisma.orgNodeAssignment.deleteMany({});
  await prisma.orgClosure.deleteMany({});
  await prisma.orgEdge.deleteMany({});
  await prisma.session.deleteMany({});
  await prisma.invitation.deleteMany({});
  await prisma.passwordReset.deleteMany({});
  // OrgNode.userId must be released before users can go.
  await prisma.orgNode.updateMany({ data: { userId: null } });
  await prisma.orgNode.deleteMany({});
  await prisma.userRole.deleteMany({});
  await prisma.user.deleteMany({});

  const passwordHash = await argon2.hash(SEED_PASSWORD);
  const admin = await prisma.user.create({
    data: {
      email: SYS_ADMIN.email,
      emailLower: SYS_ADMIN.email.toLowerCase(),
      name: SYS_ADMIN.name,
      passwordHash,
      status: "ACTIVE",
      roles: { create: [{ kind: "SYS_ADMIN" }] },
    },
  });

  const university = await prisma.orgNode.create({
    data: { name: UNIVERSITY_NAME, level: 0, kind: "UNIVERSITY", code: "ASTU" },
  });

  // ── A small org chart to scope against ─────────────────────────────────────
  const college = await prisma.orgNode.create({
    data: { name: "College of Electrical Engineering and Computing", level: 1, kind: "COLLEGE", code: "COEEC" },
  });
  const comcme = await prisma.orgNode.create({
    data: { name: "College of Mechanical, Chemical and Materials Engineering", level: 1, kind: "COLLEGE", code: "COMCME" },
  });
  const se = await prisma.orgNode.create({
    data: { name: "Software Engineering", level: 2, kind: "DEPARTMENT", code: "SE" },
  });
  const chem = await prisma.orgNode.create({
    data: { name: "Chemical Engineering", level: 2, kind: "DEPARTMENT", code: "CHEM" },
  });

  const edges = [
    { parentId: university.id, childId: college.id },
    { parentId: university.id, childId: comcme.id },
    { parentId: college.id, childId: se.id },
    { parentId: comcme.id, childId: chem.id },
  ];
  await prisma.orgEdge.createMany({ data: edges });

  const closureRows = computeClosureRows([university.id, college.id, comcme.id, se.id, chem.id], edges);
  await prisma.orgClosure.createMany({ data: closureRows });

  // ── A department head + a custodian per department, so items have somewhere to be
  //    owned and someone to answer for them ──────────────────────────────────
  const seHead = await prisma.user.create({
    data: {
      email: "head.se@astu.edu.et",
      emailLower: "head.se@astu.edu.et",
      name: "Head, Software Engineering",
      passwordHash,
      status: "ACTIVE",
      homeNodeId: se.id,
      roles: { create: [{ kind: "MANAGER" }, { kind: "STAFF" }] },
    },
  });
  await prisma.orgNode.update({ where: { id: se.id }, data: { userId: seHead.id } });

  const chemHead = await prisma.user.create({
    data: {
      email: "head.chem@astu.edu.et",
      emailLower: "head.chem@astu.edu.et",
      name: "Head, Chemical Engineering",
      passwordHash,
      status: "ACTIVE",
      homeNodeId: chem.id,
      roles: { create: [{ kind: "MANAGER" }, { kind: "STAFF" }] },
    },
  });
  await prisma.orgNode.update({ where: { id: chem.id }, data: { userId: chemHead.id } });

  const seCustodian = await prisma.user.create({
    data: {
      email: "custodian.se@astu.edu.et",
      emailLower: "custodian.se@astu.edu.et",
      name: "Girma Wolde",
      passwordHash,
      status: "ACTIVE",
      homeNodeId: se.id,
      roles: { create: [{ kind: "CUSTODIAN" }, { kind: "STAFF" }] },
    },
  });

  const chemCustodian = await prisma.user.create({
    data: {
      email: "custodian.chem@astu.edu.et",
      emailLower: "custodian.chem@astu.edu.et",
      name: "Hanna Bekele",
      passwordHash,
      status: "ACTIVE",
      homeNodeId: chem.id,
      roles: { create: [{ kind: "CUSTODIAN" }, { kind: "STAFF" }] },
    },
  });

  console.log(`  1 SYS_ADMIN (${SYS_ADMIN.email} / ${SEED_PASSWORD})`);
  console.log(`  1 UNIVERSITY root node ("${UNIVERSITY_NAME}")`);
  console.log(`  2 colleges, 2 departments (SE, ChemE)`);
  console.log(`  2 department heads, 2 custodians (all / ${SEED_PASSWORD})`);
  console.log(`  admin user id: ${admin.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
