import type { NextRequest } from "next/server";
import { errorResponse } from "@/lib/server/http-error";
import { jsonResponse } from "@/lib/server/json-response";
import { requireSession, requireRole, STAFF_ROLES } from "@/lib/server/auth/session";
import { parseItemQuery, tree } from "@/lib/server/resources/items";
import { resolveReadOverride } from "@/lib/server/resources/views";

/** The whole scoped, filter-expanded (ancestor + descendant closed) set, unpaginated
 *  — what both the Hierarchy and Rollup register views build from client-side via
 *  lib/domain/tree.ts's `buildTree`/`buildRollup`. See items.ts's `tree()` for why
 *  there is one endpoint, not two. `?scope=UNIVERSITY`/`?view=<id>` — see `/items`'s
 *  own note; so is STAFF_ROLES (F-031 of the 2026-09-15 campaign). */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    requireRole(user, STAFF_ROLES);
    const sp = request.nextUrl.searchParams;
    const readOverride = await resolveReadOverride(user.id, sp);

    const result = await tree(user.id, parseItemQuery(sp), readOverride.scope, readOverride.extraFilters);
    return jsonResponse(request, result);
  } catch (err) {
    return errorResponse(err);
  }
}
