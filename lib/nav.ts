import type { CapabilitiesDto, RoleKind } from "@/lib/shared";

/**
 * One flat navigation, showing each person only what they use. Each item says WHO it
 * is for (`when`), from the same facts the server computes (`/auth/me` → `caps`, built
 * by lib/server/auth/capabilities.ts). The sidebar and the route guard (RequireRole →
 * `canAccessPath`) read the same predicate, and every API still re-checks on its own —
 * hiding an entry is convenience, never the boundary.
 *
 * EVERY item carries a META subtitle, rendered by ContentHeader — a one-line description
 * of what the screen is for, not decoration.
 */

/** What the nav decides from: the person's roles and their capabilities. */
export interface NavFacts {
  roles: RoleKind[];
  caps: CapabilitiesDto | null;
}

export type NavIconName =
  | "House"
  | "Boxes"
  | "Building2"
  | "CalendarDays"
  | "CircleCheck"
  | "ShoppingCart"
  | "Globe"
  | "Shapes"
  | "ChartColumn"
  | "History"
  | "Users"
  | "Network"
  | "CircleHelp"
  | "UserRound";

export interface NavItem {
  key: string;
  label: string;
  /** A lucide icon's name — components/shell/NavIcon.tsx draws it. */
  icon: NavIconName;
  path: string;
  /** Who sees it. Omit for every university account. */
  when?: (f: Who) => boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/** The facts, flattened into the plain words the matrix uses. */
interface Who {
  admin: boolean;
  custodian: boolean;
  /** Heads a department (occupies it), or holds the head's role. */
  head: boolean;
  adaa: boolean;
  /** A dean, the AVP, or the College Managing Director's office. */
  leader: boolean;
  propertyAdmin: boolean;
  procurement: boolean;
  storeKeeper: boolean;
  /** Manages some unit's labs and stores. */
  managesPlaces: boolean;
}

function who({ roles, caps }: NavFacts): Who {
  const has = (r: RoleKind) => roles.includes(r);
  return {
    admin: has("SYS_ADMIN"),
    custodian: has("CUSTODIAN"),
    head: has("MANAGER") || (caps?.headOf.length ?? 0) > 0,
    adaa: has("ADAA"),
    leader: (caps?.deanOf.length ?? 0) > 0 || (caps?.isAvp ?? false) || (caps?.officeCodes.includes("CMD") ?? false),
    propertyAdmin: has("PROPERTY_ADMIN"),
    procurement: has("PROCUREMENT"),
    storeKeeper: has("STORE_KEEPER"),
    managesPlaces: (caps?.managesPlacesIn.length ?? 0) + (caps?.managesStoresIn.length ?? 0) > 0,
  };
}

export const NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { key: "dashboard", label: "Insights", icon: "ChartColumn", path: "/dashboard", when: (w) => w.admin || w.propertyAdmin || w.head || w.adaa || w.leader },
      { key: "change-log", label: "History", icon: "History", path: "/change-log", when: (w) => w.admin || w.propertyAdmin || w.head || w.adaa },
    ],
  },
  {
    label: "Work",
    items: [
      { key: "home", label: "Home", icon: "House", path: "/home" },
      { key: "register", label: "Resources", icon: "Boxes", path: "/register" },
      // Heads, the ADAA and Property Administration manage labs and stores; a custodian
      // and the store keeper run theirs (lib/server/resources/places.ts).
      { key: "places", label: "Labs & stores", icon: "Building2", path: "/places", when: (w) => w.admin || w.managesPlaces || w.propertyAdmin || w.custodian || w.storeKeeper },
      // The roles the booking service accepts (lib/server/scheduling/context.ts).
      { key: "schedule", label: "Bookings", icon: "CalendarDays", path: "/schedule", when: (w) => w.admin || w.custodian || w.head },
      { key: "approvals", label: "Approvals", icon: "CircleCheck", path: "/approvals" },
      {
        key: "purchasing",
        label: "Purchasing",
        icon: "ShoppingCart",
        path: "/purchasing",
        when: (w) => w.admin || w.custodian || w.head || w.leader || w.propertyAdmin || w.procurement || w.storeKeeper,
      },
      // The service decides which requests each person sees (all for the AVP's office,
      // their unit's for deans, heads and assigned custodians).
      { key: "external-requests", label: "Outside requests", icon: "Globe", path: "/external-requests", when: (w) => w.admin || w.head || w.leader || w.custodian },
      { key: "categories", label: "Categories", icon: "Shapes", path: "/categories", when: (w) => w.admin || w.propertyAdmin || w.custodian || w.head || w.adaa },
    ],
  },
  {
    label: "Administration",
    items: [
      // A head brings in and re-roles their own department's custodians (lib/server/people).
      { key: "admin-people", label: "People & roles", icon: "Users", path: "/admin/people", when: (w) => w.admin || w.head },
      { key: "admin-org-structure", label: "Organisation", icon: "Network", path: "/admin/org-structure", when: (w) => w.admin },
    ],
  },
];

