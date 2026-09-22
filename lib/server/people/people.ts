import "server-only";
import type {
  CreatePersonInput,
  CreatePersonResultDto,
  DeactivateResultDto,
  MoveHomeNodeInput,
  PersonDto,
  PersonSummaryDto,
  ResendInviteResultDto,
  RoleKind,
  UpdatePersonRolesInput,
} from "@/lib/shared";
import crypto from "node:crypto";
import * as argon2 from "@node-rs/argon2";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { HttpError } from "../http-error";
import * as scope from "../org/scope";
import * as mail from "../mail/mail";
import { generateToken, hashToken } from "../auth/token";

const INVITATION_TTL_DAYS = 7;
const PASSWORD_RESET_TTL_HOURS = 2;
// Renamed from WEB_ORIGIN — see auth.ts's own note.
const APP_ORIGIN = process.env.APP_ORIGIN ?? "http://localhost:3000";
/** A MANAGER inviting into their own department may only bring in the people who actually
 *  do hands-on work there — never another manager, and never a university-wide office. */
const MANAGER_INVITABLE_ROLES: RoleKind[] = ["CUSTODIAN", "STAFF"];

/**
 * SYS_ADMIN sees everyone. A MANAGER sees everyone reachable from their own scope — the
 * same `visibleNodeIds` reports and the asset register use — so a dean can see personnel
 * across every department below them, not just their own.
 */
export async function list(actorUserId: string, actorRoles: RoleKind[]): Promise<PersonDto[]> {
  const isAdmin = actorRoles.includes("SYS_ADMIN");
  let where = {};
  if (!isAdmin) {
    const visible = await scope.visibleNodeIds(actorUserId);
    if (visible.length === 0) return [];
    where = { OR: [{ homeNodeId: { in: visible } }, { orgNode: { id: { in: visible } } }] };
  }

  const rows = await prisma.user.findMany({
    where,
    include: { roles: true, homeNode: { select: { name: true } }, orgNode: { select: { id: true, name: true } } },
    orderBy: { name: "asc" },
  });

  const latestInviteByEmail = await latestInviterByEmail(rows.map((r) => r.emailLower));
  return rows.map((r) => toDto(r, latestInviteByEmail.get(r.emailLower) ?? null));
}

/** Most recent inviter's name per email, batched in one query rather than N+1 — list()
 *  is the only caller with more than one row at a time. */
async function latestInviterByEmail(emails: string[]): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (emails.length === 0) return map;
  const invitations = await prisma.invitation.findMany({
    where: { emailLower: { in: emails } },
    orderBy: { createdAt: "desc" },
    include: { invitedBy: { select: { name: true } } },
  });
  for (const inv of invitations) {
    if (!map.has(inv.emailLower)) map.set(inv.emailLower, inv.invitedBy?.name ?? null);
  }
  return map;
}

