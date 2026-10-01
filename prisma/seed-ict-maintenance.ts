/**
 * The ICT Maintenance Office — a post that sees every department's resources (every
 * university account reads the whole university), so ICT can tell which devices need
 * maintenance and plan for it. It never edits the register.
 *
 *   ASTU → ICT Maintenance Office (OFFICE, code ICT)
 *   ict.maintenance@astu.edu.et — "ICT Maintenance Officer", MANAGER, occupies ICT
 *
 * Idempotent: matches the node by code and the person by email, and creates only what
 * is missing (the password is set only on a newly created account). prisma/seed.ts
 * calls it, and it runs on its own against an existing database:
 *
 *   npx tsx prisma/seed-ict-maintenance.ts
 */
import { PrismaClient } from "@prisma/client";
import * as argon2 from "@node-rs/argon2";
import { computeClosureRows } from "../lib/server/org/closure-algorithm";

export const ICT_EMAIL = "ict.maintenance@astu.edu.et";

export async function ensureIctMaintenance(prisma: PrismaClient, password = "astu1234"): Promise<void> {
  const root = await prisma.orgNode.findUniqueOrThrow({ where: { code: "ASTU" } });

  let office = await prisma.orgNode.findUnique({ where: { code: "ICT" } });
  if (!office) office = await prisma.orgNode.create({ data: { name: "ICT Maintenance Office", level: 1, kind: "OFFICE", code: "ICT" } });
  const edge = await prisma.orgEdge.findFirst({ where: { parentId: root.id, childId: office.id } });
  if (!edge) {
    await prisma.orgEdge.create({ data: { parentId: root.id, childId: office.id } });
    // Reachability is precomputed — rebuild it from every node and edge, the same way
    // the org service does after any structural change.
    const [nodes, edges] = await Promise.all([prisma.orgNode.findMany({ select: { id: true } }), prisma.orgEdge.findMany({ select: { parentId: true, childId: true } })]);
    await prisma.$transaction([prisma.orgClosure.deleteMany({}), prisma.orgClosure.createMany({ data: computeClosureRows(nodes.map((n) => n.id), edges) })]);
  }

  let officer = await prisma.user.findUnique({ where: { emailLower: ICT_EMAIL } });
  if (!officer) {
    officer = await prisma.user.create({
      data: {
        email: ICT_EMAIL,
        emailLower: ICT_EMAIL,
        name: "ICT Maintenance Officer",
        title: "ICT Maintenance Office",
        passwordHash: await argon2.hash(password),
        status: "ACTIVE",
        homeNodeId: office.id,
        roles: { create: [{ kind: "MANAGER" }] },
      },
    });
  }
  if (office.userId !== officer.id) await prisma.orgNode.update({ where: { id: office.id }, data: { userId: officer.id } });

  console.log(`  ICT Maintenance Office (ICT) · ${ICT_EMAIL} (reads the whole university)`);
}

// Run on its own: `npx tsx prisma/seed-ict-maintenance.ts`.
if (process.argv[1]?.replace(/\\/g, "/").endsWith("prisma/seed-ict-maintenance.ts")) {
  const prisma = new PrismaClient();
  ensureIctMaintenance(prisma)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
