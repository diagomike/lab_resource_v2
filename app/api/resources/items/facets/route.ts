import { NextResponse, type NextRequest } from "next/server";
import type { ItemFacetCounts } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { facets, parseItemQuery } from "@/lib/server/resources/items";

/** Live per-field option counts with that field's own rule relaxed — how the filter
 *  bar's faceted dropdowns show a count next to each option without it narrowing
 *  itself. Computed over the caller's scoped set only. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const result = await facets(user.id, parseItemQuery(request.nextUrl.searchParams));
    return NextResponse.json<ItemFacetCounts>(result, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
