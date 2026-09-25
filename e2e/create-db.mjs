// Creates the clone database lrms_v2_e2e (drops it first with --reset). Clone only.
import { execSync } from "node:child_process";
import fs from "node:fs";
const raw = fs.readFileSync(new URL("../.env", import.meta.url), "utf8");
const base = raw.match(/^DATABASE_URL="?([^"\r\n]+)"?/m)[1];
const admin = new URL(base); admin.pathname = "/postgres"; admin.search = "";
const run = (sql) => execSync(`npx prisma db execute --stdin --url "${admin}"`, { input: sql, stdio: ["pipe", "inherit", "inherit"] });
if (process.argv.includes("--reset")) {
  // DROP DATABASE cannot run inside a transaction block, and `prisma db execute`
  // wraps multi-statement stdin in one — so these need two separate calls.
  run(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='lrms_v2_e2e';`);
  run(`DROP DATABASE IF EXISTS lrms_v2_e2e;`);
}
run(`CREATE DATABASE lrms_v2_e2e;`);
console.log("created lrms_v2_e2e");
