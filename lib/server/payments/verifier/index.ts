import "server-only";
import type { VerifierDriver } from "./driver";
import { fakeVerifierDriver } from "./fake-driver";
import { httpVerifierDriver } from "./http-driver";

/**
 * The verifier is chosen here, once, by `VERIFIER_DRIVER` — the same shape as
 * `resources/storage/index.ts`. `http` (the default) is the self-hosted verifier-api;
 * `fake` never reaches a bank. Resolved lazily so a missing URL only fails the payment
 * attempt that needed it, never app start-up.
 */
function selectDriver(): VerifierDriver {
  const kind = process.env.VERIFIER_DRIVER ?? "http";
  switch (kind) {
    case "fake":
      return fakeVerifierDriver;
    case "http": {
      const base = process.env.VERIFIER_BASE_URL;
      const key = process.env.VERIFIER_API_KEY;
      if (!base || !key) {
        return { verify: async () => ({ ok: false, reason: "Automatic payment verification is not set up yet.", unavailable: true }) };
      }
      return httpVerifierDriver(base, key);
    }
    default:
      throw new Error(`Unknown VERIFIER_DRIVER "${kind}" — use "http" or "fake".`);
  }
}

export function verifier(): VerifierDriver {
  return selectDriver();
}
export type { Receipt, VerifierDriver, VerifyQuery, VerifyResult } from "./driver";