function toDto(
  r: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    status: string;
    createdAt: Date;
    homeNodeId: string | null;
    roles: { kind: string }[];
    homeNode: { name: string } | null;
    orgNode: { id: string; name: string } | null;
  },
  invitedByName: string | null,
): PersonDto {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    status: r.status as PersonDto["status"],
    roles: r.roles.map((ur) => ur.kind as RoleKind),
    homeNodeId: r.homeNodeId,
    homeNodeName: r.homeNode?.name ?? null,
    occupiesNodeId: r.orgNode?.id ?? null,
    occupiesNodeName: r.orgNode?.name ?? null,
    invitedByName,
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * Creates the User row and fires the invitation email in one step. Nothing in this
 * codebase called Invitation.create before this — every seeded account got a password
 * hash directly — so this is the one place that path now actually exists.
 */
export async function create(actorUserId: string, actorRoles: RoleKind[], input: CreatePersonInput): Promise<CreatePersonResultDto> {
  const isAdmin = actorRoles.includes("SYS_ADMIN");
  const roles = input.roles;
  let homeNodeId = input.homeNodeId ?? null;
  let nodeId = input.nodeId ?? null;

  if (!isAdmin) {
    // Occupancy decides who may act as a head, not the MANAGER role label (F-017 of
    // the 2026-09-15 campaign) — `scope.ownNodeId` alone is too wide for this check
    // (it also resolves a plain custodian's or staff member's homeNodeId, who
    // occupy nothing); `headNodeIdsOf` is genuinely "do they hold a post".
    const headNodeIds = await scope.headNodeIdsOf(actorUserId);
    if (!headNodeIds.length) {
      throw new HttpError(403, "Only an admin or a department head may add personnel");
    }
    const ownNodeId = headNodeIds[0];
    if (roles.some((r) => !MANAGER_INVITABLE_ROLES.includes(r))) {
      throw new HttpError(403, `A department head may only add ${MANAGER_INVITABLE_ROLES.join(" or ")} personnel`);
    }
    // A head assigns people INTO their own reach, never elsewhere, and never hands out
    // node occupancy — that stays an admin-only act (see assignNode). F-018: a dean
    // (head of a unit with departments beneath) may name any department in their
    // subtree; the default stays their own node.
    if (input.homeNodeId && input.homeNodeId !== ownNodeId) {
      const reach = await scope.visibleNodeIds(actorUserId);
      if (!reach.includes(input.homeNodeId)) throw new HttpError(403, "You may only add personnel to a unit within your own department tree");
      homeNodeId = input.homeNodeId;
    } else {
      homeNodeId = ownNodeId;
    }
    nodeId = null;
  }

  const emailLower = input.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { emailLower } });
  if (existing) throw new HttpError(400, "A person with this email already exists");

  const raw = generateToken();
  let assignedNodeName: string | null = null;
  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email: input.email, emailLower, name: input.name, phone: input.phone ?? null, homeNodeId, status: "INVITED" },
    });
    await tx.userRole.createMany({ data: roles.map((kind) => ({ userId: user.id, kind })) });

    if (nodeId) {
      const targetNode = await tx.orgNode.findUnique({ where: { id: nodeId } });
      if (!targetNode) throw new HttpError(400, "Org node not found");
      if (targetNode.userId) {
        throw new HttpError(400, `"${targetNode.name}" already has an occupant — use a transition to replace them`);
      }
      await tx.orgNode.update({ where: { id: nodeId }, data: { userId: user.id } });
      await tx.orgNodeAssignment.create({
        data: { nodeId, userId: user.id, assignedById: actorUserId, reason: "Initial assignment on invitation" },
      });
      assignedNodeName = targetNode.name;
    }

    await tx.invitation.create({
      data: {
        emailLower,
        tokenHash: hashToken(raw),
        intendedRole: roles[0],
        orgNodeId: nodeId ?? homeNodeId,
        invitedById: actorUserId,
        expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000),
      },
    });

    return user;
    });
  } catch (err) {
    // F-019: two submits of the same invite race past the pre-check above; the loser trips
    // the emailLower unique index. Same answer as the pre-check, not a raw 500.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new HttpError(400, "A person with this email already exists");
    }
    throw err;
  }

  const inviteUrl = `${APP_ORIGIN}/accept-invite?token=${raw}`;

  await mail.send({
    to: created.email,
    subject: "You're invited to ASTU Lab Resources",
    html: `<p>Hello ${escapeHtml(created.name)},</p>
           <p>You have been added to the ASTU Laboratory Resource Management System${
             assignedNodeName ? ` as the occupant of <b>${escapeHtml(assignedNodeName)}</b>` : ""
           }. This link expires in ${INVITATION_TTL_DAYS} days.</p>
           <p><a href="${inviteUrl}">Accept your invitation and set a password</a></p>`,
  });

  const dto = await one(created.id);
  return { ...dto, inviteUrl };
}

/**
 * F-014 of the 2026-09-15 campaign: a department head may deactivate, reactivate
 * and re-role their OWN CUSTODIAN/STAFF personnel — previously SYS_ADMIN-only,
 * which meant every routine staffing change in every department was a ticket to
 * the system administrator, despite Personnel already scoping heads to invite
 * exactly this pair of roles. Scoped tightly, never widened past what a head could
 * already do by inviting fresh: the target must be in the head's own department,
 * must not occupy a node themselves (a post is an admin-only act, unchanged), must
 * not be the actor, and every role touched — the target's EXISTING roles and
 * whatever the head is trying to set — must stay within CUSTODIAN/STAFF. SYS_ADMIN
 * is unconditional, as everywhere else.
 */
