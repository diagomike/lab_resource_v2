import { NextResponse, type NextRequest } from "next/server";
import type { ItemFacetCounts } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession, requireRole, STAFF_ROLES } from "@/lib/server/auth/session";
import { facets, parseItemQuery } from "@/lib/server/resources/items";
import { resolveReadOverride } from "@/lib/server/resources/views";

/** Live per-field option counts with that field's own rule relaxed — how the filter
 *  bar's faceted dropdowns show a count next to each option without it narrowing
 *  itself. Computed over the caller's scoped set only. `?scope=UNIVERSITY`/
 *  `?view=<id>` and STAFF_ROLES — see `/items`'s own note (F-031). */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    requireRole(user, STAFF_ROLES);
    const sp = request.nextUrl.searchParams;
    const readOverride = await resolveReadOverride(user.id, sp);

    const result = await facets(user.id, parseItemQuery(sp), readOverride.scope, readOverride.extraFilters);
    return NextResponse.json<ItemFacetCounts>(result, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
