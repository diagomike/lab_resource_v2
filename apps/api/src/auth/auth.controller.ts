import { Body, Controller, Get, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import {
  ChangePasswordInput,
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
  type MeContextDto,
  type SessionUserDto,
  type WorkspaceKind,
} from "@sc-lab/shared";
import { ZodValidationPipe } from "../common/zod.pipe";
import { CurrentUser, type AuthedUser } from "../common/current-user.decorator";
import { ScopeService } from "../org/scope.service";
import { PrismaService } from "../prisma/prisma.service";
import { AuthService } from "./auth.service";
import { SESSION_COOKIE, SessionGuard } from "./session.guard";

const isProd = process.env.NODE_ENV === "production";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
  ) {}

  @Post("login")
  async login(
    @Body(new ZodValidationPipe(LoginInput)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionUserDto> {
    const { token, user } = await this.auth.login(body, {
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      // Secure only in production: a local dev server is plain http, and a Secure cookie
      // would silently never be set there.
      secure: isProd,
      maxAge: Number(process.env.SESSION_TTL_DAYS ?? 7) * 86_400_000,
      path: "/",
    });
    return user;
  }

  @Post("logout")
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(req.cookies?.[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
  }

  @Post("register")
  async register(@Body(new ZodValidationPipe(RegisterInput)) body: RegisterInput) {
    return this.auth.register(body);
  }

  @Post("forgot-password")
  async forgotPassword(@Body(new ZodValidationPipe(ForgotPasswordInput)) body: ForgotPasswordInput): Promise<{ ok: true }> {
    await this.auth.forgotPassword(body);
    return { ok: true };
  }

  @Post("reset-password")
  async resetPassword(@Body(new ZodValidationPipe(ResetPasswordInput)) body: ResetPasswordInput): Promise<{ ok: true }> {
    await this.auth.resetPassword(body);
    return { ok: true };
  }

  @Post("change-password")
  @UseGuards(SessionGuard)
  async changePassword(@CurrentUser() user: AuthedUser, @Body(new ZodValidationPipe(ChangePasswordInput)) body: ChangePasswordInput) {
    await this.auth.changePassword(user.id, body.currentPassword, body.newPassword);
    return { ok: true };
  }

  /** Everything the shell needs on first paint. */
  @Get("me")
  @UseGuards(SessionGuard)
  async me(@CurrentUser() user: AuthedUser): Promise<MeContextDto> {
    const row = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { orgNode: true },
    });

    const reachable = await this.scope.visibleNodeIds(user.id);
    const isGlobal = await this.scope.hasGlobalReach(user.id);

    // Occupancy first, homeNodeId second — the SAME two branches ScopeService's own
    // reachRootNodeId() uses. Reading only row.orgNode here is what left every CUSTODIAN
    // with `scope: null` despite having genuine reach, so the client and the server
    // disagreed about which unit that person acts for. This aligns them; it grants no
    // reach that ScopeService was not already granting.
    const occupied = row.orgNode;
    const node =
      occupied ??
      (row.homeNodeId
        ? await this.prisma.orgNode.findUnique({ where: { id: row.homeNodeId } })
        : null);

    // A leaf is a node with no children of its own — a department, in practice. It is
    // computed rather than stored because adding a child under a department must
    // silently stop it being a leaf, with no migration and no stale flag.
    const childCount = node
      ? await this.prisma.orgEdge.count({ where: { parentId: node.id } })
      : 0;

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
      canSeeCost: await this.scope.canSeeCost(user.id),
      ...workspacesFor(user.roles, node?.kind ?? null),
    };
  }
}

/**
 * Which of the four purpose-built shells this role set opens into — computed here, once,
 * server-side, rather than re-derived in the client (the same discipline canSeeCost
 * already follows). A department head occupies a DEPARTMENT node; a dean or the AVP
 * occupies a COLLEGE/UNIVERSITY node; PROPERTY_ADMIN and PROCUREMENT are approvers by role
 * regardless of node, per ScopeService's own global-reach list.
 *
 * Anyone who doesn't match admin/department/approver — a plain CUSTODIAN, STAFF or
 * STUDENT — falls back to the "custodian" shell. For an actual custodian that's their
 * real workspace; for STAFF/STUDENT it's the closest fit (their own resources: bookings,
 * loans, requests) rather than a fifth shell this phase does not build.
 */
function workspacesFor(roles: string[], occupiedNodeKind: string | null): { workspace: WorkspaceKind; availableWorkspaces: WorkspaceKind[] } {
  const set = new Set<WorkspaceKind>();
  if (roles.includes("SYS_ADMIN")) set.add("admin");
  if (roles.includes("MANAGER") && occupiedNodeKind === "DEPARTMENT") set.add("department");
  if (
    roles.includes("PROPERTY_ADMIN") ||
    roles.includes("PROCUREMENT") ||
    (roles.includes("MANAGER") && occupiedNodeKind !== null && occupiedNodeKind !== "DEPARTMENT")
  ) {
    set.add("approver");
  }
  if (set.size === 0 || roles.includes("CUSTODIAN")) set.add("custodian");

  const precedence: WorkspaceKind[] = ["admin", "department", "approver", "custodian"];
  const availableWorkspaces = precedence.filter((w) => set.has(w));
  return { workspace: availableWorkspaces[0], availableWorkspaces };
}
