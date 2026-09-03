"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import type { RoleKind } from "@/lib/shared";
import { useAuth } from "@/lib/auth-context";
import { canAccessPath } from "@/lib/nav";
import { PermissionDenied } from "./states";

/**
 * Route-level role gate.
 *
 * Filtering the sidebar keeps the UI honest, but it is NOT access control — a student who
 * types /analyse/overview would otherwise get a half-rendered manager screen. This refuses
 * the route outright and names the boundary. The API enforces the same rules independently;
 * neither layer trusts the other.
 */
export default function RequireRole({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const pathname = usePathname();
  const roles = (me?.user.roles ?? []) as RoleKind[];

  if (!canAccessPath(pathname, roles)) {
    return <PermissionDenied attempted={pathname} roles={roles} />;
  }
  return <>{children}</>;
}
