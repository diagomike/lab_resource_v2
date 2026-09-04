/**
 * The production-safe counterpart to `prisma/seed.ts` — that script wipes every
 * User/OrgNode/Session before rebuilding them, which is exactly right for a dev
 * database and exactly wrong for a real one. This does the ONE thing a brand-new
 * production database actually needs: a SYS_ADMIN account to sign in with and the
 * UNIVERSITY root node to start the org chart from. Everything else — colleges,
 * departments, offices, personnel, resources — gets built through the app itself,
 * by real custodians, which is the whole point of this rollout.
 *
 * Idempotent by UPSERT, never delete — safe to re-run (a redeploy, a retry after a
 * partial failure, a deliberate password reset for the bootstrap account). Never
 * wipes anything, so it carries none of `seed.ts`'s risk and needs no
 * NODE_ENV=production guard; the guard would be backwards here.
 *
 * Credentials come from the environment, never hardcoded — this script is meant to
 * run against a real institution's real database.
 *
 *   BOOTSTRAP_ADMIN_EMAIL     (required)
 *   BOOTSTRAP_ADMIN_PASSWORD  (required)
 *   BOOTSTRAP_ADMIN_NAME      (optional, default "System Administrator")
 *   BOOTSTRAP_UNIVERSITY_NAME (optional, default "Adama Science and Technology University")
 *   BOOTSTRAP_UNIVERSITY_CODE (optional, default "ASTU" — the OrgNode.code upsert key)
 *
 * Run once against production after `prisma migrate deploy`:
 *
 *   npx tsx prisma/bootstrap.ts
 */
import { PrismaClient } from "@prisma/client";
// @node-rs/argon2 — see lib/server/auth/auth.ts's own note on why, not the `argon2`
// package.
import * as argon2 from "@node-rs/argon2";

const prisma = new PrismaClient();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is required — set it in the environment before running prisma/bootstrap.ts.`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const adminEmail = requireEnv("BOOTSTRAP_ADMIN_EMAIL");
  const adminPassword = requireEnv("BOOTSTRAP_ADMIN_PASSWORD");
  const adminName = process.env.BOOTSTRAP_ADMIN_NAME ?? "System Administrator";
  const universityName = process.env.BOOTSTRAP_UNIVERSITY_NAME ?? "Adama Science and Technology University";
  const universityCode = process.env.BOOTSTRAP_UNIVERSITY_CODE ?? "ASTU";
  const emailLower = adminEmail.toLowerCase();

  console.log("Bootstrapping…");

  const passwordHash = await argon2.hash(adminPassword);
  const admin = await prisma.user.upsert({
    where: { emailLower },
    update: {},
    create: {
      email: adminEmail,
      emailLower,
      name: adminName,
      passwordHash,
      status: "ACTIVE",
      roles: { create: [{ kind: "SYS_ADMIN" }] },
    },
  });
  // Upsert's `update: {}` leaves an EXISTING admin's password untouched on a
  // re-run — a re-run must not silently reset a real admin's credentials just
  // because the deploy step ran again. Reset it explicitly, only if asked to.
  if (process.env.BOOTSTRAP_ADMIN_RESET_PASSWORD === "true") {
    await prisma.user.update({ where: { id: admin.id }, data: { passwordHash } });
    console.log(`  Password reset for existing admin ${adminEmail}.`);
  }
  const hasSysAdminRole = await prisma.userRole.findFirst({ where: { userId: admin.id, kind: "SYS_ADMIN" } });
  if (!hasSysAdminRole) {
    await prisma.userRole.create({ data: { userId: admin.id, kind: "SYS_ADMIN" } });
  }

  const university = await prisma.orgNode.upsert({
    where: { code: universityCode },
    update: {},
    create: { name: universityName, level: 0, kind: "UNIVERSITY", code: universityCode },
  });

  console.log(`  SYS_ADMIN: ${adminEmail} (id ${admin.id})`);
  console.log(`  UNIVERSITY root: "${university.name}" (id ${university.id}, code ${universityCode})`);
  console.log("Done — sign in and build the org chart from here.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
