import "server-only";
// @node-rs/argon2, not the `argon2` package — that one's native addon ships
// platform-specific .node binaries that Next's output tracing routinely misses on
// Vercel (the failure mode: nobody can log in). @node-rs/argon2 is prebuilt NAPI with
// per-platform packages instead of a build step, and is a drop-in replacement here:
// identical hash(password)/verify(hash, password) signatures, and verification reads
// its parameters from the PHC string itself, so every hash `argon2` already produced
// keeps verifying correctly — no migration, no re-hash-on-next-login shim needed.
import * as argon2 from "@node-rs/argon2";
import type {
  ForgotPasswordInput,
  LoginInput,
  MeContextDto,
  RegisterInput,
  ResetPasswordInput,
  SessionUserDto,
  RoleKind,
} from "@/lib/shared";
import { prisma } from "../prisma";
import { HttpError } from "../http-error";
import * as mail from "../mail/mail";
import * as scope from "../org/scope";
import * as itemScope from "../resources/scope";
import { listSummariesForPerson } from "../resources/views";
import { generateToken, hashIp, hashToken } from "./token";

const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS ?? 7);
const PASSWORD_RESET_TTL_HOURS = 2;
// F-010 of the 2026-09-15 campaign — neither login nor forgot-password had any
// throttle at all. Both are table-counted (the same serverless-safe technique
// external/requests.ts's submission throttle already uses), locked per ACCOUNT
// (emailLower), not per IP: an attacker spread across many IPs is the realistic
// threat model, and an IP-keyed lock would take out a whole shared-NAT lab instead.
const LOGIN_LOCKOUT_WINDOW_MS = 15 * 60_000;
const MAX_LOGIN_FAILURES_PER_WINDOW = 5;
const PASSWORD_RESET_WINDOW_MS = 60 * 60_000;
const MAX_PASSWORD_RESETS_PER_WINDOW = 3;
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
  const emailLower = input.email.toLowerCase();
  const ipHash = hashIp(meta.ip);

  const since = new Date(Date.now() - LOGIN_LOCKOUT_WINDOW_MS);
  const recentFailures = await prisma.loginAttempt.count({ where: { emailLower, succeeded: false, createdAt: { gte: since } } });
  if (recentFailures >= MAX_LOGIN_FAILURES_PER_WINDOW) {
    throw new HttpError(401, "Too many failed attempts on this account — wait 15 minutes and try again.");
  }

  const user = await prisma.user.findUnique({
    where: { emailLower },
    include: { roles: true },
  });

  // One message for "no such user" and "wrong password" alike — a distinct error would
  // turn the login form into an account-enumeration oracle.
  if (!user || !user.passwordHash) {
    await prisma.loginAttempt.create({ data: { emailLower, ipHash, succeeded: false } });
    throw new HttpError(401, "Invalid email or password");
  }
  if (user.status === "DISABLED") {
    await prisma.loginAttempt.create({ data: { emailLower, ipHash, succeeded: false } });
    throw new HttpError(401, "Account disabled");
  }
  if (!(await argon2.verify(user.passwordHash, input.password))) {
    await prisma.loginAttempt.create({ data: { emailLower, ipHash, succeeded: false } });
    throw new HttpError(401, "Invalid email or password");
  }
  await prisma.loginAttempt.create({ data: { emailLower, ipHash, succeeded: true } });

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
  // F-012 of the 2026-09-15 campaign: a DISABLED account (deactivated after being
  // invited, before ever accepting) must not be reactivated by consuming a leftover
  // token — `people.deactivate` now also expires every open invitation for the same
  // reason, so this is the second, independent half of the same fix, not a
  // duplicate: whichever of the two a future code path forgets, the other still
  // holds. status is the identity check that actually matters here; "INVITED" vs.
  // "ACTIVE" is not (re-accepting an already-active account is refused by the
  // invitation's own consumedAt check above in the normal case, but a person could
  // in principle be re-invited without a status change — status ACTIVE/INVITED are
  // both fine to proceed from, only DISABLED is not).
  if (user.status === "DISABLED") throw new HttpError(400, "This account has been disabled — contact an administrator.");

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
  // F-009 of the 2026-09-15 campaign: an account with no password yet — INVITED, or
  // any other state that never completed register() — has no password to reset. A
  // reset link for one silently became a second, un-expiring onboarding path that
  // bypassed the invitation's own 7-day expiry and never changed status off INVITED,
  // so `login`'s "invalid email or password" gate was the only thing (accidentally)
  // stopping it from signing in immediately. Still returns silently either way — the
  // same account-enumeration reasoning as everywhere else in this file.
  if (!user || user.status === "DISABLED" || !user.passwordHash) return;

  // F-010: at most 3 reset emails per account per hour — unthrottled, this could
  // flood any mailbox and, on the shared Gmail SMTP relay, exhaust the daily sending
  // quota, after which invitations and quote emails silently stop going out too.
  const since = new Date(Date.now() - PASSWORD_RESET_WINDOW_MS);
  const recent = await prisma.passwordReset.count({ where: { userId: user.id, createdAt: { gte: since } } });
  if (recent >= MAX_PASSWORD_RESETS_PER_WINDOW) return;

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
 * Everything the shell needs on first paint: who you are, which unit you are acting
 * for, and how the resource register resolves for you. Was embedded directly in
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
    scopeMode: await itemScope.defaultModeFor(user.id),
    // Real rows since Track 1 (~/.claude/plans/lets-merge-the-work-memoized-journal.md)
    // — empty exactly as before until an administrator actually creates an AccessView.
    views: await listSummariesForPerson(user.id),
  };
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