async function assertMayManageStaff(actorUserId: string, actorRoles: RoleKind[], target: { id: string; homeNodeId: string | null; roles: { kind: RoleKind }[] }): Promise<void> {
  if (actorRoles.includes("SYS_ADMIN")) return;
  if (target.id === actorUserId) throw new HttpError(403, "You cannot manage your own account this way.");
  const headNodeIds = await scope.headNodeIdsOf(actorUserId);
  if (!headNodeIds.length) throw new HttpError(403, "Only an admin or a department head may do this.");
  const visible = await scope.visibleNodeIds(actorUserId);
  if (!target.homeNodeId || !visible.includes(target.homeNodeId)) {
    throw new HttpError(403, "You may only manage people in your own department.");
  }
  const occupiesANode = await prisma.orgNode.findFirst({ where: { userId: target.id }, select: { id: true } });
  if (occupiesANode) throw new HttpError(403, "You may not manage someone who occupies a post on the org chart.");
  if (target.roles.some((r) => !MANAGER_INVITABLE_ROLES.includes(r.kind))) {
    throw new HttpError(403, `You may only manage ${MANAGER_INVITABLE_ROLES.join(" or ")} personnel.`);
  }
}

/** F-016 of the 2026-09-15 campaign — with a single administrator, as in a fresh
 *  production bootstrap, losing the last active SYS_ADMIN locks everyone out of Org
 *  Studio, Personnel and categories, recoverable only via `prisma/bootstrap.ts` with
 *  production credentials. Called whenever a change would remove SYS_ADMIN's access
 *  from someone who currently has it — role edit or deactivation alike — and refuses
 *  if no OTHER active administrator would be left. */
async function assertNotLastActiveAdmin(targetUserId: string, action: string): Promise<void> {
  const otherActiveAdmins = await prisma.user.count({
    where: { id: { not: targetUserId }, status: "ACTIVE", roles: { some: { kind: "SYS_ADMIN" } } },
  });
  if (otherActiveAdmins === 0) {
    throw new HttpError(400, `Cannot ${action} this person — they are the last active system administrator.`);
  }
}

export async function updateRoles(actorUserId: string, actorRoles: RoleKind[], id: string, input: UpdatePersonRolesInput): Promise<PersonDto> {
  const user = await prisma.user.findUnique({ where: { id }, include: { roles: true } });
  if (!user) throw new HttpError(404, "Person not found");
  await assertMayManageStaff(actorUserId, actorRoles, { id: user.id, homeNodeId: user.homeNodeId, roles: user.roles.map((r) => ({ kind: r.kind as RoleKind })) });
  if (!actorRoles.includes("SYS_ADMIN") && input.roles.some((r) => !MANAGER_INVITABLE_ROLES.includes(r))) {
    throw new HttpError(403, `A department head may only set ${MANAGER_INVITABLE_ROLES.join(" or ")} roles.`);
  }
  // F-016 of the 2026-09-15 campaign: assertMayManageStaff returns early for a
  // SYS_ADMIN actor (an admin may otherwise manage anyone), which meant an admin
  // could strip SYS_ADMIN from themselves — or from the only other admin — via this
  // same route, with the guard existing only in the UI. Checked here, independent of
  // who the actor is, because the failure mode (nobody left who can open Org Studio,
  // Personnel or categories) doesn't care who caused it.
  const wasAdmin = user.roles.some((r) => r.kind === "SYS_ADMIN");
  if (wasAdmin && !input.roles.includes("SYS_ADMIN")) {
    await assertNotLastActiveAdmin(id, "remove system-administrator access from");
  }
  await prisma.$transaction([
    prisma.userRole.deleteMany({ where: { userId: id } }),
    prisma.userRole.createMany({ data: input.roles.map((kind) => ({ userId: id, kind })) }),
  ]);
  return one(id);
}

/**
 * A DISABLED user is refused at requireSession, so a disabled occupant could never again
 * sign in to act on the node they hold — every approval step and scope query routed
 * through it would stall permanently. Deactivating therefore vacates any node they
 * occupy in the same transaction, and says so, rather than leaving that discovered later
 * as a stuck approval chain.
 */
