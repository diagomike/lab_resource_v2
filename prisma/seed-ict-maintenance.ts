/**
 * The ICT Maintenance Office — a view-only post that sees every department's resources,
 * so ICT can tell which devices need maintenance and plan for it.
 *
 *   ASTU → ICT Maintenance Office (OFFICE, code ICT)
 *   ict.maintenance@astu.edu.et — "ICT Maintenance Officer", STAFF, home unit ICT
 *   Access view "ICT maintenance — every department": University-wide, read only,
 *   assigned to that person.
 *
 * Nothing new in the permission model: STAFF never writes resources, and the access
 * view widens READS only (lib/domain/views.ts) — the officer looks, never touches. The
 * Dashboard's "Needs attention" and "Where the problems are", and the register's status
 * filters, are how they find what to plan for.
 *
 * Idempotent: matches the node by code, the person by email and the view by name, and
 * creates only what is missing (the password is set only on a newly created account).
 * prisma/seed.ts calls it, and it runs on its own against an existing database:
 *
 *   npx tsx prisma/seed-ict-maintenance.ts
 */
import { PrismaClient } from "@prisma/client";
import * as argon2 from "@node-rs/argon2";
import { computeClosureRows } from "../lib/server/org/closure-algorithm";

export const ICT_EMAIL = "ict.maintenance@astu.edu.et";
export const ICT_VIEW_NAME = "ICT maintenance — every department";

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
        roles: { create: [{ kind: "STAFF" }] },
      },
    });
  }

  const existing = await prisma.accessView.findFirst({ where: { name: ICT_VIEW_NAME }, include: { audiences: true } });
  if (existing) {
    // prisma/seed.ts wipes users, which cascades away the person audience but not the
    // view — re-attach the (new) officer so a reseed doesn't leave it assigned to no one.
    if (!existing.audiences.some((a) => a.type === "PERSON" && a.personId === officer.id)) {
      await prisma.accessViewAudience.create({ data: { viewId: existing.id, type: "PERSON", personId: officer.id } });
    }
  } else {
    await prisma.accessView.create({
      data: {
        name: ICT_VIEW_NAME,
        description: "Read-only: every unit's devices, to find what needs maintenance and plan for it.",
        scope: "UNIVERSITY",
        canEdit: false,
        active: true,
        audiences: { create: [{ type: "PERSON", personId: officer.id }] },
      },
    });
  }
  console.log(`  ICT Maintenance Office (ICT) · ${ICT_EMAIL} · view "${ICT_VIEW_NAME}" (university-wide, read only)`);
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
