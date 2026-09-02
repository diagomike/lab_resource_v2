import "server-only";
import * as argon2 from "argon2";
import type {
  ForgotPasswordInput,
  LoginInput,
  MeContextDto,
  RegisterInput,
  ResetPasswordInput,
  SessionUserDto,
  RoleKind,
  WorkspaceKind,
} from "@/lib/shared";
import { prisma } from "../prisma";
import { HttpError } from "../http-error";
import * as mail from "../mail/mail";
import * as scope from "../org/scope";
import { generateToken, hashIp, hashToken } from "./token";

const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS ?? 7);
const PASSWORD_RESET_TTL_HOURS = 2;
// Renamed from WEB_ORIGIN: same purpose (the app's own public origin, for absolute
// links in emails), no longer double-duty as "the frontend dev server's CORS origin"
// now that everything is same-origin.
const APP_ORIGIN = process.env.APP_ORIGIN ?? "http://localhost:3000";

/**
 * Returns the RAW session token, which the route handler puts straight into an httpOnly
 * cookie and never returns in a body. Only its hash reaches the database.
 */
export async function login(
  input: LoginInput,
  meta: { ip?: string; userAgent?: string },
): Promise<{ token: string; user: SessionUserDto }> {
  const user = await prisma.user.findUnique({
    where: { emailLower: input.email.toLowerCase() },
    include: { roles: true },
  });

  // One message for "no such user" and "wrong password" alike — a distinct error would
  // turn the login form into an account-enumeration oracle.
  if (!user || !user.passwordHash) throw new HttpError(401, "Invalid email or password");
  if (user.status === "DISABLED") throw new HttpError(401, "Account disabled");
  if (!(await argon2.verify(user.passwordHash, input.password))) {
    throw new HttpError(401, "Invalid email or password");
  }

  const raw = generateToken();
  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000),
      ipHash: hashIp(meta.ip),
      userAgent: meta.userAgent?.slice(0, 255),
    },
  });

  return { token: raw, user: toDto(user, user.roles.map((r) => r.kind as RoleKind)) };
}

export async function logout(rawToken: string | undefined): Promise<void> {
  if (!rawToken) return;
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(rawToken) } });
}

/** Consumes an invitation: sets the password, activates the user, burns the token. */
export async function register(input: RegisterInput): Promise<{ email: string }> {
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(input.token) },
  });
  if (!invitation) throw new HttpError(400, "This invitation link is not valid");
  if (invitation.consumedAt) throw new HttpError(400, "This invitation has already been used");
  if (invitation.expiresAt < new Date()) throw new HttpError(400, "This invitation has expired");

  const user = await prisma.user.findUnique({ where: { emailLower: invitation.emailLower } });
  if (!user) throw new HttpError(400, "No account matches this invitation");

  const passwordHash = await argon2.hash(input.password);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { name: input.name, phone: input.phone ?? null, passwordHash, status: "ACTIVE" },
    }),
    prisma.invitation.update({
      where: { id: invitation.id },
      data: { consumedAt: new Date() },
    }),
  ]);

  return { email: user.email };
}

/**
 * Always resolves successfully whether or not the email matches an account, and whether
 * or not that account has ever set a password — the same account-enumeration reasoning
 * login's single error message follows. The mail only actually goes out on a real match.
 */
export async function forgotPassword(input: ForgotPasswordInput): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { emailLower: input.email.toLowerCase() },
  });
  if (!user || user.status === "DISABLED") return;

  const raw = generateToken();
  await prisma.passwordReset.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_HOURS * 3_600_000),
    },
  });

  await mail.send({
    to: user.email,
    subject: "Reset your ASTU Lab Resources password",
    html: `<p>Hello ${escapeHtml(user.name)},</p>
           <p>Someone requested a password reset for this account. This link expires in ${PASSWORD_RESET_TTL_HOURS} hours.</p>
           <p><a href="${APP_ORIGIN}/reset-password?token=${raw}">Reset your password</a></p>
           <p>If you did not request this, you can ignore this email — your password will not change.</p>`,
  });
}

export async function resetPassword(input: ResetPasswordInput): Promise<void> {
  const reset = await prisma.passwordReset.findUnique({
    where: { tokenHash: hashToken(input.token) },
  });
  if (!reset) throw new HttpError(400, "This reset link is not valid");
  if (reset.consumedAt) throw new HttpError(400, "This reset link has already been used");
  if (reset.expiresAt < new Date()) throw new HttpError(400, "This reset link has expired");

  const passwordHash = await argon2.hash(input.newPassword);
  await prisma.$transaction([
    prisma.user.update({ where: { id: reset.userId }, data: { passwordHash } }),
    prisma.passwordReset.update({ where: { id: reset.id }, data: { consumedAt: new Date() } }),
    // A password reset is how you respond to a suspected compromise, same as
    // changePassword — every existing session dies with the old password.
    prisma.session.deleteMany({ where: { userId: reset.userId } }),
  ]);
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.passwordHash) throw new HttpError(400, "Account has no password set");
  if (!(await argon2.verify(user.passwordHash, currentPassword))) {
    throw new HttpError(400, "Current password is incorrect");
  }
  const passwordHash = await argon2.hash(newPassword);
  // Changing a password invalidates every OTHER session — a password change is how you
  // respond to a suspected compromise, so leaving old cookies alive would defeat it.
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    prisma.session.deleteMany({ where: { userId } }),
  ]);
}

