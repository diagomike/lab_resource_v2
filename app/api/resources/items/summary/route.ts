import { NextResponse, type NextRequest } from "next/server";
import type { ItemSummaryDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { parseItemQuery, summary } from "@/lib/server/resources/items";
import { resolveReadOverride } from "@/lib/server/resources/views";

/** Dashboard-shaped counts over the caller's scoped set. `?scope=UNIVERSITY`/
 *  `?view=<id>` — see `/items`'s own note. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const sp = request.nextUrl.searchParams;
    const readOverride = await resolveReadOverride(user.id, sp);

    const result = await summary(user.id, readOverride.scope, parseItemQuery(sp), readOverride.extraFilters);
    return NextResponse.json<ItemSummaryDto>(result, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
