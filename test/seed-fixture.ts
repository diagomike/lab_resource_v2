/**
 * Test-database-only people, added after prisma/seed.ts by test/global-setup.ts. Several
 * DB-backed specs were written against the old seed's Software Engineering cast
 * (`head.se@`, `custodian.se@`). The real seed no longer has them, and they must never
 * go back into the dev data, so they live here instead.
 */
import { PrismaClient } from "@prisma/client";
import * as argon2 from "@node-rs/argon2";
import { ensurePropertyOffice } from "../prisma/seed-property-office";
import { ensureCmdOffice } from "../prisma/seed-cmd-office";

if (!process.env.DATABASE_URL?.includes("lrms_v2_test")) throw new Error("test/seed-fixture.ts runs against lrms_v2_test only");
const prisma = new PrismaClient();

async function main() {
  const se = await prisma.orgNode.findFirstOrThrow({ where: { code: "SE" } });
  const passwordHash = await argon2.hash("astu1234");
  const person = async (email: string, name: string, roles: Array<"MANAGER" | "CUSTODIAN" | "STAFF">) => {
    const found = await prisma.user.findUnique({ where: { emailLower: email } });
    if (found) return prisma.user.update({ where: { id: found.id }, data: { name } });
    return prisma.user.create({ data: { email, emailLower: email, name, passwordHash, status: "ACTIVE", homeNodeId: se.id, roles: { create: roles.map((kind) => ({ kind })) } } });
  };
  // The names the specs search for — exactly the old seed's.
  const head = await person("head.se@astu.edu.et", "Head, Software Engineering", ["MANAGER", "STAFF"]);
  await person("custodian.se@astu.edu.et", "Girma Wolde", ["CUSTODIAN", "STAFF"]);
  await prisma.orgNode.update({ where: { id: se.id }, data: { userId: head.id } });
  // Added to the real seed after this database was first built — idempotent.
  await ensureCmdOffice(prisma);
  await ensurePropertyOffice(prisma);
  // purchasing.spec.ts parks the real offices while it runs its own; a run cut short
  // (a hook timeout) leaves them parked, which breaks every later chain that names them.
  await prisma.orgNode.updateMany({ where: { code: { in: ["PROC", "CMD", "PROP"] } }, data: { active: true } });
}

main().finally(() => prisma.$disconnect());