/** The person's own corner — it lives behind the avatar in the top bar (with Sign out),
 *  not in the sidebar, which keeps to the work. */
export const YOU_GROUP: NavGroup = {
  label: "You",
  items: [
    // Everyone gets Help; which guides it shows follows the person (lib/help/audience.ts).
    { key: "help", label: "Help & guides", icon: "CircleHelp", path: "/help" },
    { key: "profile", label: "Profile & password", icon: "UserRound", path: "/me/profile" },
  ],
};

export const META: Record<string, [string, string, string]> = {
  home: ["", "Home", "What is waiting for you, what you left unfinished, and what is new"],
  register: ["", "Resources", "Your resources, or the whole university's, to find what you need and request it"],
  places: ["", "Labs & stores", "The labs and stores you run or manage: what is in them, and their changes"],
  schedule: ["", "Bookings", "Lab calendars: weekly classes, and booking a room or machine"],
  approvals: ["", "Approvals", "What is waiting for your decision, and what you have asked for"],
  purchasing: ["", "Purchasing", "Needs from the labs, purchase requests, and what has arrived"],
  "external-requests": ["", "Outside requests", "Analyses, workshops and trainings outside institutions have asked the university for"],
  categories: ["", "Categories", "The kinds of things we record, and the details each one keeps"],
  dashboard: ["", "Insights", "What the resources look like from where you stand"],
  "change-log": ["", "History", "Every applied change, who made it, and when"],

  "admin-people": ["Administration ›", "People & roles", "Invite someone, change what they may do, or retire their account"],
  "admin-org-structure": ["Administration ›", "Organisation", "Colleges, departments and offices: who heads each, and what sits under what"],

  profile: ["Me ›", "Profile & password", "Your details, your unit, and your sign-in password"],
  help: ["Me ›", "Help & guides", "How to do things in LRMS: the general guides, and the ones for your role"],
};

/** An EXTERNAL account and nothing else — an outside institution's requester. */
export function isRequesterOnly(roles: RoleKind[]): boolean {
  return roles.length > 0 && roles.every((r) => r === "EXTERNAL");
}

function shows(item: NavItem, facts: NavFacts): boolean {
  if (isRequesterOnly(facts.roles)) return false;
  return item.when ? item.when(who(facts)) : true;
}

/** Sidebar groups for this person, with what they don't use removed and empty groups
 *  dropped. The "You" items are not here — they sit behind the avatar for everyone. */
export function navFor(facts: NavFacts): NavGroup[] {
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => shows(i, facts)) })).filter((g) => g.items.length > 0);
}

function allItems(): NavItem[] {
  return NAV.flatMap((g) => g.items).concat(YOU_GROUP.items);
}

/** Where sign-in lands: Home for every university account, the portal for an outside
 *  requester. */
export function landingPathFor(roles: RoleKind[]): string {
  return isRequesterOnly(roles) ? "/portal/requests" : "/home";
}

/** True when the person may open this path at all. Backs the RequireRole route
 *  wrapper; the API enforces the same rules independently — neither layer trusts
 *  the other. */
export function canAccessPath(pathname: string, facts: NavFacts): boolean {
  const matches = allItems().filter((i) => pathname === i.path || pathname.startsWith(i.path + "/"));
  if (matches.length === 0) return true; // not a nav destination (e.g. a detail route) — let the API decide
  return matches.some((i) => shows(i, facts) || YOU_GROUP.items.includes(i));
}

/** The nav key for a pathname, used to highlight the active sidebar row and to look
 *  up the header's crumb/title/subtitle. */
export function screenKeyForPath(pathname: string): string {
  const match = allItems()
    .filter((i) => pathname === i.path || pathname.startsWith(i.path + "/"))
    .sort((a, b) => b.path.length - a.path.length)[0];
  return match?.key ?? "";
}
