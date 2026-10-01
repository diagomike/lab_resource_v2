/**
 * Links to one exact thing — what every notice (email, bell, Home) opens, so nobody lands
 * on a list and has to hunt. The screens read these parameters: Approvals opens the right
 * tab and scrolls to `focus`; Categories opens `id` and its `change`; a place opens `tab`.
 */

export type ApprovalKind = "transfer" | "lab-commit" | "purchase" | "booking" | "category-change";

export const paths = {
  /** Something waiting for this person's decision. */
  decide: (kind: ApprovalKind, id: string) => `/approvals?focus=${kind}:${id}`,
  /** Something this person asked for — where it stands now. */
  mine: (kind: ApprovalKind, id: string) => `/approvals?box=mine&focus=${kind}:${id}`,
  category: (categoryId: string, changeId?: string) => `/categories?id=${categoryId}${changeId ? `&change=${changeId}` : ""}`,
  place: (placeId: string, tab?: "current" | "draft" | "approvals") => `/places/${placeId}${tab ? `?tab=${tab}` : ""}`,
  needs: () => "/purchasing?tab=needs",
  arrivals: () => "/purchasing?tab=arrivals",
  requests: () => "/purchasing?tab=requests",
  calendar: (labId: string) => `/schedule?lab=${labId}`,
  home: () => "/home",
};

/** "transfer:abc" → { kind, id } — the Approvals `focus` parameter. */
export function parseFocus(value: string | null): { kind: ApprovalKind; id: string } | null {
  if (!value) return null;
  const i = value.indexOf(":");
  if (i < 1) return null;
  const kind = value.slice(0, i) as ApprovalKind;
  if (!["transfer", "lab-commit", "purchase", "booking", "category-change"].includes(kind)) return null;
  return { kind, id: value.slice(i + 1) };
}

/** Sign in, then come back to the page open now (browser only). */
export function loginHref(): string {
  if (typeof window === "undefined") return "/login";
  const here = window.location.pathname + window.location.search + window.location.hash;
  const next = safeNext(here);
  return next && next !== "/" ? `/login?next=${encodeURIComponent(next)}` : "/login";
}

/** A same-site path to return to after signing in — never another site. */
export function safeNext(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  if (value.startsWith("/login") || value.startsWith("/api/")) return null;
  return value;
}
