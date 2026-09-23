import { execSync } from "node:child_process";
import { TEST_DB, testDatabaseUrl } from "./db";

/**
 * Makes sure `lrms_v2_test` exists, is migrated, and has the base seed (the SYS_ADMIN
 * and the org chart several specs read), before any spec runs. Idempotent: creating an
 * existing database fails harmlessly, `migrate deploy` only applies what's missing,
 * and the seed runs only when the database has no admin yet.
 */
export default function setup(): void {
  const url = testDatabaseUrl();
  const admin = new URL(url);
  admin.pathname = "/postgres";
  admin.search = "";
  const env = { ...process.env, DATABASE_URL: url, DIRECT_URL: url };
  const quiet = { stdio: "pipe" as const, env };

  try {
    execSync(`npx prisma db execute --stdin --url "${admin}"`, { ...quiet, input: `CREATE DATABASE ${TEST_DB};` });
  } catch {
    // already exists
  }
  execSync("npx prisma migrate deploy", quiet);

  const probe = `import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
p.userRole.count({ where: { kind: "SYS_ADMIN" } }).then((n) => { console.log(n); return p.$disconnect(); });`;
  const admins = Number(execSync(`npx tsx -e "${probe.replace(/"/g, '\\"').replace(/\n/g, " ")}"`, quiet).toString().trim().split(/\s+/).pop());
  if (!admins) execSync("npx tsx prisma/seed.ts", quiet);
  execSync("npx tsx test/seed-fixture.ts", quiet);
}
