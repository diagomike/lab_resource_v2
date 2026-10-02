/**
 * E2E campaign cast (docs/e2e-findings-2026-09-15.md), on the CLONE DB only — run via
 * `node e2e/with-env.mjs npx tsx e2e/fixture.ts` after `node e2e/reset-demo.mjs`.
 *
 * Rebuilt 2026-10-02 for the UX-flow seed (five colleges, ADAA offices, CMD/PROC/PROP/ICT,
 * CSE's real labs): it adds only what the suites need and the seed lacks —
 *  - Software Engineering run by two custodians, with "SE Lab X — Software Lab 3"
 *    (a bookable room holding computers, chairs and a whiteboard);
 *  - Materials Science and Engineering sitting under BOTH CoEEC and CoMCME (a
 *    multi-parent department), with its head and a custodian;
 *  - a dean for CoMCME, a second custodian in ChemE and SE, and a disabled account;
 *  - SE's "Workstation Setup 07" on loan inside Hanna's ChemE lab (owned by SE, Girma's);
 *  - computers bookable as machines, labs on the public catalogue.
 * Features under test (creating labs, people, units through the app) are exercised by the
 * suites themselves, not here.
 */
import { PrismaClient, type RoleKind } from "@prisma/client";
import * as argon2 from "@node-rs/argon2";
import { computeClosureRows } from "../lib/server/org/closure-algorithm";

if (!process.env.DATABASE_URL?.includes("lrms_v2_e2e")) throw new Error("fixture.ts runs against lrms_v2_e2e only");
const prisma = new PrismaClient();

async function node(code: string) {
  return prisma.orgNode.findFirstOrThrow({ where: { code } });
}

async function person(email: string, name: string, roles: RoleKind[], homeNodeId: string | null, hash: string, status: "ACTIVE" | "DISABLED" = "ACTIVE") {
  return prisma.user.upsert({
    where: { emailLower: email },
    update: {},
    create: { email, emailLower: email, name, passwordHash: hash, status, homeNodeId, roles: { create: roles.map((kind) => ({ kind })) } },
  });
}

async function occupy(nodeId: string, userId: string) {
  await prisma.orgNode.update({ where: { id: nodeId }, data: { userId } });
  await prisma.orgNodeAssignment.create({ data: { nodeId, userId, assignedById: userId, reason: "E2E fixture" } });
}

async function category(key: string) {
  return prisma.resourceCategory.findUniqueOrThrow({ where: { key } });
}

async function main() {
  const hash = await argon2.hash("astu1234");
  const [coeec, comcme, se, chem, mat] = await Promise.all([node("COEEC"), node("COMCME"), node("SE"), node("CHEM"), node("MSE")]);

  // Materials Science and Engineering also sits under CoEEC — a department with two parents.
  await prisma.orgEdge.create({ data: { parentId: coeec.id, childId: mat.id } });
  const nodes = await prisma.orgNode.findMany({ select: { id: true } });
  const edges = await prisma.orgEdge.findMany();
  await prisma.orgClosure.deleteMany({});
  await prisma.orgClosure.createMany({ data: computeClosureRows(nodes.map((n) => n.id), edges) });

  const deanComcme = await person("dean.comcme@e2e.test", "E2E Dean CoMCME", ["MANAGER"], comcme.id, hash);
  const headMat = await person("head.mat@e2e.test", "E2E Head Materials", ["MANAGER"], mat.id, hash);
  await person("custodian.mat@e2e.test", "E2E Custodian Materials", ["CUSTODIAN"], mat.id, hash);
  const girma = await person("custodian.se@e2e.test", "E2E Girma (SE custodian)", ["CUSTODIAN"], se.id, hash);
  await person("custodian.se2@e2e.test", "E2E SE Assistant", ["CUSTODIAN"], se.id, hash);
  await person("staff.se@e2e.test", "E2E Staff SE", ["CUSTODIAN"], se.id, hash);
  await person("staff.chem@e2e.test", "E2E Staff ChemE", ["CUSTODIAN"], chem.id, hash);
  await person("disabled@e2e.test", "E2E Disabled Staff", ["CUSTODIAN"], se.id, hash, "DISABLED");
  await occupy(comcme.id, deanComcme.id);
  await occupy(mat.id, headMat.id);

  // Machines are bookable; labs are rooms on the public catalogue.
  await prisma.resourceCategory.update({ where: { key: "computer" }, data: { bookingMode: "EQUIPMENT", publicListed: true } });
  await prisma.resourceCategory.update({ where: { key: "lab" }, data: { bookingMode: "ROOM", publicListed: true } });

  // SE Lab X — Software Lab 3, run by Girma.
  const [lab, computer, chair, whiteboard] = await Promise.all([category("lab"), category("computer"), category("chair"), category("whiteboard")]);
  const at = { ownerOrgNodeId: se.id, currentOrgNodeId: se.id, custodianId: girma.id };
  const room = await prisma.item.create({
    data: { ...at, categoryId: lab.id, name: "SE Lab X — Software Lab 3", countingMode: lab.countingMode, qty: 1, status: "WORKING", props: { block: "509", room: "3", seats: 20, purpose: "Software Engineering computer laboratory" } },
  });
  const inside = (categoryId: string, name: string, countingMode: typeof lab.countingMode, status: "WORKING" | "BROKEN" = "WORKING") =>
    prisma.item.create({ data: { ...at, parentId: room.id, categoryId, name, countingMode, qty: 1, status, props: {} } });
  for (const [n, status] of [["SE PC 01", "WORKING"], ["SE PC 02", "WORKING"], ["SE PC 03", "WORKING"]] as const) await inside(computer.id, n, computer.countingMode, status);
  for (const n of ["SE Chair 01", "SE Chair 02", "SE Chair 03", "SE Chair 04"]) await inside(chair.id, n, chair.countingMode);
  await inside(whiteboard.id, "SE Whiteboard", whiteboard.countingMode);

  // A loan: SE's workstation setup (a computer and a chair in it) sits in Hanna's ChemE lab.
  const hannaLab = await prisma.item.findFirstOrThrow({ where: { name: "Mechanical Unit Operations Laboratory", parentId: null } });
  const setupCat = await category("setup");
  const lent = { ownerOrgNodeId: se.id, currentOrgNodeId: chem.id, custodianId: girma.id };
  const setup = await prisma.item.create({ data: { ...lent, parentId: hannaLab.id, categoryId: setupCat.id, name: "Workstation Setup 07", countingMode: setupCat.countingMode, qty: 1, status: "WORKING", props: {} } });
  await prisma.item.create({ data: { ...lent, parentId: setup.id, categoryId: computer.id, name: "Computer 07", countingMode: computer.countingMode, qty: 1, status: "WORKING", critical: true, props: {} } });
  await prisma.item.create({ data: { ...lent, parentId: setup.id, categoryId: chair.id, name: "Chair 07", countingMode: chair.countingMode, qty: 1, status: "WORKING", props: {} } });

  console.log("fixture ready:", { mat: mat.id, se: se.id, seLab: room.id, loan: setup.id });
}

main().finally(() => prisma.$disconnect());
