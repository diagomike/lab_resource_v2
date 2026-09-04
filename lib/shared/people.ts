import { z } from "zod";
import { RoleKindSchema, UserStatusSchema } from "./enums";

/** Just enough to power a picker (handover recipient, transfer destination custodian) —
 *  not the full people-management screen, which lives below as PersonDto. */
export const PersonSummaryDto = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  homeNodeName: z.string().nullable(),
});
export type PersonSummaryDto = z.infer<typeof PersonSummaryDto>;

/**
 * One row of the personnel register. `occupiesNodeName` is set only when this person is
 * the CURRENT occupant of an OrgNode (a department head, a dean) — distinct from
 * `homeNodeName`, which is where a custodian or instructor works without heading it. See
 * ScopeService's own note on the same distinction.
 */
export const PersonDto = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  status: UserStatusSchema,
  roles: z.array(RoleKindSchema),
  homeNodeId: z.string().nullable(),
  homeNodeName: z.string().nullable(),
  occupiesNodeId: z.string().nullable(),
  occupiesNodeName: z.string().nullable(),
  invitedByName: z.string().nullable(),
  createdAt: z.string(),
});
export type PersonDto = z.infer<typeof PersonDto>;

/**
 * Creates the User row (status INVITED, no password yet) and fires the invitation email in
 * one step — there is deliberately no separate "create person" / "invite person" pair, a
 * person with no way to sign in is not useful to have in the register.
 *
 * `nodeId` occupies that OrgNode immediately (SYS_ADMIN only — see PeopleService). A
 * MANAGER inviting into their own department may set `roles` and `homeNodeId` only; the
 * service enforces both restrictions, this shape just documents the wider case.
 */
export const CreatePersonInput = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  roles: z.array(RoleKindSchema).min(1),
  homeNodeId: z.string().optional(),
  nodeId: z.string().optional(),
});
export type CreatePersonInput = z.infer<typeof CreatePersonInput>;

export const UpdatePersonRolesInput = z.object({
  roles: z.array(RoleKindSchema).min(1),
});
export type UpdatePersonRolesInput = z.infer<typeof UpdatePersonRolesInput>;

/**
 * `create`'s wire response — the person plus the one-time invite link. The raw token is
 * returned exactly once (tokens are one-way hashed; see lib/server/auth/token.ts's own
 * header on why that discipline exists and must not be "fixed") — this is that one
 * moment. Deployment reason, not just convenience: Gmail SMTP failing from a serverless
 * host must not be the only way to onboard someone, so the inviter can copy this link
 * and send it over any channel instead of relying on the email actually landing.
 */
export const CreatePersonResultDto = PersonDto.extend({ inviteUrl: z.string() });
export type CreatePersonResultDto = z.infer<typeof CreatePersonResultDto>;

/** `resendInvite`'s wire response — same reasoning as `CreatePersonResultDto` above,
 *  for the resend path specifically (a fresh token, since resending invalidates the
 *  previous one). */
export const ResendInviteResultDto = z.object({ inviteUrl: z.string() });
export type ResendInviteResultDto = z.infer<typeof ResendInviteResultDto>;

/** `nodeId: null` vacates whatever node this person currently occupies. Assigning a node
 *  that already has a different occupant is a TRANSITION — the previous occupant is
 *  vacated as part of the same call, and both moves are recorded in OrgNodeAssignment. */
export const AssignNodeInput = z.object({
  nodeId: z.string().nullable(),
  reason: z.string().optional(),
});
export type AssignNodeInput = z.infer<typeof AssignNodeInput>;

export const DeactivateResultDto = z.object({
  ok: z.literal(true),
  /** Set when deactivating this person vacated a node they occupied — a DISABLED occupant
   *  cannot sign in to act on it, so leaving the occupancy in place would silently stall
   *  every approval step and scope query routed through that node. */
  vacatedNodeName: z.string().nullable(),
});
export type DeactivateResultDto = z.infer<typeof DeactivateResultDto>;

export const OrgNodeAssignmentDto = z.object({
  id: z.string(),
  userName: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  reason: z.string().nullable(),
  assignedByName: z.string(),
});
export type OrgNodeAssignmentDto = z.infer<typeof OrgNodeAssignmentDto>;
