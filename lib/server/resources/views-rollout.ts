// Deliberately no `import "server-only"` — this needs to run from `prisma/seed-views.ts`
// via `tsx`, outside any bundler, the same reason `image-sniff.ts` carries no such
// guard either (see that file's own header). Every other function in this directory
// that needs one (`scope.ts`, `prisma.ts`) is off-limits to this module for the same
// reason; the tiny piece of `defaultModeFor` logic this needs is duplicated below
// rather than imported, exactly the trade-off `mutate.ts`'s own `itemCreateData`
// duplication already made.
import type { PrismaClient } from "@prisma/client";
import type { RoleKind, ScopeMode } from "@/lib/shared";
import { resolveView, type AccessView as DomainAccessView } from "@/lib/domain/views";
import type { Person } from "@/lib/domain/types";

const GLOBAL_ROLES: RoleKind[] = ["SYS_ADMIN", "PROPERTY_ADMIN", "PROCUREMENT"];

/** Duplicated from `scope.ts`'s `defaultModeFor` — see this file's own header. Kept
 *  to the three lines that logic actually is, so drift is easy to notice on review. */
function currentDefaultMode(roles: RoleKind[]): ScopeMode {
  if (roles.some((r) => GLOBAL_ROLES.includes(r))) return "UNIVERSITY";
  if (roles.includes("CUSTODIAN") && !roles.includes("MANAGER")) return "MY_CUSTODY";
  return "ORG_SUBTREE";
}

const SCOPE_BREADTH: Record<ScopeMode, number> = { UNIVERSITY: 3, ORG_SUBTREE: 2, EXPLICIT_NODES: 1, MY_CUSTODY: 0 };

export interface ViewRolloutPreviewRow {
  userId: string;
  userName: string;
  roles: RoleKind[];
  currentModeNoViews: ScopeMode;
  wouldLandOn: string | null;
  wouldLandOnMode: ScopeMode | null;
  wouldLandOnCanEdit: boolean | null;
  /** True when the candidate views would show this person LESS than their current
   *  (no-views) default — the number `seed-views.ts` refuses to proceed past without
   *  `--force`. Widening (e.g. STAFF's ORG_SUBTREE → a EXPLICIT_NODES view spanning
   *  more units) is never flagged; only narrowing is a rollout risk. */
  narrows: boolean;
}

/**
 * A dry-run report for rolling access views onto a live system with real accounts
 * already in it — every existing user, which view they would land on with these
 * CANDIDATE views in place (not yet written to the database), and whether that
 * narrows their reach versus today's plain `defaultModeFor` resolution (the
 * "zero views" behaviour every account has right now). `prisma/seed-views.ts` is the
 * only caller; it refuses to write anything until this report has been shown and
 * confirmed.
 */
export async function previewRollout(prisma: PrismaClient, candidates: DomainAccessView[]): Promise<ViewRolloutPreviewRow[]> {
  const users = await prisma.user.findMany({ where: { status: "ACTIVE" }, include: { roles: true } });
  const active = candidates.filter((v) => v.active);
  return users.map((u) => {
    const roles = u.roles.map((r) => r.kind);
    const person: Person = { id: u.id, name: u.name, homeOrgNodeId: null, roles };
    const currentMode = currentDefaultMode(roles);
    const landed = resolveView(person, active, null);
    const narrows = landed ? SCOPE_BREADTH[landed.scope] < SCOPE_BREADTH[currentMode] : false;
    return {
      userId: u.id,
      userName: u.name,
      roles,
      currentModeNoViews: currentMode,
      wouldLandOn: landed?.name ?? null,
      wouldLandOnMode: landed?.scope ?? null,
      wouldLandOnCanEdit: landed?.canEdit ?? null,
      narrows,
    };
  });
}
