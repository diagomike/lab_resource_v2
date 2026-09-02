/**
 * Seeds the minimum needed to sign in and start building the org chart: one SYS_ADMIN and
 * the single UNIVERSITY root node — PLUS a small resource-register slice (one college, two
 * departments, a Lab category, three labs) so the Phase 1 vertical slice has something
 * real to scope, filter and cross-department-leak-test against.
 *
 * The rest of the org chart (further colleges, departments, offices, personnel) is created
 * through the app itself, by design — see PROGRESS.md. The resource register's later
 * phases (category administration, mutations, real ASTU data) replace this seed's Lab
 * category and demo labs with the genuine article; nothing here is meant to survive that.
 *
 * Idempotent by wipe-and-rebuild: every run clears the tables it owns and regenerates ids.
 */
import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";
import { computeClosureRows } from "../lib/server/org/closure-algorithm";

const prisma = new PrismaClient();

const SEED_PASSWORD = "astu1234";
const SYS_ADMIN = { name: "System Administrator", email: "admin@astu.edu.et" };
const UNIVERSITY_NAME = "Adama Science and Technology University";

async function main() {
  console.log("Seeding lab_resource_v2…");

  // Resource-register rows first — they FK into OrgNode/User, which the block below wipes.
  await prisma.item.deleteMany({});
  await prisma.categoryField.deleteMany({});
  await prisma.resourceCategory.deleteMany({});
  await prisma.categoryGroup.deleteMany({});

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

  // ── A Lab category and three labs, split across the two departments ────────
  const placesGroup = await prisma.categoryGroup.create({ data: { name: "Places", sortOrder: 0 } });
  const labCategory = await prisma.resourceCategory.create({
    data: {
      key: "lab",
      name: "Lab",
      iconKey: "Building2",
      groupId: placesGroup.id,
      countingMode: "SERIALIZED",
      impairRule: "ANY_CRITICAL",
      fields: {
        create: [
          { key: "room", label: "Room", type: "TEXT", options: [], summary: true, sortOrder: 0 },
          { key: "seats", label: "Seats", type: "NUMBER", options: [], summary: true, sortOrder: 1 },
          { key: "purpose", label: "Purpose", type: "TEXT", options: [], sortOrder: 2 },
          { key: "source", label: "Source", type: "TEXT", options: [], sortOrder: 3 },
        ],
      },
    },
  });

  await prisma.item.createMany({
    data: [
      {
        name: "SE Lab X — Software Lab 3",
        categoryId: labCategory.id,
        countingMode: "SERIALIZED",
        ownerOrgNodeId: se.id,
        currentOrgNodeId: se.id,
        custodianId: seCustodian.id,
        props: { room: "IT-204", seats: 25 },
      },
      {
        name: "SE Networking Lab",
        categoryId: labCategory.id,
        countingMode: "SERIALIZED",
        ownerOrgNodeId: se.id,
        currentOrgNodeId: se.id,
        custodianId: seCustodian.id,
        props: { room: "IT-118", seats: 20 },
      },
      {
        name: "Chemical Engineering Unit Operations Lab",
        categoryId: labCategory.id,
        countingMode: "SERIALIZED",
        ownerOrgNodeId: chem.id,
        currentOrgNodeId: chem.id,
        custodianId: chemCustodian.id,
        props: { room: "B528-RG16", seats: 30 },
      },
    ],
  });

  console.log(`  1 SYS_ADMIN (${SYS_ADMIN.email} / ${SEED_PASSWORD})`);
  console.log(`  1 UNIVERSITY root node ("${UNIVERSITY_NAME}")`);
  console.log(`  2 colleges, 2 departments (SE, ChemE)`);
  console.log(`  2 department heads, 2 custodians (all / ${SEED_PASSWORD})`);
  console.log(`  1 category (Lab), 3 items (2 owned by SE, 1 by ChemE)`);
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
