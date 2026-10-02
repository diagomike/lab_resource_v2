import "server-only";
import * as argon2 from "@node-rs/argon2";
import type { ExternalSignupInput } from "@/lib/shared";
import { prisma } from "../prisma";
import { HttpError } from "../http-error";
import * as mail from "../mail/mail";
import { generateToken, hashToken } from "./token";

/**
 * Accounts for outside requesters (2026-09-28) — an institution or company asking the
 * university for rooms, labs or a sample analysis signs up on the portal and verifies its
 * email, then follows its requests signed in. An EXTERNAL account reaches the portal
 * only: every staff route already refuses it (STAFF_ROLES), and the workspace sends it to
 * the portal.
 *
 * The verification link is an `Invitation` row (intendedRole EXTERNAL) — the same hashed,
 * expiring, single-use token staff invitations use. Until it is followed the account is
 * INVITED, which sign-in refuses.
 */

const APP_ORIGIN = process.env.APP_ORIGIN ?? "http://localhost:3000";
const VERIFY_TTL_HOURS = 48;
const SIGNUPS_PER_IP_PER_DAY = 10;
const VERIFY_MAILS_PER_HOUR = 3;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function sendVerification(user: { email: string; emailLower: string; name: string }): Promise<void> {
  const raw = generateToken();
  await prisma.invitation.create({
    data: { emailLower: user.emailLower, tokenHash: hashToken(raw), intendedRole: "EXTERNAL", expiresAt: new Date(Date.now() + VERIFY_TTL_HOURS * 3_600_000) },
  });
  await mail.send({
    to: user.email,
    subject: "Confirm your email: ASTU resources for workshops & training",
    html: `<p>Hello ${escapeHtml(user.name)},</p>
           <p>Confirm your email address to finish creating your account. This link expires in ${VERIFY_TTL_HOURS} hours.</p>
           <p><a href="${APP_ORIGIN}/portal/verify?token=${raw}">Confirm my email</a></p>
           <p>If you did not sign up, you can ignore this email.</p>`,
  });
}

export async function signUp(input: ExternalSignupInput, ipHash: string | null): Promise<void> {
  if (input.website) throw new HttpError(400, "Your sign-up could not be accepted.");
  const emailLower = input.email.toLowerCase();

  // Table-counted, like every other throttle here (serverless-safe): sign-ups per IP a day.
  const since = new Date(Date.now() - 86_400_000);
  const key = `signup:${ipHash ?? "unknown"}`;
  if ((await prisma.loginAttempt.count({ where: { emailLower: key, createdAt: { gte: since } } })) >= SIGNUPS_PER_IP_PER_DAY) {
    throw new HttpError(429, "Too many sign-ups from here today. Please try again tomorrow.");
  }
  await prisma.loginAttempt.create({ data: { emailLower: key, ipHash, succeeded: false } });

  const passwordHash = await argon2.hash(input.password);
  const existing = await prisma.user.findUnique({ where: { emailLower }, include: { roles: true } });
  if (existing) {
    const unverifiedRequester = existing.status === "INVITED" && existing.roles.length === 1 && existing.roles[0].kind === "EXTERNAL";
    if (!unverifiedRequester) throw new HttpError(409, "An account with this email already exists. Sign in, or reset your password.");
    // Signing up again before verifying: take the new details and send a fresh link.
    const recent = await prisma.invitation.count({ where: { emailLower, intendedRole: "EXTERNAL", createdAt: { gte: new Date(Date.now() - 3_600_000) } } });
    if (recent >= VERIFY_MAILS_PER_HOUR) throw new HttpError(429, "We've sent several links already. Check your inbox (and spam), or try again in an hour.");
    const user = await prisma.user.update({ where: { id: existing.id }, data: { name: input.name, phone: input.phone, organisation: input.organisation, passwordHash } });
    await sendVerification(user);
    return;
  }

  const user = await prisma.user.create({
    data: {
      email: input.email,
      emailLower,
      name: input.name,
      phone: input.phone,
      organisation: input.organisation,
      passwordHash,
      status: "INVITED",
      roles: { create: [{ kind: "EXTERNAL" }] },
    },
  });
  await sendVerification(user);
}

/** Follows the emailed link: activates the account, and attaches any request sent from
 *  this address before accounts existed. */
export async function verifyEmail(token: string): Promise<{ email: string }> {
  const invitation = await prisma.invitation.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!invitation || invitation.intendedRole !== "EXTERNAL") throw new HttpError(400, "This link is not valid.");
  if (invitation.consumedAt) throw new HttpError(400, "This link has already been used. Sign in.");
  if (invitation.expiresAt < new Date()) throw new HttpError(400, "This link has expired. Sign up again to get a new one.");
  const user = await prisma.user.findUnique({ where: { emailLower: invitation.emailLower } });
  if (!user || user.status === "DISABLED") throw new HttpError(400, "This account can't be activated. Contact the university.");

  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { status: "ACTIVE" } }),
    prisma.invitation.update({ where: { id: invitation.id }, data: { consumedAt: new Date() } }),
    prisma.externalRequest.updateMany({ where: { requesterId: null, contactEmail: user.emailLower }, data: { requesterId: user.id } }),
  ]);
  return { email: user.email };
}
