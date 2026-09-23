import fs from "node:fs";

/**
 * The database the test suite uses: `.env`'s Postgres server, but the separate database
 * `lrms_v2_test` — never the dev database `lrms_v2`. The DB-backed specs create
 * `__test-*` users, org nodes and categories; before 2026-09-23 they fell back to
 * `.env`'s DATABASE_URL, and every interrupted run left its fixtures in the dev data.
 */
export const TEST_DB = "lrms_v2_test";

export function testDatabaseUrl(): string {
  const raw = fs.readFileSync(new URL("../.env", import.meta.url), "utf8");
  const base = raw.match(/^DATABASE_URL="?([^"\r\n]+)"?/m)?.[1];
  if (!base) throw new Error("DATABASE_URL missing from .env");
  const url = new URL(base);
  url.pathname = `/${TEST_DB}`;
  return url.toString();
}
