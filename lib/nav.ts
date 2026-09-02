import type { RoleKind, WorkspaceKind } from "@/lib/shared";

/**
 * Navigation model + role-based visibility, organised by WHICH OF THE FOUR WORKSPACES
 * you are in: Admin, Department (head), Approver (dean/AVP/Property Admin/Procurement),
 * or Custodian (lab assistant/ARA/SARA, and the landing spot for plain STAFF/STUDENT
 * too). The resource register (see the resource-register plan) is the first
 * lab-management module and is now reachable from all four — one RegisterPage, scoped
 * differently per workspace server-side. Every other lab-management module still gets
 * built one at a time.
 *
 * `workspace` is computed SERVER-SIDE in auth.controller.ts's me() — this file never
 * re-derives it. A person holding several roles gets a primary workspace plus a switcher
 * for the others, via MeContextDto.availableWorkspaces.
 *
 * EVERY item carries a META subtitle, rendered by ContentHeader — a one-line description
 * of what the screen is for, not decoration.
 */

export const WORKSPACES: { key: WorkspaceKind; label: string }[] = [
  { key: "admin", label: "Admin" },
  { key: "department", label: "Department" },
  { key: "approver", label: "Approver" },
  { key: "custodian", label: "Custodian" },
];

export interface NavItem {
  key: string;
  label: string;
  icon: string;
  path: string;
  /** Visible when the user holds ANY of these roles. Omit (or leave empty) for "everyone
   *  who reaches this workspace at all". */
  roles?: RoleKind[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: Record<WorkspaceKind, NavGroup[]> = {
  admin: [
    {
      label: "Overview",
      items: [{ key: "admin-dashboard", label: "Dashboard", icon: "▦", path: "/admin/dashboard" }],
    },
    {
      label: "Personnel",
      items: [{ key: "admin-people", label: "People & roles", icon: "◍", path: "/admin/people" }],
    },
    {
      label: "Structure",
      items: [{ key: "admin-org-structure", label: "Org structure", icon: "⑃", path: "/admin/org-structure" }],
    },
    {
      label: "Resources",
      items: [{ key: "admin-register", label: "Register", icon: "▤", path: "/admin/register" }],
    },
  ],

  // The resource register is the first lab-management module — see the resource-
  // register plan. Everything below it in each of these three workspaces is still
  // "one module at a time" (LRMS.md/CLAUDE.md's roadmap), reached through Coming Soon
  // until it exists.
  department: [
    {
      label: "Resources",
      items: [{ key: "dept-register", label: "Register", icon: "▤", path: "/department/register" }],
    },
  ],
  approver: [
    {
      label: "Resources",
      items: [{ key: "appr-register", label: "Register", icon: "▤", path: "/approver/register" }],
    },
  ],
  custodian: [
    {
      label: "Resources",
      items: [{ key: "cust-register", label: "Register", icon: "▤", path: "/custodian/register" }],
    },
  ],
};

/** Every workspace gets the same account section — profile is not workspace-specific. */
const YOU_GROUP: NavGroup = { label: "You", items: [{ key: "profile", label: "Profile & password", icon: "◌", path: "/me/profile" }] };

export const META: Record<string, [string, string, string]> = {
  "admin-dashboard": ["Admin ›", "Dashboard", "Org nodes, personnel, and where to start"],
  "admin-people": ["Admin ›", "People & roles", "Invite someone, change what they may do, or retire their account"],
  "admin-org-structure": ["Admin › Structure ›", "Org structure", "The reporting hierarchy — create a node of any kind, assign its head, redraw its parents"],
  "admin-register": ["Admin › Resources ›", "Register", "Every resource in the university — scope is global for this workspace"],

  "dept-register": ["Department › Resources ›", "Register", "Resources owned by or held in your department and everything under it"],
  "appr-register": ["Approver › Resources ›", "Register", "Resources within your approval reach"],
  "cust-register": ["Custodian › Resources ›", "Register", "Resources you are personally answerable for, and their contents"],

  profile: ["Me ›", "Profile & password", "Your details, your unit, and your sign-in password"],
};

function allows(itemRoles: RoleKind[] | undefined, userRoles: RoleKind[]): boolean {
  if (!itemRoles || itemRoles.length === 0) return true;
  return itemRoles.some((r) => userRoles.includes(r));
}

/** Nav groups for a workspace, with unreachable items removed and empty groups dropped —
 *  the "You" section is appended to every workspace so profile is always one click away. */
export function navFor(workspace: WorkspaceKind, roles: RoleKind[]): NavGroup[] {
  const groups = NAV[workspace]
    .map((g) => ({ ...g, items: g.items.filter((i) => allows(i.roles, roles)) }))
    .filter((g) => g.items.length > 0);
  return [...groups, YOU_GROUP];
}

/** Where a given workspace should land — its first group's first reachable item, after
 *  role filtering. */
export function landingPathFor(workspace: WorkspaceKind, roles: RoleKind[]): string {
  const groups = navFor(workspace, roles);
  return groups[0]?.items[0]?.path ?? "/me/profile";
}

/** True when the user may open this path at all, given their primary workspace plus
 *  every workspace they also qualify for. Backs the RequireRole route wrapper; the API
 *  enforces the same rules independently. */
export function canAccessPath(pathname: string, roles: RoleKind[], availableWorkspaces: WorkspaceKind[]): boolean {
  const matches = allItems(availableWorkspaces).filter((i) => pathname === i.path || pathname.startsWith(i.path + "/"));
  if (matches.length === 0) return true; // not a nav destination (e.g. a detail route) — let the API decide
  return matches.some((i) => allows(i.roles, roles));
}

function allItems(workspaces: WorkspaceKind[]): NavItem[] {
  const ws = workspaces.length > 0 ? workspaces : (Object.keys(NAV) as WorkspaceKind[]);
  return ws.flatMap((w) => NAV[w].flatMap((g) => g.items)).concat(YOU_GROUP.items);
}

/** Which workspace owns a given pathname, among the ones this user can reach — used to
 *  highlight the right switcher pill when a URL is opened directly rather than clicked
 *  from the sidebar. Falls back to the primary workspace. */
export function workspaceForPath(pathname: string, availableWorkspaces: WorkspaceKind[], primary: WorkspaceKind): WorkspaceKind {
  for (const w of availableWorkspaces) {
    if (NAV[w].some((g) => g.items.some((i) => pathname === i.path || pathname.startsWith(i.path + "/")))) return w;
  }
  return primary;
}

/** The nav key for a pathname, used to highlight the active sidebar row and to look up
 *  the header's crumb/title/subtitle. The CURRENT workspace wins; failing that, any
 *  other workspace that links it still gives an honest description of the page. */
export function screenKeyForPath(workspace: WorkspaceKind, pathname: string): string {
  const matches = (items: NavItem[]) =>
    items
      .filter((i) => pathname === i.path || pathname.startsWith(i.path + "/"))
      .sort((a, b) => b.path.length - a.path.length)[0];

  const own = matches(NAV[workspace].flatMap((g) => g.items).concat(YOU_GROUP.items));
  if (own) return own.key;

  const anywhere = matches((Object.keys(NAV) as WorkspaceKind[]).flatMap((w) => NAV[w].flatMap((g) => g.items)));
  return anywhere?.key ?? "";
}
