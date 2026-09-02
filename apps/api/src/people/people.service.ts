import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreatePersonInput, DeactivateResultDto, PersonDto, RoleKind, UpdatePersonRolesInput } from "@sc-lab/shared";
import { PrismaService } from "../prisma/prisma.service";
import { ScopeService } from "../org/scope.service";
import { MailService } from "../mail/mail.service";
import { generateToken, hashToken } from "../auth/token.util";

const INVITATION_TTL_DAYS = 7;
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:5173";
/** A MANAGER inviting into their own department may only bring in the people who actually
 *  do hands-on work there — never another manager, and never a university-wide office. */
const MANAGER_INVITABLE_ROLES: RoleKind[] = ["CUSTODIAN", "STAFF"];

@Injectable()
export class PeopleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly mail: MailService,
  ) {}

  /**
   * SYS_ADMIN sees everyone. A MANAGER sees everyone reachable from their own scope — the
   * same `visibleNodeIds` reports and the asset register use — so a dean can see personnel
   * across every department below them, not just their own.
   */
  async list(actorUserId: string, actorRoles: RoleKind[]): Promise<PersonDto[]> {
    const isAdmin = actorRoles.includes("SYS_ADMIN");
    let where = {};
    if (!isAdmin) {
      const visible = await this.scope.visibleNodeIds(actorUserId);
      if (visible.length === 0) return [];
      where = { OR: [{ homeNodeId: { in: visible } }, { orgNode: { id: { in: visible } } }] };
    }

    const rows = await this.prisma.user.findMany({
      where,
      include: { roles: true, homeNode: { select: { name: true } }, orgNode: { select: { id: true, name: true } } },
      orderBy: { name: "asc" },
    });

    const latestInviteByEmail = await this.latestInviterByEmail(rows.map((r) => r.emailLower));
    return rows.map((r) => this.toDto(r, latestInviteByEmail.get(r.emailLower) ?? null));
  }

  /** Most recent inviter's name per email, batched in one query rather than N+1 — list()
   *  is the only caller with more than one row at a time. */
  private async latestInviterByEmail(emails: string[]): Promise<Map<string, string | null>> {
    const map = new Map<string, string | null>();
    if (emails.length === 0) return map;
    const invitations = await this.prisma.invitation.findMany({
      where: { emailLower: { in: emails } },
      orderBy: { createdAt: "desc" },
      include: { invitedBy: { select: { name: true } } },
    });
    for (const inv of invitations) {
      if (!map.has(inv.emailLower)) map.set(inv.emailLower, inv.invitedBy?.name ?? null);
    }
    return map;
  }

  private toDto(
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
  async create(actorUserId: string, actorRoles: RoleKind[], input: CreatePersonInput): Promise<PersonDto> {
    const isAdmin = actorRoles.includes("SYS_ADMIN");
    const roles = input.roles;
    let homeNodeId = input.homeNodeId ?? null;
    let nodeId = input.nodeId ?? null;

    if (!isAdmin) {
      if (!actorRoles.includes("MANAGER")) {
        throw new ForbiddenException("Only an admin or a department head may add personnel");
      }
      const ownNodeId = await this.scope.ownNodeId(actorUserId);
      if (!ownNodeId) throw new BadRequestException("You do not occupy a department");
      if (roles.some((r) => !MANAGER_INVITABLE_ROLES.includes(r))) {
        throw new ForbiddenException(`A department head may only add ${MANAGER_INVITABLE_ROLES.join(" or ")} personnel`);
      }
      // A department head assigns people INTO their own department, never elsewhere, and
      // never hands out node occupancy — that stays an admin-only act (see assignNode).
      homeNodeId = ownNodeId;
      nodeId = null;
    }

    const emailLower = input.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { emailLower } });
    if (existing) throw new BadRequestException("A person with this email already exists");

    const raw = generateToken();
    let assignedNodeName: string | null = null;
    const created = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: input.email, emailLower, name: input.name, phone: input.phone ?? null, homeNodeId, status: "INVITED" },
      });
      await tx.userRole.createMany({ data: roles.map((kind) => ({ userId: user.id, kind })) });

      if (nodeId) {
        const targetNode = await tx.orgNode.findUnique({ where: { id: nodeId } });
        if (!targetNode) throw new BadRequestException("Org node not found");
        if (targetNode.userId) {
          throw new BadRequestException(`"${targetNode.name}" already has an occupant — use a transition to replace them`);
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

    await this.mail.send({
      to: created.email,
      subject: "You're invited to ASTU Lab Resources",
      html: `<p>Hello ${escapeHtml(created.name)},</p>
             <p>You have been added to the ASTU Laboratory Resource Management System${
               assignedNodeName ? ` as the occupant of <b>${escapeHtml(assignedNodeName)}</b>` : ""
             }. This link expires in ${INVITATION_TTL_DAYS} days.</p>
             <p><a href="${WEB_ORIGIN}/accept-invite?token=${raw}">Accept your invitation and set a password</a></p>`,
    });

    return this.one(created.id);
  }

  async updateRoles(id: string, input: UpdatePersonRolesInput): Promise<PersonDto> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException("Person not found");
    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({ where: { userId: id } }),
      this.prisma.userRole.createMany({ data: input.roles.map((kind) => ({ userId: id, kind })) }),
    ]);
    return this.one(id);
  }

  /**
   * A DISABLED user is refused at SessionGuard, so a disabled occupant could never again
   * sign in to act on the node they hold — every approval step and scope query routed
   * through it would stall permanently. Deactivating therefore vacates any node they
   * occupy in the same transaction, and says so, rather than leaving that discovered later
   * as a stuck approval chain.
   */
  async deactivate(id: string): Promise<DeactivateResultDto> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException("Person not found");

    return this.prisma.$transaction(async (tx) => {
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
      return { ok: true as const, vacatedNodeName: occupied?.name ?? null };
    });
  }

  async reactivate(id: string): Promise<PersonDto> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException("Person not found");
    await this.prisma.user.update({ where: { id }, data: { status: user.passwordHash ? "ACTIVE" : "INVITED" } });
    return this.one(id);
  }

  async resendInvite(actorUserId: string, actorRoles: RoleKind[], id: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException("Person not found");
    if (user.passwordHash) throw new BadRequestException("This person has already registered");

    if (!actorRoles.includes("SYS_ADMIN")) {
      const ownNodeId = await this.scope.ownNodeId(actorUserId);
      if (!ownNodeId || user.homeNodeId !== ownNodeId) {
        throw new ForbiddenException("You may only resend invitations within your own department");
      }
    }

    const raw = generateToken();
    await this.prisma.invitation.create({
      data: {
        emailLower: user.emailLower,
        tokenHash: hashToken(raw),
        intendedRole: (await this.prisma.userRole.findFirst({ where: { userId: id } }))?.kind ?? "STAFF",
        orgNodeId: user.homeNodeId,
        invitedById: actorUserId,
        expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000),
      },
    });
    await this.mail.send({
      to: user.email,
      subject: "Your ASTU Lab Resources invitation",
      html: `<p>Hello ${escapeHtml(user.name)},</p>
             <p>Here is a fresh invitation link — the previous one, if any, no longer works. This link expires in ${INVITATION_TTL_DAYS} days.</p>
             <p><a href="${WEB_ORIGIN}/accept-invite?token=${raw}">Accept your invitation and set a password</a></p>`,
    });
  }

  /**
   * SYS_ADMIN-only. `nodeId: null` vacates whatever node this person currently occupies.
   * Assigning a node that already has a different occupant is a TRANSITION: the previous
   * occupant is vacated as part of the same call, and both sides are recorded in
   * OrgNodeAssignment — this is what makes "who held this before" answerable later.
   */
  async assignNode(actorUserId: string, targetUserId: string, nodeId: string | null, reason?: string): Promise<PersonDto> {
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) throw new NotFoundException("Person not found");

    // Set only when this call actually creates a fresh occupancy (not a vacate, and not a
    // no-op re-save of the same occupant) — that's the one case this person needs telling,
    // same trigger point create()'s invite email uses.
    let newAssignmentNodeName: string | null = null;

    await this.prisma.$transaction(async (tx) => {
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
      if (!targetNode) throw new NotFoundException("Org node not found");

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
        newAssignmentNodeName = targetNode.name;
      }
    });

    // Sent after the transaction commits, same discipline create()/resendInvite() already
    // follow — a mail hiccup must never roll back a real DB change.
    if (newAssignmentNodeName) {
      await this.mail.send({
        to: target.email,
        subject: `You've been assigned to ${newAssignmentNodeName}`,
        html: `<p>Hello ${escapeHtml(target.name)},</p>
               <p>You have been assigned as the occupant of <b>${escapeHtml(newAssignmentNodeName)}</b> in the ASTU
               Laboratory Resource Management System.</p>
               <p><a href="${WEB_ORIGIN}/login">Sign in</a> to see what this covers.</p>`,
      });
    }

    return this.one(targetUserId);
  }

  private async one(id: string): Promise<PersonDto> {
    const r = await this.prisma.user.findUnique({
      where: { id },
      include: { roles: true, homeNode: { select: { name: true } }, orgNode: { select: { id: true, name: true } } },
    });
    if (!r) throw new NotFoundException("Person not found");
    const invitedByName = (await this.latestInviterByEmail([r.emailLower])).get(r.emailLower) ?? null;
    return this.toDto(r, invitedByName);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
