import type { RoleKind } from "@/lib/shared";

/**
 * ONE flat navigation for everyone — replacing the four-workspace model
 * (WorkspaceKind, workspacesFor(), the workspace switcher) per
 * ~/.claude/plans/wait-i-want-gentle-haven.md's Phase 5. What differs per person is
 * their access view and server-enforced scope (see Sidebar.tsx's scope panel), not
 * which menu they get: a custodian and a dean both see "Register" — the ROWS inside
 * it differ, resolved server-side, never by hiding the nav item.
 *
 * `roles` still exists on a handful of items (Administration's three screens) for the
 * same reason it always did: those are genuinely role-restricted actions (only
 * SYS_ADMIN administers the org chart), not scope-narrowed data. Every other item
 * omits `roles` on purpose.
 *
 * EVERY item carries a META subtitle, rendered by ContentHeader — a one-line
 * description of what the screen is for, not decoration.
 */

export interface NavItem {
  key: string;
  label: string;
  icon: string;
  path: string;
  /** Visible when the user holds ANY of these roles. Omit (or leave empty) for
   *  "everyone signed in" — true of every item except Administration's. */
  roles?: RoleKind[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: "Resources",
    items: [
      // F-031 of the 2026-09-15 campaign: the asset register (and its history, the
      // change log below) is staff/custodian/procurement territory — a student or
      // external account never reaches the underlying routes now either
      // (STAFF_ROLES, lib/server/auth/session.ts). Hiding the entry here is
      // convenience on top of that real enforcement, same discipline every other
      // role-gated item in this file already follows.
      { key: "dashboard", label: "Dashboard", icon: "▦", path: "/dashboard", roles: ["SYS_ADMIN", "PROPERTY_ADMIN", "PROCUREMENT", "MANAGER", "CUSTODIAN", "STORE_KEEPER"] },
      { key: "register", label: "Register", icon: "▤", path: "/register", roles: ["SYS_ADMIN", "PROPERTY_ADMIN", "PROCUREMENT", "MANAGER", "CUSTODIAN", "STORE_KEEPER"] },
      // "University resources" is the Register's "Whole university" scope since
      // 2026-09-28 (RegisterScopeSwitch); /university redirects there.
      // Track 6 — lab calendars. Students are booked for by their advisor, so the
      // screen is for the roles the booking service itself accepts.
      { key: "schedule", label: "Schedule", icon: "◴", path: "/schedule", roles: ["SYS_ADMIN", "MANAGER", "CUSTODIAN"] },
      // Track 7 — outside institutions' requests. The service decides what each person
      // sees (all of them for the AVP's office, their department's for heads/custodians).
      { key: "external-requests", label: "External requests", icon: "⇲", path: "/external-requests", roles: ["SYS_ADMIN", "MANAGER", "CUSTODIAN"] },
      // Labs and stores: heads, the ADAA and Property Administration manage them; a
      // custodian runs theirs (their contents and changes) — lib/server/resources/places.ts.
      { key: "places", label: "Labs & stores", icon: "⧉", path: "/places", roles: ["SYS_ADMIN", "PROPERTY_ADMIN", "MANAGER", "ADAA", "CUSTODIAN", "STORE_KEEPER"] },
      { key: "approvals", label: "Approvals", icon: "✓", path: "/approvals" },
      {
        key: "purchasing",
        label: "Purchasing",
        icon: "▣",
        path: "/purchasing",
        // Everyone may raise a need except a student (lib/domain/purchasing.ts's
        // own canRaiseNeed gate) — hiding the entry is convenience, not the real
        // enforcement, which the server still applies on every write.
        roles: ["SYS_ADMIN", "PROPERTY_ADMIN", "PROCUREMENT", "MANAGER", "CUSTODIAN", "STORE_KEEPER"],
      },
      { key: "change-log", label: "Change log", icon: "◷", path: "/change-log", roles: ["SYS_ADMIN", "PROPERTY_ADMIN", "PROCUREMENT", "MANAGER", "CUSTODIAN", "STORE_KEEPER"] },
      { key: "categories", label: "Categories", icon: "◈", path: "/categories" },
    ],
  },
  {
    label: "Administration",
    items: [
      { key: "admin-dashboard", label: "Overview", icon: "▦", path: "/admin/dashboard", roles: ["SYS_ADMIN"] },
      { key: "admin-people", label: "People & roles", icon: "◍", path: "/admin/people", roles: ["SYS_ADMIN", "MANAGER"] },
      { key: "admin-org-structure", label: "Org structure", icon: "⑃", path: "/admin/org-structure", roles: ["SYS_ADMIN"] },
    ],
  },
];

