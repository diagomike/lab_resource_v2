import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { RoleKind } from "@sc-lab/shared";
import { ROLES_KEY } from "./roles.decorator";

/**
 * Enforces @Roles(). Runs after SessionGuard, so req.user is already resolved.
 *
 * Roles stack: holding ANY one of the listed roles is enough. An ARA/SARA who is also an
 * instructor reaches both the custodian screens and the requester screens on one login.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<RoleKind[] | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user = ctx.switchToHttp().getRequest().user;
    const held: RoleKind[] = user?.roles ?? [];
    if (!required.some((r) => held.includes(r))) {
      throw new ForbiddenException(`Requires one of: ${required.join(", ")}`);
    }
    return true;
  }
}
