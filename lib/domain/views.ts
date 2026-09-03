/**
 * Access views — what an administrator hands to a kind of person. Ported from
 * temp_works/src/lib/views.ts, verbatim.
 *
 * A view is authored the way a category is: named, saved, and assigned to an
 * audience. It answers two questions and no others — WHICH RESOURCES (a `ScopeMode`,
 * optionally narrowed further by a saved filter built with the ordinary filter bar)
 * and MAY THEY EDIT (a single flag, not a matrix). It deliberately does NOT choose
 * columns — an earlier sandbox iteration let a view pick visible fields and dashboard
 * widgets, and that projection layer was most of what had to be deleted. Scope
 * decides which ROWS a person may see; the columns are the same for everyone.
 *
 * Assignment is by role, with per-person entries for exceptions. A person entry
 * outranks a role entry, so one custodian can be given something wider without
 * inventing a role for them.
 */
import { EMPTY_FILTERS, type FilterState } from "./filters";
import type { Person } from "./types";
import type { RoleKind } from "@/lib/shared";

export type ScopeMode =
  /** Everything. The borrow/browse surface, and how the property office works. */
  | "UNIVERSITY"
  /** The person's org reach — their node and everything under it. */
  | "ORG_SUBTREE"
  /** Only what this person is personally accountable for. */
  | "MY_CUSTODY"
  /** A hand-picked set of units, for a view an admin has drawn deliberately. */
  | "EXPLICIT_NODES";

export type ViewAudience =
  | { type: "ROLE"; role: RoleKind }
  | { type: "PERSON"; personId: string }
  /** Available to anyone signed in — how the browse view reaches everybody. */
  | { type: "EVERYONE" };

export interface AccessView {
  id: string;
  name: string;
  description?: string;
  scope: ScopeMode;
  /** EXPLICIT_NODES only. */
  explicitNodeIds?: string[];
  /** A saved query, applied on top of the scope. Authored with the filter bar. */
  extraFilters?: FilterState;
  audiences: ViewAudience[];
  /** false = look but do not touch. The borrow surface is the reason this exists. */
  canEdit: boolean;
  active: boolean;
}

function audienceMatches(audience: ViewAudience, person: Person): boolean {
  if (audience.type === "EVERYONE") return true;
  if (audience.type === "PERSON") return audience.personId === person.id;
  return (person.roles ?? []).includes(audience.role);
}

/**
 * Roles from most specific to least — the SAME ordering approvals.ts's policy
 * resolver ranks by (duplicated here rather than imported, since the two modules
 * must never disagree about it and each is small enough to keep the constant local
 * without real drift risk — see approvals.ts's own copy for the full rationale).
 */
const ROLE_SPECIFICITY: RoleKind[] = ["SYS_ADMIN", "PROPERTY_ADMIN", "PROCUREMENT", "STORE_KEEPER", "MANAGER", "CUSTODIAN", "STAFF", "STUDENT", "EXTERNAL"];

function roleRank(role: RoleKind): number {
  const at = ROLE_SPECIFICITY.indexOf(role);
  return at === -1 ? 1 : ROLE_SPECIFICITY.length - at;
}

/**
 * A named person outranks any role, and any role outranks "everyone". Ranking roles
 * by specificity rather than sorting views by name is not cosmetic: a custodian who
 * is also staff would otherwise land on whichever view sorted first alphabetically,
 * and if that were the read-only staff view, every custodian in the institution
 * would open the register unable to touch their own laboratory.
 */
function specificity(view: AccessView, person: Person): number {
  let best = 0;
  for (const a of view.audiences) {
    if (!audienceMatches(a, person)) continue;
    const weight = a.type === "PERSON" ? 1000 : a.type === "ROLE" ? 100 + roleRank(a.role) : 1;
    best = Math.max(best, weight);
  }
  return best;
}

/** Every view this person may choose between, most specific first. Order matters:
 *  the first is what they land on, and a view written for them personally should
 *  outrank one written for their whole role. */