/** Every workspace used to get the same account section; there is only one nav now,
 *  so this is just appended once. */
const YOU_GROUP: NavGroup = {
  label: "You",
  items: [
    // Everyone gets Help; which guides it shows follows the person (lib/help/audience.ts).
    { key: "help", label: "Help & guides", icon: "?", path: "/help" },
    { key: "profile", label: "Profile & password", icon: "◌", path: "/me/profile" },
  ],
};

export const META: Record<string, [string, string, string]> = {
  dashboard: ["", "Dashboard", "What the register looks like from where you stand"],
  register: ["", "Register", "Your resources — or the whole university's, to find what you need and request it"],
  schedule: ["", "Schedule", "Lab calendars — weekly classes, and booking a room or machine"],
  "external-requests": ["", "External requests", "Workshops and trainings outside institutions have asked the university to host"],
  places: ["", "Labs & stores", "The labs and stores you run or manage — what is in them, and their changes"],
  approvals: ["", "Approvals", "Requests routed to you, and what you have asked for yourself"],
  purchasing: ["", "Purchasing", "Needs raised, purchase requests, and what has arrived"],
  "change-log": ["", "Change log", "Every applied change, who made it, and when"],
  categories: ["", "Categories", "The typed schema every resource is filed under"],

  "admin-dashboard": ["Administration ›", "Overview", "Org nodes, personnel, and where to start"],
  "admin-people": ["Administration ›", "People & roles", "Invite someone, change what they may do, or retire their account"],
  "admin-org-structure": ["Administration › Structure ›", "Org structure", "The reporting hierarchy — create a node of any kind, assign its head, redraw its parents"],

  profile: ["Me ›", "Profile & password", "Your details, your unit, and your sign-in password"],
  help: ["Me ›", "Help & guides", "How to do things in LRMS — the general guides, and the ones for your role"],
};

/** An EXTERNAL account and nothing else — an outside institution's requester. */
export function isRequesterOnly(roles: RoleKind[]): boolean {
  return roles.length > 0 && roles.every((r) => r === "EXTERNAL");
}

function allows(itemRoles: RoleKind[] | undefined, userRoles: RoleKind[]): boolean {
  if (!itemRoles || itemRoles.length === 0) return true;
  return itemRoles.some((r) => userRoles.includes(r));
}

/** Nav groups for this role set, with unreachable items removed and empty groups
 *  dropped — the "You" section is appended so profile is always one click away. */
export function navFor(roles: RoleKind[]): NavGroup[] {
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => allows(i.roles, roles)) })).filter((g) => g.items.length > 0);
  return [...groups, YOU_GROUP];
}

function allItems(): NavItem[] {
  return NAV.flatMap((g) => g.items).concat(YOU_GROUP.items);
}

/** Where sign-in should land — the first group's first reachable item. Every role
 *  reaches "Resources" ›  Dashboard, so this only actually varies for the rare
 *  account that reaches nothing (shouldn't happen — Dashboard has no role gate). */
export function landingPathFor(roles: RoleKind[]): string {
  // An outside requester's account reaches the portal only (their own requests).
  if (isRequesterOnly(roles)) return "/portal/requests";
  const groups = navFor(roles);
  return groups[0]?.items[0]?.path ?? "/me/profile";
}

/** True when the user may open this path at all. Backs the RequireRole route
 *  wrapper; the API enforces the same rules independently — neither layer trusts
 *  the other. */
export function canAccessPath(pathname: string, roles: RoleKind[]): boolean {
  const matches = allItems().filter((i) => pathname === i.path || pathname.startsWith(i.path + "/"));
  if (matches.length === 0) return true; // not a nav destination (e.g. a detail route) — let the API decide
  return matches.some((i) => allows(i.roles, roles));
}

/** The nav key for a pathname, used to highlight the active sidebar row and to look
 *  up the header's crumb/title/subtitle. */
export function screenKeyForPath(pathname: string): string {
  const match = allItems()
    .filter((i) => pathname === i.path || pathname.startsWith(i.path + "/"))
    .sort((a, b) => b.path.length - a.path.length)[0];
  return match?.key ?? "";
}
