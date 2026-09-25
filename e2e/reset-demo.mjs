#!/usr/bin/env node
/**
 * Resets the E2E clone (lrms_v2_e2e, never the dev DB) to the clean starting point of the
 * cross-role walkthrough (docs/walkthrough/): the real CSE and Chemical Engineering data,
 * every role account, the College Managing Director and ICT offices, and the approval
 * policies. Nothing from a previous demo run survives.
 *
 *   node e2e/reset-demo.mjs
 *
 * Stop the :3100 app first (`DROP DATABASE` refuses while it holds connections — the
 * reset terminates them, but a running `next dev` reconnects and keeps stale caches).
 * Then start it again and the mail sink:
 *
 *   node e2e/mail-sink.mjs                          (terminal 1 — mail lands in e2e/mail/)
 *   node e2e/with-env.mjs npx next dev -p 3100      (terminal 2)
 *
 * Every account's password is astu1234. Invited accounts (the walkthrough's MT CSE Staff)
 * register through the link in their invitation email, found in e2e/mail/.
 */
import { execSync } from "node:child_process";

const step = (label, cmd) => {
  console.log(`\n▶ ${label}`);
  execSync(cmd, { stdio: "inherit" });
};

step("Recreate the clone database", "node e2e/create-db.mjs --reset");
step("Apply every migration", "node e2e/with-env.mjs npx prisma migrate deploy");
step("Org chart and role accounts (incl. CMD and ICT offices)", "node e2e/with-env.mjs npx tsx prisma/seed.ts");
step("Categories, the CSE and ChemE labs, the Main Store", "node e2e/with-env.mjs npx tsx prisma/resource-seed.ts");
step("Approval policies", "node e2e/with-env.mjs npx tsx prisma/seed-policies.ts --apply");

console.log(`
✓ The demo clone is reset. Next:
  1. node e2e/mail-sink.mjs
  2. node e2e/with-env.mjs npx next dev -p 3100
  3. Open http://localhost:3100 and follow docs/walkthrough/ from Act 1.`);
