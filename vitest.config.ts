import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { testDatabaseUrl } from "./test/db";

/**
 * One config for every pure-logic test in the app — the same "test pure logic only"
 * discipline the pre-conversion NestJS/Vite apps' Jest/Vitest setups both followed. The
 * `server-only` alias exists so a `lib/server/**` file (every one of which starts with
 * `import "server-only"`, see the conversion plan §2) can be imported by a test without
 * that import throwing — Vitest runs as a plain Node process and does not apply Next's
 * bundler-level server/client export-condition aliasing.
 *
 * `@/*` mirrors tsconfig.json's own path mapping (`"@/*": ["./*"]`) — Vitest does not
 * read tsconfig paths automatically, and lib/domain/**'s specs are the first ones to
 * import across directories with the `@/` alias rather than a relative path.
 */
export default defineConfig({
  resolve: {
    alias: {
      "server-only": fileURLToPath(new URL("./test/empty-shim.ts", import.meta.url)),
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    include: ["**/*.spec.ts"],
    exclude: ["node_modules/**", ".next/**"],
    // Most of these specs are DB-backed against one real, shared, non-transactional
    // Postgres instance (see mutate.spec.ts's own header on why: some of what's
    // proven here is a race that only a real database can show). Running spec
    // FILES concurrently (Vitest's default) was safe only because every file kept
    // to its own uniquely-named orphan fixtures — until org.spec.ts (F-003 of the
    // 2026-09-15 campaign fix round) started exercising org.ts's structural
    // functions, whose closure recompute has always rebuilt the WHOLE OrgClosure
    // table, not just one file's own rows. Two files' fixture teardowns/writes
    // landing at the same moment then surfaces as a real, intermittent Postgres
    // deadlock or FK error — not a bug in either file, just two independent
    // transactions racing the same shared tables. Sequential file execution is the
    // fix: it costs some wall-clock time (this suite is DB-round-trip-bound, not
    // CPU-bound, so the loss is real but not dramatic) in exchange for the whole
    // suite being deterministic instead of occasionally, spuriously red.
    fileParallelism: false,
    // Never the dev database: every DB-backed spec runs against lrms_v2_test, created,
    // migrated and seeded by test/global-setup.ts (2026-09-23 — `__test-*` fixtures from
    // interrupted runs had piled up in lrms_v2).
    globalSetup: ["./test/global-setup.ts"],
    env: { DATABASE_URL: testDatabaseUrl(), DIRECT_URL: testDatabaseUrl() },
  },
});
