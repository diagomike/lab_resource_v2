import type { MeContextDto, RoleKind } from "@/lib/shared";

/**
 * Who reads which Help chapter (the chapters are built from docs/user-guide by
 * scripts/build-help.mjs into public/help/content.json).
 *
 * Everyone gets the general chapters. The role chapters follow what a person actually
 * does: their roles, and — because a department head, a dean, the AVP and the College
 * Managing Director all hold the same MANAGER role — the post they occupy. A system
 * administrator sees every chapter. This decides what the Help shows, not what anyone
 * may do; the guide itself is not sensitive.
 */

export const GENERAL_CHAPTERS = ["welcome", "getting-started", "concepts", "appendix"] as const;

/** Every chapter the build produces, in order (checked against public/help/content.json by the spec). */
export const ALL_CHAPTER_IDS = ["welcome", "getting-started", "concepts", "custodian", "head", "staff", "student", "dean-avp", "procurement", "store-keeper", "ict-maintenance", "system-admin", "property-admin", "portal", "appendix"];

export function helpChaptersFor(me: MeContextDto | null | undefined, allChapterIds: string[] = ALL_CHAPTER_IDS): Set<string> {
  const roles: RoleKind[] = me?.user.roles ?? [];
  if (roles.includes("SYS_ADMIN")) return new Set(allChapterIds);

  const out = new Set<string>(GENERAL_CHAPTERS);
  const has = (r: RoleKind) => roles.includes(r);
  const scope = me?.scope ?? null;

  if (has("CUSTODIAN")) out.add("custodian");
  if (has("STAFF")) out.add("staff");
  if (has("STUDENT")) out.add("student");
  if (has("PROCUREMENT")) out.add("procurement");
  if (has("STORE_KEEPER")) out.add("store-keeper");
  if (has("PROPERTY_ADMIN")) out.add("property-admin");
  if (has("EXTERNAL")) out.add("portal");

  if (has("MANAGER")) {
    const post = scope?.isOccupant ? scope.kind : null;
    if (post === "COLLEGE" || post === "UNIVERSITY" || (post === "OFFICE" && scope?.code === "CMD")) {
      out.add("dean-avp");
      // The AVP turns outside institutions' requests into quotes, so the portal chapter is theirs too.
      if (post === "UNIVERSITY") out.add("portal");
    } else {
      out.add("head");
    }
  }

  // The ICT maintenance office: a read-only, university-wide access view (or the ICT post itself).
  const readOnlyUniversityView = (me?.views ?? []).some((v) => v.scope === "UNIVERSITY" && !v.canEdit);
  if (scope?.code === "ICT" || readOnlyUniversityView) out.add("ict-maintenance");

  return out;
}

/**
 * The Help for a screen: each app path lists the guide sections that explain it, the
 * most role-specific first. The first one the person can read wins; otherwise the Help
 * opens on its contents. Section ids are "<chapter>--<heading slug>" from the build.
 */
const SCREEN_SECTIONS: Array<[string, string[]]> = [
  ["/dashboard", ["custodian--1-your-dashboard", "head--1-your-dashboard-and-register", "ict-maintenance--1-your-dashboard", "store-keeper--3-your-dashboard", "procurement--4-university-wide-view", "property-admin--1-university-wide-view", "staff--1-look-things-up"]],
  ["/register", ["custodian--2-the-register", "ict-maintenance--3-build-a-maintenance-list", "store-keeper--2-hand-over-to-a-lab", "head--1-your-dashboard-and-register", "staff--1-look-things-up", "system-admin--6-corrections-and-the-change-log"]],
  ["/university", ["custodian--13-university-resources-and-transfers"]],
  ["/schedule", ["custodian--10-bookings-of-your-labs", "staff--2-book-a-lab"]],
  ["/external-requests", ["dean-avp--2-external-requests-avp", "head--10-external-requests", "custodian--15-hold-a-slot-for-an-outside-request"]],
  ["/lab-states", ["custodian--7-updates-in-a-drafts-department", "head--2-decide-lab-updates-and-ideals"]],
  ["/approvals", ["dean-avp--1-purchase-requests", "procurement--1-approve-a-request", "head--2-decide-lab-updates-and-ideals", "custodian--14-accept-a-handover", "student--what-you-see"]],
  ["/purchasing", ["head--5-compile-a-purchase-request", "procurement--2-your-pipeline", "store-keeper--1-receive-arrived-stock", "custodian--12-raise-a-need", "staff--5-raise-a-need"]],
  ["/change-log", ["head--3-the-change-log", "system-admin--6-corrections-and-the-change-log"]],
  ["/categories", ["system-admin--4-categories", "property-admin--2-categories"]],
  ["/admin/dashboard", ["system-admin--1-overview"]],
  ["/admin/org-structure", ["system-admin--2-org-structure"]],
  ["/admin/people", ["system-admin--3-people--roles", "head--7-your-people"]],
  ["/admin/access-views", ["system-admin--5-access-views", "property-admin--3-access-views"]],
  ["/me/profile", ["getting-started--7-your-profile"]],
];

/** The Help link for the screen at `pathname`, for a person who can read `visible`. */
export function helpHrefFor(pathname: string, visible: Set<string>): string {
  const entry = SCREEN_SECTIONS.find(([p]) => pathname === p || pathname.startsWith(p + "/"));
  const section = entry?.[1].find((s) => visible.has(s.split("--")[0]));
  return section ? `/help?c=${section.split("--")[0]}#${section}` : "/help";
}

/** Every section id the screen map points at — the build check in lib/help/audience.spec.ts. */
export const SCREEN_SECTION_IDS = SCREEN_SECTIONS.flatMap(([, s]) => s);
