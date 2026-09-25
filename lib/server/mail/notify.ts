import "server-only";
import { prisma } from "../prisma";
import { send } from "./mail";

/**
 * "Something is waiting for you" and "here's what happened to your request" — the
 * emails behind the internal approval flows (purchasing, lab commits, transfers, lab
 * bookings). Same discipline as every other mail in this app:
 *  - called only AFTER the write has committed, never inside a transaction;
 *  - one message at a time (never Promise.all);
 *  - a failure is logged by `send` and never breaks the request that triggered it.
 *
 * Recipients are user ids, resolved here to ACTIVE accounts that have notification
 * emails switched on (User.emailNotifications — Profile, or People & roles). The person
 * who just acted is never emailed about their own action. Everything interpolated is
 * escaped: titles, notes and item names are typed by people.
 */

export const APP_ORIGIN = process.env.APP_ORIGIN ?? "http://localhost:3000";

export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function layout(title: string, body: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f2933;max-width:560px">
<p style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b7785;margin:0 0 4px">Adama Science and Technology University</p>
<h2 style="font-size:17px;margin:0 0 14px">${esc(title)}</h2>
${body}
<p style="font-size:12px;color:#6b7785;margin-top:22px">Laboratory Resource Management · this is an automated message.</p>
</div>`;
}

export interface Notice {
  subject: string;
  /** Paragraphs of trusted HTML — escape anything user-typed with `esc` first. */
  paragraphs: string[];
  /** App path the button opens ("/approvals"). */
  path: string;
  /** Button text; defaults to "Open it in Lab Resources". */
  action?: string;
}

/** Emails each recipient (user ids; nulls and duplicates ignored), except `actorId`. */
export async function notify(recipientIds: Array<string | null | undefined> | string | null | undefined, actorId: string | null, notice: Notice): Promise<void> {
  const ids = [...new Set((Array.isArray(recipientIds) ? recipientIds : [recipientIds]).filter((id): id is string => !!id && id !== actorId))];
  if (!ids.length) return;
  const users = await prisma.user.findMany({ where: { id: { in: ids }, status: "ACTIVE", emailNotifications: true }, select: { email: true } });
  const href = `${APP_ORIGIN}${notice.path}`;
  const body =
    notice.paragraphs.map((p) => `<p>${p}</p>`).join("\n") +
    `\n<p><a href="${esc(href)}" style="display:inline-block;background:#0b5cad;color:#ffffff;text-decoration:none;padding:8px 14px;border-radius:4px">${esc(notice.action ?? "Open it in Lab Resources")}</a></p>`;
  for (const u of users) await send({ to: u.email, subject: notice.subject, html: layout(notice.subject, body) });
}

/** Everyone holding a role — e.g. the store keepers, when an order arrives at the store. */
export async function usersWithRole(role: "STORE_KEEPER" | "PROCUREMENT"): Promise<string[]> {
  const rows = await prisma.userRole.findMany({ where: { kind: role, user: { status: "ACTIVE" } }, select: { userId: true } });
  return rows.map((r) => r.userId);
}

/** A note, quoted, when there is one. */
export function quoted(note: string | null | undefined): string {
  return note?.trim() ? `<br><em>“${esc(note.trim())}”</em>` : "";
}
