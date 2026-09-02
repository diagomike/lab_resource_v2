import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { RoleKind } from "@sc-lab/shared";

export interface AuthedUser {
  id: string;
  email: string;
  name: string;
  roles: RoleKind[];
}

/** Populated by SessionGuard. Never populated from a client-supplied header. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthedUser => {
  return ctx.switchToHttp().getRequest().user;
});