export function viewsForPerson(person: Person | undefined, views: AccessView[]): AccessView[] {
  if (!person) return [];
  return views.filter((v) => v.active && specificity(v, person) > 0).sort((a, b) => specificity(b, person) - specificity(a, person) || a.name.localeCompare(b.name));
}

export function defaultViewFor(person: Person | undefined, views: AccessView[]): AccessView | undefined {
  return viewsForPerson(person, views)[0];
}

/** The one a person is actually using: their pick if still valid, else their default. */
export function resolveView(person: Person | undefined, views: AccessView[], chosenId: string | null): AccessView | undefined {
  const available = viewsForPerson(person, views);
  return available.find((v) => v.id === chosenId) ?? available[0];
}

export const SCOPE_LABEL: Record<ScopeMode, string> = {
  UNIVERSITY: "University-wide",
  ORG_SUBTREE: "My unit and below",
  MY_CUSTODY: "In my custody",
  EXPLICIT_NODES: "Selected units",
};

export const SCOPE_HELP: Record<ScopeMode, string> = {
  UNIVERSITY: "Every resource in the institution.",
  ORG_SUBTREE: "The unit this person belongs to, and everything under it.",
  MY_CUSTODY: "Only what they are named custodian of, plus its contents.",
  EXPLICIT_NODES: "A fixed list of units, whoever the person is.",
};

export const BROWSE_VIEW_ID = "view-browse";

/**
 * The views an institution starts with — one per stakeholder level, plus the
 * university-wide browse surface everybody gets. The browse view is the answer to
 * the problem this whole system exists for: before anyone buys a second one, they
 * can see whether the university already owns one and ask for it instead. It is
 * deliberately `canEdit: false` — you may look into every department, and the only
 * thing you may do about it is ask. Genuinely production seed content (a later
 * phase's prisma seed script writes these into AccessView rows), kept here rather
 * than split out, matching temp_works' own layout — same reasoning as
 * approvals.ts's SEED_POLICIES.
 */
export const SEED_VIEWS: AccessView[] = [
  {
    id: "view-custodian",
    name: "My laboratories",
    description: "Only what this person is personally accountable for, and everything inside it.",
    scope: "MY_CUSTODY",
    audiences: [{ type: "ROLE", role: "CUSTODIAN" }],
    canEdit: true,
    active: true,
  },
  {
    id: "view-manager",
    name: "My unit and below",
    description: "A head sees their department; a dean sees every department under the college.",
    scope: "ORG_SUBTREE",
    audiences: [{ type: "ROLE", role: "MANAGER" }],
    canEdit: true,
    active: true,
  },
  {
    id: "view-office",
    name: "Whole university",
    description: "Property administration holds the register, and procurement must see every existing item to judge a purchase.",
    scope: "UNIVERSITY",
    audiences: [{ type: "ROLE", role: "PROPERTY_ADMIN" }, { type: "ROLE", role: "PROCUREMENT" }, { type: "ROLE", role: "SYS_ADMIN" }],
    canEdit: true,
    active: true,
  },
  {
    id: "view-store",
    name: "The stores",
    description: "A store keeper works across every department's incoming goods, so their reach is the whole institution.",
    scope: "UNIVERSITY",
    audiences: [{ type: "ROLE", role: "STORE_KEEPER" }],
    canEdit: true,
    active: true,
  },
  {
    id: "view-staff",
    name: "My department",
    description: "Staff and instructors see their own department's register, read only.",
    scope: "ORG_SUBTREE",
    audiences: [{ type: "ROLE", role: "STAFF" }],
    canEdit: false,
    active: true,
  },
  {
    id: BROWSE_VIEW_ID,
    name: "Browse university-wide",
    description: "What every department holds, so you can ask to borrow instead of buying a second one. Read only.",
    scope: "UNIVERSITY",
    audiences: [{ type: "EVERYONE" }],
    canEdit: false,
    active: true,
  },
];

export function emptyView(id: string): AccessView {
  return {
    id,
    name: "",
    scope: "ORG_SUBTREE",
    extraFilters: EMPTY_FILTERS,
    audiences: [],
    canEdit: true,
    active: true,
  };
}
