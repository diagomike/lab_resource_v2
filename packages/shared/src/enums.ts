/**
 * Every enum the API and the web app both need to name.
 *
 * These are duplicated as Prisma enums in apps/api/prisma/schema.prisma — Prisma cannot
 * generate zod schemas, and importing @prisma/client into the browser bundle is not an
 * option, so the two lists are kept in sync by hand.
 *
 * This is the identity + org-structure foundation only. Lab-management enums (location
 * kinds, tracking modes, units, catalog status, asset lifecycle/condition, stock ledger
 * kinds, ...) are deliberately not here yet — each is added when its owning module is
 * designed and built, one at a time.
 */
import { z } from "zod";

// ── Identity ──────────────────────────────────────────────────────────────
export const userStatuses = ["INVITED", "ACTIVE", "DISABLED"] as const;
export const UserStatusSchema = z.enum(userStatuses);
export type UserStatus = (typeof userStatuses)[number];

/**
 * Roles stack — an ARA/SARA lab holder is routinely CUSTODIAN + STAFF, and a department
 * head is MANAGER + STAFF. Never assume one user has exactly one role.
 *
 * PROPERTY_ADMIN and PROCUREMENT are university-wide offices, not academic managers: they
 * reach every node through cross-cutting hierarchy edges (see ScopeService.GLOBAL_ROLES),
 * not through a magic flag.
 */
export const roleKinds = [
  "SYS_ADMIN",
  "PROPERTY_ADMIN",
  "PROCUREMENT",
  "MANAGER",
  "CUSTODIAN",
  "STAFF",
  "STUDENT",
] as const;
export const RoleKindSchema = z.enum(roleKinds);
export type RoleKind = (typeof roleKinds)[number];

/**
 * Which of the four purpose-built navigation shells a signed-in user lands in. Computed
 * SERVER-SIDE in auth.controller.ts's me() from role + org-node kind — the client never
 * re-derives it. A person holding several roles (e.g. CUSTODIAN + STAFF) still gets exactly
 * one primary workspace; nav.ts's workspace switcher is what lets them reach a second one
 * they also qualify for.
 */
export const workspaceKinds = ["admin", "department", "approver", "custodian"] as const;
export const WorkspaceKindSchema = z.enum(workspaceKinds);
export type WorkspaceKind = (typeof workspaceKinds)[number];

// ── Org hierarchy ────────────────────────────────────────────────────────
export const orgNodeKinds = ["UNIVERSITY", "COLLEGE", "DEPARTMENT", "OFFICE"] as const;
export const OrgNodeKindSchema = z.enum(orgNodeKinds);
export type OrgNodeKind = (typeof orgNodeKinds)[number];