export async function deactivate(actorUserId: string, actorRoles: RoleKind[], id: string): Promise<DeactivateResultDto> {
  // F-016 of the 2026-09-15 campaign: below, assertMayManageStaff refuses self-target
  // for a HEAD actor but returns early (no check at all) for a SYS_ADMIN one — an
  // admin could otherwise deactivate their own account via this route, with the
  // guard existing only in the UI. Checked first, ahead of role, for the same reason.
  if (actorUserId === id) throw new HttpError(400, "You cannot deactivate your own account.");

  const user = await prisma.user.findUnique({ where: { id }, include: { roles: true } });
  if (!user) throw new HttpError(404, "Person not found");
  await assertMayManageStaff(actorUserId, actorRoles, { id: user.id, homeNodeId: user.homeNodeId, roles: user.roles.map((r) => ({ kind: r.kind as RoleKind })) });
  if (user.roles.some((r) => r.kind === "SYS_ADMIN")) {
    await assertNotLastActiveAdmin(id, "deactivate");
  }

  // Item.custodianId is onDelete: Restrict and NEVER null — custody hands off, it
  // never lapses. A disabled custodian could never again sign in to act on what they
  // hold, the same reasoning an occupied node's deactivation already follows, so this
  // blocks rather than silently strands accountability. Reassign custody first
  // (setCustodian, singly or in bulk) then deactivate.
  const custodyCount = await prisma.item.count({ where: { custodianId: id } });
  if (custodyCount > 0) {
    throw new HttpError(400, `Cannot deactivate "${user.name}" — they are custodian of ${custodyCount} resource(s); reassign custody first`);
  }

  return prisma.$transaction(async (tx) => {
    const occupied = await tx.orgNode.findUnique({ where: { userId: id } });
    if (occupied) {
      await tx.orgNode.update({ where: { id: occupied.id }, data: { userId: null } });
      await tx.orgNodeAssignment.updateMany({
        where: { nodeId: occupied.id, userId: id, endedAt: null },
        data: { endedAt: new Date(), reason: "Deactivated" },
      });
    }
    await tx.user.update({ where: { id }, data: { status: "DISABLED" } });
    await tx.session.deleteMany({ where: { userId: id } });
    // Every still-usable invitation for this email dies with the account (F-012 of
    // the 2026-09-15 campaign): without this, a deactivated INVITED person could
    // open their original invite link and register anyway, silently re-activating
    // themselves — `register()` in auth.ts refuses a non-INVITED account (a second,
    // independent half of the same fix), but a link that should already be dead is
    // the more honest place to close this, not just the door it would have opened.
    await tx.invitation.updateMany({ where: { emailLower: user.emailLower, consumedAt: null }, data: { expiresAt: new Date() } });
    return { ok: true as const, vacatedNodeName: occupied?.name ?? null };
  });
}

export async function reactivate(actorUserId: string, actorRoles: RoleKind[], id: string): Promise<PersonDto> {
  const user = await prisma.user.findUnique({ where: { id }, include: { roles: true } });
  if (!user) throw new HttpError(404, "Person not found");
  await assertMayManageStaff(actorUserId, actorRoles, { id: user.id, homeNodeId: user.homeNodeId, roles: user.roles.map((r) => ({ kind: r.kind as RoleKind })) });
  await prisma.user.update({ where: { id }, data: { status: user.passwordHash ? "ACTIVE" : "INVITED" } });
  return one(id);
}

export async function resendInvite(actorUserId: string, actorRoles: RoleKind[], id: string): Promise<ResendInviteResultDto> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new HttpError(404, "Person not found");
  if (user.passwordHash) throw new HttpError(400, "This person has already registered");

  if (!actorRoles.includes("SYS_ADMIN")) {
    // F-018: the list shows everyone in a head's whole subtree, so the action must reach
    // the same set (it used to compare against the head's own node only and 403 a dean).
    const headNodeIds = await scope.headNodeIdsOf(actorUserId);
    const reach = headNodeIds.length ? await scope.visibleNodeIds(actorUserId) : [];
    if (!user.homeNodeId || !reach.includes(user.homeNodeId)) {
      throw new HttpError(403, "You may only resend invitations within your own department");
    }
  }

  const inviteUrl = await issueInvitation(user, actorUserId);
  return { inviteUrl };
}

