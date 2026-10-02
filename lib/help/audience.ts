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
export const ALL_CHAPTER_IDS = ["welcome", "getting-started", "concepts", "custodian", "head", "adaa", "dean-avp", "procurement", "store-keeper", "system-admin", "property-admin", "portal", "appendix"];

export function helpChaptersFor(me: MeContextDto | null | undefined, allChapterIds: string[] = ALL_CHAPTER_IDS): Set<string> {
  const roles: RoleKind[] = me?.user.roles ?? [];
  if (roles.includes("SYS_ADMIN")) return new Set(allChapterIds);

  const out = new Set<string>(GENERAL_CHAPTERS);
  const has = (r: RoleKind) => roles.includes(r);
  const scope = me?.scope ?? null;

  if (has("CUSTODIAN")) out.add("custodian");
  if (has("ADAA")) out.add("adaa");
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
    } else if (post !== "OFFICE") {
      out.add("head");
    }
  }

  return out;
}

/**
 * The Help for a screen: each app path lists the guide sections that explain it, the
 * most role-specific first. The first one the person can read wins; otherwise the Help
 * opens on its contents. Section ids are "<chapter>--<heading slug>" from the build.
 */
const SCREEN_SECTIONS: Array<[string, string[]]> = [
  // The office chapters come first: only the people in that office (and the admin) read
  // them, so they never shadow someone else's section.
  ["/home", ["system-admin--1-home", "property-admin--1-university-wide-view", "adaa--1-your-home", "head--1-your-home", "custodian--1-your-home", "getting-started--5-home"]],
  ["/register", ["system-admin--5-corrections-and-history", "property-admin--1-university-wide-view", "procurement--4-university-wide-view", "store-keeper--2-move-stock-to-a-lab", "adaa--3-resources-insights-and-history", "custodian--3-resources", "getting-started--7-find-your-way-around"]],
  ["/places", ["property-admin--2-the-main-store", "adaa--2-the-colleges-stores", "head--3-labs--stores", "custodian--2-your-labs", "concepts--places-and-the-things-inside-them"]],
  ["/schedule", ["custodian--8-bookings-of-your-labs", "custodian--9-weekly-classes"]],
  ["/approvals", ["property-admin--4-approving-movements", "procurement--1-approve-a-request", "dean-avp--1-purchase-requests", "head--2-decide-lab-changes", "custodian--10-moving-things", "appendix--who-approves-what"]],
  ["/purchasing", ["property-admin--3-import-records", "procurement--2-your-pipeline", "store-keeper--1-load-an-import-record", "head--4-the-labs-needs", "custodian--7-ask-for-something", "dean-avp--1-purchase-requests"]],
  ["/external-requests", ["dean-avp--3-outside-requests", "head--11-outside-requests", "custodian--11-outside-requests"]],
  ["/categories", ["system-admin--4-categories", "property-admin--5-categories", "adaa--4-categories", "head--8-categories", "custodian--12-categories", "concepts--categories-belong-to-the-department-that-made-them"]],
  ["/dashboard", ["property-admin--1-university-wide-view", "procurement--4-university-wide-view", "adaa--3-resources-insights-and-history", "head--10-history-and-insights", "getting-started--7-find-your-way-around"]],
  ["/change-log", ["system-admin--5-corrections-and-history", "adaa--3-resources-insights-and-history", "head--10-history-and-insights"]],
  ["/admin/org-structure", ["system-admin--2-organisation"]],
  ["/admin/people", ["system-admin--3-people--roles", "head--9-your-people"]],
  ["/me/profile", ["getting-started--9-your-profile"]],
];

/** The Help link for the screen at `pathname`, for a person who can read `visible`. */
export function helpHrefFor(pathname: string, visible: Set<string>): string {
  const entry = SCREEN_SECTIONS.find(([p]) => pathname === p || pathname.startsWith(p + "/"));
  const section = entry?.[1].find((s) => visible.has(s.split("--")[0]));
  return section ? `/help?c=${section.split("--")[0]}#${section}` : "/help";
}

/** Every section id the screen map points at — the build check in lib/help/audience.spec.ts. */
export const SCREEN_SECTION_IDS = SCREEN_SECTIONS.flatMap(([, s]) => s);
