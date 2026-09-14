import "server-only";
import { send } from "../mail/mail";

/**
 * Track 7's outbound mail — the requester (an outside institution with no account) and
 * the staff who move their request along. Inline HTML like every other mail in this app,
 * always sent AFTER the transaction commits and one at a time. Everything interpolated
 * is escaped: organisation names and purposes are typed by the public.
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

export function etb(santim: number): string {
  return `ETB ${(santim / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function trackingUrl(token: string): string {
  return `${APP_ORIGIN}/portal/track/${encodeURIComponent(token)}`;
}

function layout(title: string, body: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f2933;max-width:560px">
<p style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b7785;margin:0 0 4px">Adama Science and Technology University</p>
<h2 style="font-size:17px;margin:0 0 14px">${esc(title)}</h2>
${body}
<p style="font-size:12px;color:#6b7785;margin-top:22px">Laboratory Resource Management · this is an automated message.</p>
</div>`;
}

export async function mailRequester(to: string, subject: string, paragraphs: string[], link?: { href: string; label: string }): Promise<void> {
  const body = paragraphs.map((p) => `<p>${p}</p>`).join("\n") + (link ? `\n<p><a href="${esc(link.href)}" style="color:#1d5fbf">${esc(link.label)}</a></p>` : "");
  await send({ to, subject, html: layout(subject, body) });
}

export async function mailStaff(to: string | null | undefined, subject: string, paragraphs: string[], path: string): Promise<void> {
  if (!to) return;
  const body = paragraphs.map((p) => `<p>${p}</p>`).join("\n") + `\n<p><a href="${esc(`${APP_ORIGIN}${path}`)}" style="color:#1d5fbf">Open it in Lab Resources</a></p>`;
  await send({ to, subject, html: layout(subject, body) });
}