/**
 * Issues a fresh invitation for a not-yet-registered account and emails it, expiring
 * every older one first. Shared by `resendInvite` and by auth.ts's `forgotPassword`
 * (an invited person who asks for a reset gets their invitation again — they have no
 * password to reset).
 */
export async function issueInvitation(
  user: { id: string; email: string; emailLower: string; name: string; homeNodeId: string | null },
  invitedById: string | null,
): Promise<string> {
  const raw = generateToken();
  const intendedRole = (await prisma.userRole.findFirst({ where: { userId: user.id } }))?.kind ?? "STAFF";
  // F-013 of the 2026-09-15 campaign: the email this same call sends says "the
  // previous one, if any, no longer works" — it didn't; both old and new tokens
  // stayed live, so a link sent to the wrong address or forwarded on kept working
  // after the admin believed they'd replaced it. Expire every open invitation for
  // this email in the same transaction as issuing the new one.
  await prisma.$transaction([
    prisma.invitation.updateMany({ where: { emailLower: user.emailLower, consumedAt: null }, data: { expiresAt: new Date() } }),
    prisma.invitation.create({
      data: {
        emailLower: user.emailLower,
        tokenHash: hashToken(raw),
        intendedRole,
        orgNodeId: user.homeNodeId,
        invitedById,
        expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000),
      },
    }),
  ]);
  const inviteUrl = `${APP_ORIGIN}/accept-invite?token=${raw}`;
  await mail.send({
    to: user.email,
    subject: "Your ASTU Lab Resources invitation",
    html: `<p>Hello ${escapeHtml(user.name)},</p>
           <p>Here is a fresh invitation link — the previous one, if any, no longer works. This link expires in ${INVITATION_TTL_DAYS} days.</p>
           <p><a href="${inviteUrl}">Accept your invitation and set a password</a></p>`,
  });
  return inviteUrl;
}

/** Helping a locked-out, already-registered person — same reach as every other
 *  staff-management action (`assertMayManageStaff`): an admin for anyone, a head for
 *  the custodians and staff in their own subtree. */
async function loadRegisteredForHelp(actorUserId: string, actorRoles: RoleKind[], id: string) {
  const user = await prisma.user.findUnique({ where: { id }, include: { roles: true } });
  if (!user) throw new HttpError(404, "Person not found");
  await assertMayManageStaff(actorUserId, actorRoles, { id: user.id, homeNodeId: user.homeNodeId, roles: user.roles.map((r) => ({ kind: r.kind as RoleKind })) });
  if (user.status === "DISABLED") throw new HttpError(400, "This account is deactivated — reactivate it first.");
  if (!user.passwordHash) throw new HttpError(400, "This person hasn't registered yet — send their invite link instead.");
  return user;
}

/** Emails the person a reset link. The link itself is never shown to the actor. */
export async function sendPasswordReset(actorUserId: string, actorRoles: RoleKind[], id: string): Promise<void> {
  const user = await loadRegisteredForHelp(actorUserId, actorRoles, id);
  const raw = generateToken();
  await prisma.passwordReset.create({
    data: { userId: user.id, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_HOURS * 3_600_000) },
  });
  await mail.send({
    to: user.email,
    subject: "Reset your ASTU Lab Resources password",
    html: `<p>Hello ${escapeHtml(user.name)},</p>
           <p>An administrator sent you a password reset link. It expires in ${PASSWORD_RESET_TTL_HOURS} hours.</p>
           <p><a href="${APP_ORIGIN}/reset-password?token=${raw}">Choose a new password</a></p>
           <p>If you did not ask for this, you can ignore this email — your password will not change.</p>`,
  });
}

/**
 * Sets a random temporary password, returned ONCE to the actor to hand over. Every
 * existing session dies, and the account must choose its own password before anything
 * else works (`mustChangePassword`, enforced in session.ts). The person is emailed that
 * this happened — never the password itself.
 */
