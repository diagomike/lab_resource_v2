import "server-only";
import { assertCanBrowseUniversity, type ScopeOverride } from "./scope";

/**
 * The register's one read override (2026-10-01, replacing access views): every signed-in
 * internal account may read the whole university — `?scope=UNIVERSITY` — and otherwise
 * reads its own default scope (its unit, or its custody). Writes are untouched by this:
 * they follow role and custody (mutate.ts), never what a person can see.
 */
export interface ReadOverride {
  scope?: ScopeOverride;
}

export async function resolveReadOverride(userId: string, sp: URLSearchParams): Promise<ReadOverride> {
  if (sp.get("scope") !== "UNIVERSITY") return {};
  await assertCanBrowseUniversity(userId);
  return { scope: { mode: "UNIVERSITY" } };
}
