// Aliased in place of the `server-only` package for Vitest (vitest.config.ts) — that
// package throws unconditionally on import, relying on a bundler's server/client
// export-condition aliasing that Vitest, running as a plain Node process, does not apply.
// This repo's testing discipline (pure logic only) never imports a guarded file directly
// today; this shim is insurance against a future test doing so.
export {};
