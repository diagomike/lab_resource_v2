#!/usr/bin/env node
/**
 * Runs the E2E campaign suites (e2e/suites/*.ts) end to end on the CLONE database.
 *
 *   node e2e/reset-demo.mjs                        (fresh clone: migrations + seeds)
 *   node e2e/mail-sink.mjs                         (terminal 1 — mail lands in e2e/mail/)
 *   node e2e/with-env.mjs npx next dev -p 3100     (terminal 2, or the "e2e" launch config)
 *   node e2e/run-campaign.mjs                      (loads the fixture, mints sessions, runs every suite)
 *
 * `--no-fixture` skips the fixture and session minting (a re-run on the same clone).
 * Prints one line per case as each suite runs, then a summary from e2e/results.json.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";

const run = (cmd) => execSync(cmd, { stdio: "inherit" });
const wrap = (cmd) => `node e2e/with-env.mjs ${cmd}`;

if (!process.argv.includes("--no-fixture")) {
  run(wrap("npx tsx e2e/fixture.ts"));
  run(wrap("npx tsx e2e/mint-sessions.ts"));
}
if (fs.existsSync("e2e/results.json")) fs.rmSync("e2e/results.json");

const suites = fs.readdirSync("e2e/suites").filter((f) => f.endsWith(".ts")).sort();
for (const suite of suites) {
  console.log(`\n▶ ${suite}`);
  try {
    run(wrap(`npx tsx e2e/suites/${suite}`));
  } catch {
    console.log(`  (${suite} stopped early)`);
  }
}

const results = JSON.parse(fs.readFileSync("e2e/results.json", "utf8"));
const by = (r) => results.filter((x) => x.result === r);
console.log(`\n${results.length} cases: ${by("PASS").length} PASS, ${by("FAIL").length} FAIL, ${by("BLOCKED").length} BLOCKED, ${by("INFO").length} INFO`);
for (const r of [...by("FAIL"), ...by("BLOCKED")]) console.log(`  ${r.result === "FAIL" ? "✘" : "■"} ${r.id} ${r.title}`);
