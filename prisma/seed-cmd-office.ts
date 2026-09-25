/**
 * The College Managing Director's office — the purchase-approval step between the AVP
 * and the Procurement Office.
 *
 *   ASTU → College Managing Director (OFFICE, code CMD)
 *   cmd@astu.edu.et — "College Managing Director (CMD)", MANAGER, occupies the office
 *
 * lib/server/resources/purchasing.ts finds the office by its code (or exact name) and
 * adds its occupant to every purchase request compiled from then on:
 * Head → Dean → AVP → College Managing Director → Procurement Office. Requests already
 * in the chain keep the steps they were compiled with.
 *
 * Idempotent: matches the node by code and the person by email, creates only what is
 * missing (the password is set only on a newly created account), and fills the post
 * only while it is vacant. prisma/seed.ts calls it, and it runs on its own against an
 * existing database:
 *
 *   npx tsx prisma/seed-cmd-office.ts
 */
import { PrismaClient } from "@prisma/client";
import * as argon2 from "@node-rs/argon2";
import { computeClosureRows } from "../lib/server/org/closure-algorithm";

export const CMD_EMAIL = "cmd@astu.edu.et";

export async function ensureCmdOffice(prisma: PrismaClient, password = "astu1234"): Promise<void> {
  const root = await prisma.orgNode.findUniqueOrThrow({ where: { code: "ASTU" } });

  let office = await prisma.orgNode.findUnique({ where: { code: "CMD" } });
  if (!office) office = await prisma.orgNode.create({ data: { name: "College Managing Director", level: 1, kind: "OFFICE", code: "CMD" } });
  const edge = await prisma.orgEdge.findFirst({ where: { parentId: root.id, childId: office.id } });
  if (!edge) {
    await prisma.orgEdge.create({ data: { parentId: root.id, childId: office.id } });
    // Reachability is precomputed — rebuild it from every node and edge, the same way
    // the org service does after any structural change.
    const [nodes, edges] = await Promise.all([prisma.orgNode.findMany({ select: { id: true } }), prisma.orgEdge.findMany({ select: { parentId: true, childId: true } })]);
    await prisma.$transaction([prisma.orgClosure.deleteMany({}), prisma.orgClosure.createMany({ data: computeClosureRows(nodes.map((n) => n.id), edges) })]);
  }

  let director = await prisma.user.findUnique({ where: { emailLower: CMD_EMAIL } });
  if (!director) {
    director = await prisma.user.create({
      data: {
        email: CMD_EMAIL,
        emailLower: CMD_EMAIL,
        name: "College Managing Director (CMD)",
        title: "College Managing Director",
        passwordHash: await argon2.hash(password),
        status: "ACTIVE",
        homeNodeId: office.id,
        roles: { create: [{ kind: "MANAGER" }] },
      },
    });
  }

  if (!office.userId) {
    const admin = await prisma.user.findFirst({ where: { roles: { some: { kind: "SYS_ADMIN" } } }, select: { id: true } });
    await prisma.orgNode.update({ where: { id: office.id }, data: { userId: director.id } });
    await prisma.orgNodeAssignment.create({ data: { nodeId: office.id, userId: director.id, assignedById: admin?.id ?? director.id, reason: "Seeded" } });
  }
  console.log(`  College Managing Director (CMD) · ${CMD_EMAIL} — approves purchases after the AVP, before Procurement`);
}

// Run on its own: `npx tsx prisma/seed-cmd-office.ts`.
if (process.argv[1]?.replace(/\\/g, "/").endsWith("prisma/seed-cmd-office.ts")) {
  const prisma = new PrismaClient();
  ensureCmdOffice(prisma)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
