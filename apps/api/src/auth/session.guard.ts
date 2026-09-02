import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { RoleKind } from "@sc-lab/shared";
import { PrismaService } from "../prisma/prisma.service";
import { hashToken } from "./token.util";

export const SESSION_COOKIE = "lrms_session";

/**
 * Resolves the httpOnly session cookie into req.user on every guarded request.
 *
 * A DISABLED user is refused here rather than at login, so deactivating someone takes
 * effect on their next request instead of whenever their cookie happens to expire.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const raw = req.cookies?.[SESSION_COOKIE];
    if (!raw) throw new UnauthorizedException("Not signed in");

    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(raw) },
      include: { user: { include: { roles: true } } },
    });

    if (!session || session.expiresAt < new Date()) {
      throw new UnauthorizedException("Session expired");
    }
    if (session.user.status === "DISABLED") {
      throw new UnauthorizedException("Account disabled");
    }

    req.user = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      roles: session.user.roles.map((r) => r.kind as RoleKind),
    };
    return true;
  }
}
