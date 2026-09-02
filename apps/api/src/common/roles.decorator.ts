import { SetMetadata } from "@nestjs/common";
import type { RoleKind } from "@sc-lab/shared";

export const ROLES_KEY = "roles";

/**
 * Layer 3 of the three independent RBAC layers. The other two — navFor() filtering the
 * sidebar and RequireRole refusing the route — live in the web app and are convenience
 * only. This one is the actual gate; it never trusts either of them.
 */
export const Roles = (...roles: RoleKind[]) => SetMetadata(ROLES_KEY, roles);
