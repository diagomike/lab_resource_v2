import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import * as argon2 from "argon2";
import type { ForgotPasswordInput, LoginInput, RegisterInput, ResetPasswordInput, SessionUserDto, RoleKind } from "@sc-lab/shared";
import { PrismaService } from "../prisma/prisma.service";
import { MailService } from "../mail/mail.service";
import { generateToken, hashIp, hashToken } from "./token.util";

const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS ?? 7);
const PASSWORD_RESET_TTL_HOURS = 2;
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:5173";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  /**
   * Returns the RAW session token, which the controller puts straight into an httpOnly
   * cookie and never returns in a body. Only its hash reaches the database.
   */
  async login(
    input: LoginInput,
    meta: { ip?: string; userAgent?: string },
  ): Promise<{ token: string; user: SessionUserDto }> {
    const user = await this.prisma.user.findUnique({
      where: { emailLower: input.email.toLowerCase() },
      include: { roles: true },
    });

    // One message for "no such user" and "wrong password" alike — a distinct error would
    // turn the login form into an account-enumeration oracle.
    if (!user || !user.passwordHash) throw new UnauthorizedException("Invalid email or password");
    if (user.status === "DISABLED") throw new UnauthorizedException("Account disabled");
    if (!(await argon2.verify(user.passwordHash, input.password))) {
      throw new UnauthorizedException("Invalid email or password");
    }

    const raw = generateToken();
    await this.prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000),
        ipHash: hashIp(meta.ip),
        userAgent: meta.userAgent?.slice(0, 255),
      },
    });

    return { token: raw, user: this.toDto(user, user.roles.map((r) => r.kind as RoleKind)) };
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    await this.prisma.session.deleteMany({ where: { tokenHash: hashToken(rawToken) } });
  }

  /** Consumes an invitation: sets the password, activates the user, burns the token. */
  async register(input: RegisterInput): Promise<{ email: string }> {
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: hashToken(input.token) },
    });
    if (!invitation) throw new BadRequestException("This invitation link is not valid");
    if (invitation.consumedAt) throw new BadRequestException("This invitation has already been used");
    if (invitation.expiresAt < new Date()) throw new BadRequestException("This invitation has expired");

    const user = await this.prisma.user.findUnique({ where: { emailLower: invitation.emailLower } });
    if (!user) throw new BadRequestException("No account matches this invitation");

    const passwordHash = await argon2.hash(input.password);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { name: input.name, phone: input.phone ?? null, passwordHash, status: "ACTIVE" },
      }),
      this.prisma.invitation.update({
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
  async forgotPassword(input: ForgotPasswordInput): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { emailLower: input.email.toLowerCase() },
    });
    if (!user || user.status === "DISABLED") return;

    const raw = generateToken();
    await this.prisma.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_HOURS * 3_600_000),
      },
    });

    await this.mail.send({
      to: user.email,
      subject: "Reset your ASTU Lab Resources password",
      html: `<p>Hello ${escapeHtml(user.name)},</p>
             <p>Someone requested a password reset for this account. This link expires in ${PASSWORD_RESET_TTL_HOURS} hours.</p>
             <p><a href="${WEB_ORIGIN}/reset-password?token=${raw}">Reset your password</a></p>
             <p>If you did not request this, you can ignore this email — your password will not change.</p>`,
    });
  }

  async resetPassword(input: ResetPasswordInput): Promise<void> {
    const reset = await this.prisma.passwordReset.findUnique({
      where: { tokenHash: hashToken(input.token) },
    });
    if (!reset) throw new BadRequestException("This reset link is not valid");
    if (reset.consumedAt) throw new BadRequestException("This reset link has already been used");
    if (reset.expiresAt < new Date()) throw new BadRequestException("This reset link has expired");

    const passwordHash = await argon2.hash(input.newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: reset.userId }, data: { passwordHash } }),
      this.prisma.passwordReset.update({ where: { id: reset.id }, data: { consumedAt: new Date() } }),
      // A password reset is how you respond to a suspected compromise, same as
      // changePassword — every existing session dies with the old password.
      this.prisma.session.deleteMany({ where: { userId: reset.userId } }),
    ]);
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.passwordHash) throw new BadRequestException("Account has no password set");
    if (!(await argon2.verify(user.passwordHash, currentPassword))) {
      throw new BadRequestException("Current password is incorrect");
    }
    const passwordHash = await argon2.hash(newPassword);
    // Changing a password invalidates every OTHER session — a password change is how you
    // respond to a suspected compromise, so leaving old cookies alive would defeat it.
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
      this.prisma.session.deleteMany({ where: { userId } }),
    ]);
  }

  private toDto(
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
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
