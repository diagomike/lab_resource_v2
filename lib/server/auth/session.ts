import "server-only";
import type { NextRequest, NextResponse } from "next/server";
import type { RoleKind } from "@/lib/shared";
import { prisma } from "../prisma";
import { HttpError } from "../http-error";
import { hashToken } from "./token";

export const SESSION_COOKIE = "lrms_session";

const PASSWORD_CHANGE_ALLOWED = new Set(["/api/auth/me", "/api/auth/logout", "/api/auth/change-password"]);

export interface AuthedUser {
  id: string;
  email: string;
  name: string;
  roles: RoleKind[];
}

/**
 * Replaces `session.guard.ts`'s `canActivate`, reproduced exactly (including the three
 * distinct 401 messages — verified against docs/pre-conversion-api-reference.md).
 * A DISABLED user is refused here rather than at login, so deactivating someone takes
 * effect on their next request instead of whenever their cookie happens to expire.
 * Never populated from a client-supplied header — only from the httpOnly cookie.
 */
export async function requireSession(request: NextRequest): Promise<AuthedUser> {
  const raw = request.cookies.get(SESSION_COOKIE)?.value;
  if (!raw) throw new HttpError(401, "Not signed in");

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(raw) },
    include: { user: { include: { roles: true } } },
  });

  if (!session || session.expiresAt < new Date()) {
    throw new HttpError(401, "Session expired");
  }
  if (session.user.status === "DISABLED") {
    throw new HttpError(401, "Account disabled");
  }
  // An administrator-issued temporary password must be replaced before the account
  // can do anything else — only the three calls the change screen itself needs pass.
  if (session.user.mustChangePassword && !PASSWORD_CHANGE_ALLOWED.has(request.nextUrl.pathname)) {
    throw new HttpError(403, "Choose a new password before continuing.", { code: "PASSWORD_CHANGE_REQUIRED", message: "Choose a new password before continuing.", statusCode: 403 });
  }

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    roles: session.user.roles.map((r) => r.kind as RoleKind),
  };
}

/**
 * Replaces `roles.guard.ts` + `@Roles(...)`. Roles stack: holding ANY one of the listed
 * roles is enough — an ARA/SARA who is also an instructor reaches both the custodian
 * screens and the requester screens on one login. An empty/omitted `allowed` list means
 * no role restriction (matches RolesGuard's `if (!required || required.length === 0)
 * return true`).
 */
/** Every role except STUDENT/EXTERNAL — F-031 of the 2026-09-15 campaign: the
 *  asset register's own read routes called only `requireSession`, trusting
 *  `resources/scope.ts`'s own header, which says the opposite ("The per-endpoint
 *  RBAC layer, not this module, is what actually keeps a student off the asset
 *  register"). A student or external account with a home node got
 *  `defaultModeFor`'s ORG_SUBTREE scope like anyone else, exposing their whole
 *  department's locations, custodian names and statuses. */
export const STAFF_ROLES: RoleKind[] = ["SYS_ADMIN", "PROPERTY_ADMIN", "PROCUREMENT", "MANAGER", "CUSTODIAN", "STAFF", "STORE_KEEPER"];

export function requireRole(user: AuthedUser, allowed: RoleKind[]): void {
  if (allowed.length === 0) return;
  if (!allowed.some((r) => user.roles.includes(r))) {
    throw new HttpError(403, `Requires one of: ${allowed.join(", ")}`);
  }
}

const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS ?? 7);

/** Sets the httpOnly session cookie on a Route Handler's response — the direct
 *  equivalent of auth.controller.ts's `res.cookie(SESSION_COOKIE, token, {...})`.
 *  `maxAge` is in SECONDS here (the Web Cookie API convention Next's cookie store
 *  follows), not the milliseconds Express's `res.cookie` takes — verified against the
 *  recorded reference's `Max-Age=604800` for the default 7-day TTL. */
export function setSessionCookie(response: NextResponse, token: string): void {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_DAYS * 86_400,
    path: "/",
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.delete(SESSION_COOKIE);
}
