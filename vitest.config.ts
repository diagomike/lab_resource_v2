import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * One config for every pure-logic test in the app — the same "test pure logic only"
 * discipline apps/api's jest.config.js and apps/web's Vitest setup both followed before
 * the conversion. The `server-only` alias exists so a `lib/server/**` file (every one of
 * which starts with `import "server-only"`, see the conversion plan §2) can be imported
 * by a test without that import throwing — Vitest runs as a plain Node process and does
 * not apply Next's bundler-level server/client export-condition aliasing.
 */
export default defineConfig({
  resolve: {
    alias: {
      "server-only": fileURLToPath(new URL("./test/empty-shim.ts", import.meta.url)),
    },
  },
  test: {
    include: ["**/*.spec.ts"],
    exclude: ["node_modules/**", "apps/**", "packages/**", ".next/**"],
  },
});
