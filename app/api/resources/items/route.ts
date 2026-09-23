import type { NextRequest } from "next/server";
import { errorResponse } from "@/lib/server/http-error";
import { jsonResponse } from "@/lib/server/json-response";
import { requireSession, requireRole, STAFF_ROLES } from "@/lib/server/auth/session";
import { parseItemQuery, search, type SearchResult } from "@/lib/server/resources/items";
import { resolveReadOverride } from "@/lib/server/resources/views";

/** The flat, paginated search list. Scope is resolved and applied to the full match
 *  set before the page is sliced — see items.ts's `search()`. `?scope=UNIVERSITY`
 *  (10b) and `?view=<id>` (Track 1's access views) are the two read overrides
 *  `resolveReadOverride` resolves — never trusted on their own, both re-checked
 *  server-side regardless of what the UI offered. STAFF_ROLES keeps a student or
 *  external account off the register entirely (F-031 of the 2026-09-15 campaign)
 *  — scope.ts's own default mode gave either one the same ORG_SUBTREE reach as any
 *  other resident of their home unit. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    requireRole(user, STAFF_ROLES);
    const sp = request.nextUrl.searchParams;
    const page = Number(sp.get("page") ?? "1") || 1;
    const pageSize = Number(sp.get("pageSize") ?? "50") || 50;
    const readOverride = await resolveReadOverride(user.id, sp);

    const result = await search(user.id, parseItemQuery(sp), page, pageSize, readOverride.scope, readOverride.extraFilters);
    return jsonResponse(request, result satisfies SearchResult);
  } catch (err) {
    return errorResponse(err);
  }
}
