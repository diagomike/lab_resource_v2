/**
 * The Property Administration office — the approval every movement in or out of the
 * Main Store needs (a handover or allocation out of it, a request from it, a return to
 * it), and the second approval a permanent transfer between colleges needs after the
 * College Managing Director.
 *
 *   ASTU → Property Administration (OFFICE, code PROP)
 *   property.admin@astu.edu.et — "Property Administrator", PROPERTY_ADMIN, occupies it
 *
 * lib/server/org/offices.ts finds the office by its code (or exact name) and the
 * movement chains in lib/server/resources/approvals.ts route to its occupant. Requests
 * already in a chain keep the steps they were built with.
 *
 * Idempotent: matches the node by code and the person by email, creates only what is
 * missing (the password is set only on a newly created account), and fills the post
 * only while it is vacant. prisma/seed.ts calls it, and it runs on its own against an
 * existing database:
 *
 *   npx tsx prisma/seed-property-office.ts
 */
import { PrismaClient } from "@prisma/client";
import * as argon2 from "@node-rs/argon2";
import { computeClosureRows } from "../lib/server/org/closure-algorithm";

export const PROPERTY_EMAIL = "property.admin@astu.edu.et";

export async function ensurePropertyOffice(prisma: PrismaClient, password = "astu1234"): Promise<void> {
  const root = await prisma.orgNode.findUniqueOrThrow({ where: { code: "ASTU" } });

  let office = await prisma.orgNode.findUnique({ where: { code: "PROP" } });
  if (!office) office = await prisma.orgNode.create({ data: { name: "Property Administration", level: 1, kind: "OFFICE", code: "PROP" } });
  const edge = await prisma.orgEdge.findFirst({ where: { parentId: root.id, childId: office.id } });
  if (!edge) {
    await prisma.orgEdge.create({ data: { parentId: root.id, childId: office.id } });
    // Reachability is precomputed — rebuild it from every node and edge, the same way
    // the org service does after any structural change.
    const [nodes, edges] = await Promise.all([prisma.orgNode.findMany({ select: { id: true } }), prisma.orgEdge.findMany({ select: { parentId: true, childId: true } })]);
    await prisma.$transaction([prisma.orgClosure.deleteMany({}), prisma.orgClosure.createMany({ data: computeClosureRows(nodes.map((n) => n.id), edges) })]);
  }

  let admin = await prisma.user.findUnique({ where: { emailLower: PROPERTY_EMAIL } });
  if (!admin) {
    admin = await prisma.user.create({
      data: {
        email: PROPERTY_EMAIL,
        emailLower: PROPERTY_EMAIL,
        name: "Property Administrator",
        title: "Property Administration",
        passwordHash: await argon2.hash(password),
        status: "ACTIVE",
        homeNodeId: office.id,
        roles: { create: [{ kind: "PROPERTY_ADMIN" }] },
      },
    });
  }

  if (!office.userId) {
    const sysAdmin = await prisma.user.findFirst({ where: { roles: { some: { kind: "SYS_ADMIN" } } }, select: { id: true } });
    await prisma.orgNode.update({ where: { id: office.id }, data: { userId: admin.id } });
    await prisma.orgNodeAssignment.create({ data: { nodeId: office.id, userId: admin.id, assignedById: sysAdmin?.id ?? admin.id, reason: "Seeded" } });
  }
  console.log(`  Property Administration (PROP) · ${PROPERTY_EMAIL} — approves Main Store movements and cross-college transfers`);
}

// Run on its own: `npx tsx prisma/seed-property-office.ts`.
if (process.argv[1]?.replace(/\\/g, "/").endsWith("prisma/seed-property-office.ts")) {
  const prisma = new PrismaClient();
  ensurePropertyOffice(prisma)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