/**
 * Everything the shell needs on first paint: who you are, which unit you are acting for,
 * and which of the four workspace shells you open into. Was embedded directly in
 * auth.controller.ts's `me()` handler (not a service method) in the NestJS app; moved
 * here so the route handler stays a thin wrapper like every other endpoint.
 */
export async function me(user: { id: string; roles: RoleKind[] }): Promise<MeContextDto> {
  const row = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    include: { orgNode: true },
  });

  const reachable = await scope.visibleNodeIds(user.id);
  const isGlobal = await scope.hasGlobalReach(user.id);

  // Occupancy first, homeNodeId second — the SAME two branches scope.ts's own
  // reachRootNodeId() uses. Reading only row.orgNode here is what left every CUSTODIAN
  // with `scope: null` despite having genuine reach, so the client and the server
  // disagreed about which unit that person acts for. This aligns them; it grants no
  // reach that scope.ts was not already granting.
  const occupied = row.orgNode;
  const node = occupied ?? (row.homeNodeId ? await prisma.orgNode.findUnique({ where: { id: row.homeNodeId } }) : null);

  // A leaf is a node with no children of its own — a department, in practice. It is
  // computed rather than stored because adding a child under a department must
  // silently stop it being a leaf, with no migration and no stale flag.
  const childCount = node ? await prisma.orgEdge.count({ where: { parentId: node.id } }) : 0;

  return {
    user: {
      id: row.id,
      email: row.email,
      name: row.name,
      phone: row.phone,
      status: row.status,
      roles: user.roles,
    },
    scope: node
      ? {
          nodeId: node.id,
          name: node.name,
          level: node.level,
          kind: node.kind,
          isLeaf: childCount === 0,
          isGlobal,
          isOccupant: occupied !== null,
          reachableNodeCount: reachable.length,
        }
      : isGlobal
        ? {
            // SYS_ADMIN and the university offices occupy no node on purpose: giving
            // them one would add a phantom level to the org chart.
            nodeId: null,
            name: "Entire university",
            level: 0,
            kind: null,
            isLeaf: false,
            isGlobal: true,
            isOccupant: false,
            reachableNodeCount: reachable.length,
          }
        : null,
    canSeeCost: await scope.canSeeCost(user.id),
    ...workspacesFor(user.roles, node?.kind ?? null),
  };
}

/**
 * Which of the four purpose-built shells this role set opens into — computed here, once,
 * server-side, rather than re-derived in the client (the same discipline canSeeCost
 * already follows). A department head occupies a DEPARTMENT node; a dean or the AVP
 * occupies a COLLEGE/UNIVERSITY node; PROPERTY_ADMIN and PROCUREMENT are approvers by role
 * regardless of node, per scope.ts's own global-reach list.
 *
 * STORE_KEEPER is grouped with PROPERTY_ADMIN/PROCUREMENT — university-wide reach by role,
 * same as those two offices — even though its actual resource-register reach will come
 * through the access-view system (Phase 11 of the replatforming plan), not org edges.
 *
 * Anyone who doesn't match admin/department/approver — a plain CUSTODIAN, STAFF or
 * STUDENT — falls back to the "custodian" shell. For an actual custodian that's their
 * real workspace; for STAFF/STUDENT it's the closest fit (their own resources: bookings,
 * loans, requests) rather than a fifth shell this phase does not build. EXTERNAL falls
 * back the same way for now — nothing in this phase creates an EXTERNAL session, and this
 * whole 4-workspace model is itself scheduled for removal (replatforming Phase 5) in
 * favour of one sidebar with server-enforced scope.
 */
function workspacesFor(
  roles: string[],
  occupiedNodeKind: string | null,
): { workspace: WorkspaceKind; availableWorkspaces: WorkspaceKind[] } {
  const set = new Set<WorkspaceKind>();
  if (roles.includes("SYS_ADMIN")) set.add("admin");
  if (roles.includes("MANAGER") && occupiedNodeKind === "DEPARTMENT") set.add("department");
  if (
    roles.includes("PROPERTY_ADMIN") ||
    roles.includes("PROCUREMENT") ||
    roles.includes("STORE_KEEPER") ||
    (roles.includes("MANAGER") && occupiedNodeKind !== null && occupiedNodeKind !== "DEPARTMENT")
  ) {
    set.add("approver");
  }
  if (set.size === 0 || roles.includes("CUSTODIAN")) set.add("custodian");

  const precedence: WorkspaceKind[] = ["admin", "department", "approver", "custodian"];
  const availableWorkspaces = precedence.filter((w) => set.has(w));
  return { workspace: availableWorkspaces[0], availableWorkspaces };
}

function toDto(
  user: { id: string; email: string; name: string; phone: string | null; status: string },
  roles: RoleKind[],
): SessionUserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone,
    status: user.status as SessionUserDto["status"],
    roles,
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
