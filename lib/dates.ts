/** Small date-presentation helpers shared by the pending-tasks and task-form screens. */

export function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

/** "closes in 4 days" / "closes today" / "closed" — the design's phrasing for urgency. */
export function closeLabel(iso: string | null): string {
  const days = daysUntil(iso);
  if (days == null) return "";
  if (days < 0) return "closed";
  if (days === 0) return "closes today";
  if (days === 1) return "closes tomorrow";
  return `closes in ${days} days`;
}

/** "21 Sep 2026" — the compact form used next to the relative label. */
export function shortDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

/** Warn inside the last 5 days, matching the urgency threshold used elsewhere
 *  (min-N status, campaign ordering) so "soon" means the same thing everywhere. */
export function urgencyColor(iso: string | null): string {
  const days = daysUntil(iso);
  if (days == null) return "var(--dim)";
  return days <= 5 ? "var(--warn)" : "var(--dim)";
}
