#!/usr/bin/env node
/**
 * E2E campaign wrapper (docs/e2e-findings-2026-09-15.md): runs any command against the
 * CLONE database `lrms_v2_e2e`, never the real local `lrms_v2`. The clone URL is derived
 * from .env at run time so no credential is written into a tracked file.
 *
 *   node e2e/with-env.mjs npx prisma migrate deploy
 *   node e2e/with-env.mjs npx next dev -p 3100
 */
import { spawn } from "node:child_process";
import fs from "node:fs";

const CLONE_DB = "lrms_v2_e2e";
const raw = fs.readFileSync(new URL("../.env", import.meta.url), "utf8");
const get = (k) => raw.match(new RegExp(`^${k}="?([^"\r\n]+)"?`, "m"))?.[1];
const swapDb = (u, db) => { const x = new URL(u); x.pathname = `/${db}`; return x.toString(); };

const base = get("DATABASE_URL");
if (!base) throw new Error("DATABASE_URL missing from .env");
const target = process.env.E2E_DB ?? CLONE_DB;
if (target === "lrms_v2") throw new Error("Refusing to target the real dev database.");

export const e2eEnv = {
  DATABASE_URL: swapDb(base, target),
  DIRECT_URL: swapDb(base, target),
  APP_ORIGIN: "http://localhost:3100",
  // Mail goes to the local SMTP sink (e2e/mail-sink.mjs), never Gmail.
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "2525",
  SMTP_SECURE: "false",
  SMTP_USER: "",
  SMTP_PASS: "",
  MAIL_FROM: "LRMS E2E <e2e@localhost>",
  IMAGE_STORAGE_DRIVER: "local",
  IMAGE_STORAGE_DIR: ".local-storage-e2e/images",
  CRON_SECRET: "e2e-cron-secret",
  UNIVERSITY_BANK_NAME: "Commercial Bank of Ethiopia",
  UNIVERSITY_BANK_ACCOUNT_NAME: "Adama Science and Technology University (TEST)",
  UNIVERSITY_BANK_ACCOUNT_NUMBER: "1000000000000",
  VERIFIER_DRIVER: "fake",
  PAYMENT_PROVIDERS: "CBE,TELEBIRR",
  PAYMENT_CBE_RECEIVER_ACCOUNT: "1000000000000",
  PAYMENT_TELEBIRR_RECEIVER_NAME: "Adama Science and Technology University",
};

{
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd) { console.log(Object.keys(e2eEnv).join("\n")); process.exit(0); }
  // mail.ts attaches SMTP auth only when SMTP_USER is non-empty.
  const env = { ...process.env, ...e2eEnv };
  // Empty strings (not unset) so Next's .env loading cannot re-add the real Gmail credentials.
  const child = spawn(cmd, args, { stdio: "inherit", env, shell: process.platform === "win32" });
  child.on("exit", (code) => process.exit(code ?? 1));
}
