import type { NextRequest } from "next/server";
import type { ItemSummaryDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { jsonResponse } from "@/lib/server/json-response";
import { requireSession, requireRole, STAFF_ROLES } from "@/lib/server/auth/session";
import { parseItemQuery, summary } from "@/lib/server/resources/items";
import { resolveReadOverride } from "@/lib/server/resources/views";

/** Dashboard-shaped counts over the caller's scoped set. `?scope=UNIVERSITY`/
 *  `?view=<id>` and STAFF_ROLES — see `/items`'s own note (F-031). */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    requireRole(user, STAFF_ROLES);
    const sp = request.nextUrl.searchParams;
    const readOverride = await resolveReadOverride(user.id, sp);

    const result = await summary(user.id, readOverride.scope, parseItemQuery(sp), readOverride.extraFilters);
    return jsonResponse(request, result satisfies ItemSummaryDto);
  } catch (err) {
    return errorResponse(err);
  }
}