export async function setTemporaryPassword(actorUserId: string, actorRoles: RoleKind[], id: string): Promise<{ temporaryPassword: string }> {
  const user = await loadRegisteredForHelp(actorUserId, actorRoles, id);
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await argon2.hash(temporaryPassword);
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: true } }),
    prisma.session.deleteMany({ where: { userId: user.id } }),
    prisma.passwordReset.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: new Date() } }),
  ]);
  await mail.send({
    to: user.email,
    subject: "Your ASTU Lab Resources password was reset",
    html: `<p>Hello ${escapeHtml(user.name)},</p>
           <p>An administrator set a temporary password on your account. They will give it to you directly — you'll be asked to choose your own the first time you sign in.</p>
           <p>If you weren't expecting this, contact your administrator.</p>`,
  });
  return { temporaryPassword };
}

/** 12 characters from an alphabet without look-alikes (0/O, 1/l/I). */
function generateTemporaryPassword(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(12);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/**
 * SYS_ADMIN-only. `nodeId: null` vacates whatever node this person currently occupies.
 * Assigning a node that already has a different occupant is a TRANSITION: the previous
 * occupant is vacated as part of the same call, and both sides are recorded in
 * OrgNodeAssignment — this is what makes "who held this before" answerable later.
 */
export async function assignNode(
  actorUserId: string,
  targetUserId: string,
  nodeId: string | null,
  reason?: string,
): Promise<PersonDto> {
  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target) throw new HttpError(404, "Person not found");

  // Set only when this call actually creates a fresh occupancy (not a vacate, and not a
  // no-op re-save of the same occupant) — that's the one case this person needs telling,
  // same trigger point create()'s invite email uses.
  let newAssignmentNodeName: string | null = null;

  await prisma.$transaction(async (tx) => {
    const currentlyOccupied = await tx.orgNode.findUnique({ where: { userId: targetUserId } });
    if (currentlyOccupied && currentlyOccupied.id !== nodeId) {
      await tx.orgNode.update({ where: { id: currentlyOccupied.id }, data: { userId: null } });
      await tx.orgNodeAssignment.updateMany({
        where: { nodeId: currentlyOccupied.id, userId: targetUserId, endedAt: null },
        data: { endedAt: new Date(), reason: reason ?? "Reassigned" },
      });
    }
    if (!nodeId) return;

    const targetNode = await tx.orgNode.findUnique({ where: { id: nodeId } });
    if (!targetNode) throw new HttpError(404, "Org node not found");

    if (targetNode.userId && targetNode.userId !== targetUserId) {
      await tx.orgNodeAssignment.updateMany({
        where: { nodeId, userId: targetNode.userId, endedAt: null },
        data: { endedAt: new Date(), reason: reason ?? "Replaced" },
      });
    }
    if (targetNode.userId !== targetUserId) {
      await tx.orgNode.update({ where: { id: nodeId }, data: { userId: targetUserId } });
      await tx.orgNodeAssignment.create({
        data: { nodeId, userId: targetUserId, assignedById: actorUserId, reason: reason ?? null },
      });
      // Occupying a node is what "head" means now (F-017 of the 2026-09-15
      // campaign) — MANAGER is auto-granted alongside so a newly appointed head
      // sees People and can compile purchase requests immediately, without a
      // separate manual role edit the admin could forget. It is never REMOVED on
      // vacate (a former head may legitimately keep the role, e.g. to sit on a
      // committee) — occupancy is checked live everywhere it actually matters, this
      // upsert is purely a convenience so the common case needs no second step.
      await tx.userRole.upsert({ where: { userId_kind: { userId: targetUserId, kind: "MANAGER" } }, create: { userId: targetUserId, kind: "MANAGER" }, update: {} });
      newAssignmentNodeName = targetNode.name;
    }
  });

  // Sent after the transaction commits, same discipline create()/resendInvite() already
  // follow — a mail hiccup must never roll back a real DB change.
  if (newAssignmentNodeName) {
    await mail.send({
      to: target.email,
      subject: `You've been assigned to ${newAssignmentNodeName}`,
      html: `<p>Hello ${escapeHtml(target.name)},</p>
             <p>You have been assigned as the occupant of <b>${escapeHtml(newAssignmentNodeName)}</b> in the ASTU
             Laboratory Resource Management System.</p>
             <p><a href="${APP_ORIGIN}/login">Sign in</a> to see what this covers.</p>`,
    });
  }

  return one(targetUserId);
}

