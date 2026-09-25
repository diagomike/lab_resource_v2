/**
 * E2E campaign cast (docs/e2e-findings-2026-09-15.md), on the CLONE DB only — run via
 * `node e2e/with-env.mjs npx tsx e2e/fixture.ts`. Adds the posts prisma/seed.ts lacks:
 * an AVP on the university root, both deans, a multi-parent department, a Procurement
 * Office, a store keeper, staff, a student, a property admin and a disabled account.
 * Features under test (creating nodes/people through the app) are exercised by the
 * suites themselves, not here.
 */
import { PrismaClient, type RoleKind } from "@prisma/client";
import * as argon2 from "@node-rs/argon2";
import { computeClosureRows } from "../lib/server/org/closure-algorithm";

if (!process.env.DATABASE_URL?.includes("lrms_v2_e2e")) throw new Error("fixture.ts runs against lrms_v2_e2e only");
const prisma = new PrismaClient();

async function node(name: string) {
  return prisma.orgNode.findFirstOrThrow({ where: { name } });
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

async function main() {
  const hash = await argon2.hash("astu1234");
  const [uni, coeec, comcme, se, chem] = await Promise.all([
    node("Adama Science and Technology University"),
    node("College of Electrical Engineering and Computing"),
    node("College of Mechanical, Chemical and Materials Engineering"),
    node("Software Engineering"),
    node("Chemical Engineering"),
  ]);

  const mat = await prisma.orgNode.create({ data: { name: "Materials Science", level: 2, kind: "DEPARTMENT", code: "MAT" } });
  const proc = await prisma.orgNode.create({ data: { name: "Procurement Office", level: 1, kind: "OFFICE", code: "PROC" } });
  await prisma.orgEdge.createMany({
    data: [
      { parentId: coeec.id, childId: mat.id },
      { parentId: comcme.id, childId: mat.id },
      { parentId: uni.id, childId: proc.id },
    ],
  });
  const nodes = await prisma.orgNode.findMany({ select: { id: true } });
  const edges = await prisma.orgEdge.findMany();
  await prisma.orgClosure.deleteMany({});
  await prisma.orgClosure.createMany({ data: computeClosureRows(nodes.map((n) => n.id), edges) });

  const avp = await person("avp@e2e.test", "E2E AVP", ["MANAGER"], null, hash);
  const deanCoeec = await person("dean.coeec@e2e.test", "E2E Dean CoEEC", ["MANAGER"], null, hash);
  const deanComcme = await person("dean.comcme@e2e.test", "E2E Dean CoMCME", ["MANAGER"], null, hash);
  const headMat = await person("head.mat@e2e.test", "E2E Head Materials", ["MANAGER", "STAFF"], mat.id, hash);
  await person("custodian.mat@e2e.test", "E2E Custodian Materials", ["CUSTODIAN", "STAFF"], mat.id, hash);
  const procurement = await person("procurement@e2e.test", "E2E Procurement Officer", ["PROCUREMENT"], null, hash);
  const storekeeper = await person("storekeeper@e2e.test", "E2E Store Keeper", ["STORE_KEEPER", "STAFF"], uni.id, hash);
  await person("staff.se@e2e.test", "E2E Staff SE", ["STAFF"], se.id, hash);
  await person("staff.chem@e2e.test", "E2E Staff ChemE", ["STAFF"], chem.id, hash);
  await person("student@e2e.test", "E2E Student", ["STUDENT"], se.id, hash);
  await person("propadmin@e2e.test", "E2E Property Admin", ["PROPERTY_ADMIN"], null, hash);
  await person("disabled@e2e.test", "E2E Disabled Staff", ["STAFF"], se.id, hash, "DISABLED");

  await occupy(uni.id, avp.id);
  await occupy(coeec.id, deanCoeec.id);
  await occupy(comcme.id, deanComcme.id);
  await occupy(mat.id, headMat.id);
  await occupy(proc.id, procurement.id);

  // The Main Store and its seeded stock belong to the store keeper, as in real operation.
  const store = await prisma.item.findFirstOrThrow({ where: { name: "ASTU Main Store", parentId: null } });
  await prisma.item.update({ where: { id: store.id }, data: { custodianId: storekeeper.id } });
  await prisma.item.updateMany({ where: { parentId: store.id }, data: { custodianId: storekeeper.id } });

  console.log("fixture ready:", { mat: mat.id, proc: proc.id, store: store.id });
}

main().finally(() => prisma.$disconnect());
