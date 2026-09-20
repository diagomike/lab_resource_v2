import "server-only";
import type {
  CreatePersonInput,
  CreatePersonResultDto,
  DeactivateResultDto,
  PersonDto,
  PersonSummaryDto,
  ResendInviteResultDto,
  RoleKind,
  UpdatePersonRolesInput,
} from "@/lib/shared";
import { prisma } from "../prisma";
import { HttpError } from "../http-error";
import * as scope from "../org/scope";
import * as mail from "../mail/mail";
import { generateToken, hashToken } from "../auth/token";

const INVITATION_TTL_DAYS = 7;
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
    // A department head assigns people INTO their own department, never elsewhere, and
    // never hands out node occupancy — that stays an admin-only act (see assignNode).
    homeNodeId = ownNodeId;
    nodeId = null;
  }

  const emailLower = input.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { emailLower } });
  if (existing) throw new HttpError(400, "A person with this email already exists");

  const raw = generateToken();
  let assignedNodeName: string | null = null;
  const created = await prisma.$transaction(async (tx) => {
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

export async function updateRoles(actorUserId: string, actorRoles: RoleKind[], id: string, input: UpdatePersonRolesInput): Promise<PersonDto> {
  const user = await prisma.user.findUnique({ where: { id }, include: { roles: true } });
  if (!user) throw new HttpError(404, "Person not found");
  await assertMayManageStaff(actorUserId, actorRoles, { id: user.id, homeNodeId: user.homeNodeId, roles: user.roles.map((r) => ({ kind: r.kind as RoleKind })) });
  if (!actorRoles.includes("SYS_ADMIN") && input.roles.some((r) => !MANAGER_INVITABLE_ROLES.includes(r))) {
    throw new HttpError(403, `A department head may only set ${MANAGER_INVITABLE_ROLES.join(" or ")} roles.`);
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
  const user = await prisma.user.findUnique({ where: { id }, include: { roles: true } });
  if (!user) throw new HttpError(404, "Person not found");
  await assertMayManageStaff(actorUserId, actorRoles, { id: user.id, homeNodeId: user.homeNodeId, roles: user.roles.map((r) => ({ kind: r.kind as RoleKind })) });

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
    const ownNodeId = await scope.ownNodeId(actorUserId);
    if (!ownNodeId || user.homeNodeId !== ownNodeId) {
      throw new HttpError(403, "You may only resend invitations within your own department");
    }
  }

  const raw = generateToken();
  await prisma.invitation.create({
    data: {
      emailLower: user.emailLower,
      tokenHash: hashToken(raw),
      intendedRole: (await prisma.userRole.findFirst({ where: { userId: id } }))?.kind ?? "STAFF",
      orgNodeId: user.homeNodeId,
      invitedById: actorUserId,
      expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000),
    },
  });
  const inviteUrl = `${APP_ORIGIN}/accept-invite?token=${raw}`;
  await mail.send({
    to: user.email,
    subject: "Your ASTU Lab Resources invitation",
    html: `<p>Hello ${escapeHtml(user.name)},</p>
           <p>Here is a fresh invitation link — the previous one, if any, no longer works. This link expires in ${INVITATION_TTL_DAYS} days.</p>
           <p><a href="${inviteUrl}">Accept your invitation and set a password</a></p>`,
  });
  return { inviteUrl };
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
