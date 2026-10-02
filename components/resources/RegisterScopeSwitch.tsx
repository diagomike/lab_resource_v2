"use client";

import { useRouter } from "next/navigation";
import type { RoleKind } from "@/lib/shared";

/** Who may look across the whole university — the exact set
 *  `assertCanBrowseUniversity` permits (lib/server/resources/scope.ts). */
export const WHOLE_UNIVERSITY_ROLES: RoleKind[] = ["SYS_ADMIN", "PROPERTY_ADMIN", "PROCUREMENT", "MANAGER", "STORE_KEEPER", "CUSTODIAN"];

export function mayBrowseUniversity(roles: RoleKind[] | undefined): boolean {
  return !!roles?.some((r) => WHOLE_UNIVERSITY_ROLES.includes(r));
}

/**
 * The Register's two scopes, one page (2026-09-28 — "University resources" used to be a
 * page of its own):
 *  - Mine: what the person's own reach and access view show — where custodians edit;
 *  - Whole university: every unit's resources, read-only — where a lab finds what it
 *    needs and asks for it (a loan or a permanent transfer), and an office checks what
 *    the university already has before approving a purchase.
 * Switching starts the other view fresh; each keeps its own filters and layout.
 */
export function RegisterScopeSwitch({ scope }: { scope: "mine" | "university" }) {
  const router = useRouter();
  return (
    <div className="flex items-center gap-4" role="group" aria-label="Register scope">
      {(["mine", "university"] as const).map((s) => (
        <button
          key={s}
          type="button"
          aria-pressed={scope === s}
          onClick={() => scope !== s && router.push(s === "university" ? "/register?scope=university" : "/register")}
          style={{ background: scope === s ? "var(--accent)" : "var(--panel2)", color: scope === s ? "#fff" : "var(--dim)" }}
          className="border-0 text-11 font-medium px-9 py-4 rounded-2"
        >
          {s === "mine" ? "Mine" : "Whole university"}
        </button>
      ))}
    </div>
  );
}
