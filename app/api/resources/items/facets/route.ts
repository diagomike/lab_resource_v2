import { NextResponse, type NextRequest } from "next/server";
import type { ItemFacetCounts } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { facets, parseItemQuery } from "@/lib/server/resources/items";
import { assertCanBrowseUniversity } from "@/lib/server/resources/scope";

/** Live per-field option counts with that field's own rule relaxed — how the filter
 *  bar's faceted dropdowns show a count next to each option without it narrowing
 *  itself. Computed over the caller's scoped set only. `?scope=UNIVERSITY` — see
 *  `/items`'s own note. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const sp = request.nextUrl.searchParams;
    const university = sp.get("scope") === "UNIVERSITY";
    if (university) await assertCanBrowseUniversity(user.id);

    const result = await facets(user.id, parseItemQuery(sp), university ? "UNIVERSITY" : undefined);
    return NextResponse.json<ItemFacetCounts>(result, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