/**
 * F-015 of the 2026-09-15 campaign — there was no way to move a person to another
 * department at all: `assignNode` sets *occupancy* (headship), not membership, and
 * the only workaround (used once, in the campaign's own O-13 fixture) was a direct
 * DB edit, which then went on to expose F-004. SYS_ADMIN-only. Refuses while the
 * person still holds custody, has an open need, or has an open staged draft — each
 * of those is scoped to the OLD department by nature (custody, needs and drafts are
 * all raised/held by a person acting FOR their home unit), and moving them elsewhere
 * while one is outstanding would silently orphan it from the head who's supposed to
 * see it. Recorded in `HomeNodeChange`, mirroring `OrgNodeAssignment`'s own history
 * discipline for occupancy moves.
 */
export async function moveHomeNode(actorUserId: string, targetUserId: string, input: MoveHomeNodeInput): Promise<PersonDto> {
  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target) throw new HttpError(404, "Person not found");
  if (target.homeNodeId === input.nodeId) return one(targetUserId);

  if (input.nodeId) {
    const node = await prisma.orgNode.findUnique({ where: { id: input.nodeId } });
    if (!node || !node.active) throw new HttpError(400, "That department does not exist or is inactive");
  }

  const [custodyCount, openNeeds, openDrafts] = await Promise.all([
    prisma.item.count({ where: { custodianId: targetUserId } }),
    prisma.needLine.count({ where: { raisedById: targetUserId, status: "OPEN" } }),
    prisma.itemDraftChange.count({ where: { authorId: targetUserId, status: "OPEN" } }),
  ]);
  const blockers: string[] = [];
  if (custodyCount > 0) blockers.push(`is custodian of ${custodyCount} resource(s)`);
  if (openNeeds > 0) blockers.push(`has ${openNeeds} open purchasing need(s)`);
  if (openDrafts > 0) blockers.push(`has ${openDrafts} open staged draft change(s)`);
  if (blockers.length > 0) {
    throw new HttpError(400, `Cannot move "${target.name}" — they ${blockers.join("; ")}. Resolve these first, or move them after they're cleared.`);
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: targetUserId }, data: { homeNodeId: input.nodeId } }),
    prisma.homeNodeChange.create({
      data: { userId: targetUserId, fromNodeId: target.homeNodeId, toNodeId: input.nodeId, reason: input.reason ?? null, changedById: actorUserId },
    }),
  ]);
  return one(targetUserId);
}

/**
 * Just enough of a people directory to power pickers — a handover recipient, a transfer
 * contact. Was org/people.controller.ts's inline query (no separate service) in the
 * NestJS app; moved here for the same reason `me()` moved into auth.ts.
 */
/** Everyone who may be handed custody of a resource: custodians, store keepers and
 *  heads — the roles that answer for physical things. Deliberately NOT derived from
 *  who already custodies something in the register, or a brand-new store keeper
 *  could never be given the store they were hired to run. */
export async function custodians(q: string | undefined): Promise<PersonSummaryDto[]> {
  const rows = await prisma.user.findMany({
    where: {
      roles: { some: { kind: { in: ["CUSTODIAN", "STORE_KEEPER", "MANAGER"] } } },
      status: "ACTIVE",
      ...(q?.trim() ? { name: { contains: q.trim(), mode: "insensitive" as const } } : {}),
    },
    include: { homeNode: { select: { name: true } } },
    orderBy: { name: "asc" },
    take: 200,
  });
  return rows.map((r) => ({ id: r.id, name: r.name, email: r.email, homeNodeName: r.homeNode?.name ?? null }));
}

async function one(id: string): Promise<PersonDto> {
  const r = await prisma.user.findUnique({
    where: { id },
    include: { roles: true, homeNode: { select: { name: true } }, orgNode: { select: { id: true, name: true } } },
  });
  if (!r) throw new HttpError(404, "Person not found");
  const invitedByName = (await latestInviterByEmail([r.emailLower])).get(r.emailLower) ?? null;
  return toDto(r, invitedByName);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
