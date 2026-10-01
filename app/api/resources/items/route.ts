import type { NextRequest } from "next/server";
import { errorResponse } from "@/lib/server/http-error";
import { jsonResponse } from "@/lib/server/json-response";
import { requireSession, requireRole, STAFF_ROLES } from "@/lib/server/auth/session";
import { parseItemQuery, search, type SearchResult } from "@/lib/server/resources/items";
import { resolveReadOverride } from "@/lib/server/resources/read-scope";

/** The flat, paginated search list. Scope is resolved and applied to the full match
 *  set before the page is sliced — see items.ts's `search()`. `?scope=UNIVERSITY` is
 *  the one read override (read-scope.ts), re-checked server-side. STAFF_ROLES keeps an
 *  outside requester's account off the register entirely. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    requireRole(user, STAFF_ROLES);
    const sp = request.nextUrl.searchParams;
    const page = Number(sp.get("page") ?? "1") || 1;
    const pageSize = Number(sp.get("pageSize") ?? "50") || 50;
    const readOverride = await resolveReadOverride(user.id, sp);

    const result = await search(user.id, parseItemQuery(sp), page, pageSize, readOverride.scope);
    return jsonResponse(request, result satisfies SearchResult);
  } catch (err) {
    return errorResponse(err);
  }
}
