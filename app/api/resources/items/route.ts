import { NextResponse, type NextRequest } from "next/server";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { parseItemQuery, search, type SearchResult } from "@/lib/server/resources/items";

/** The flat, paginated search list. Scope is resolved and applied to the full match
 *  set before the page is sliced — see items.ts's `search()`. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const sp = request.nextUrl.searchParams;
    const page = Number(sp.get("page") ?? "1") || 1;
    const pageSize = Number(sp.get("pageSize") ?? "50") || 50;

    const result = await search(user.id, parseItemQuery(sp), page, pageSize);
    return NextResponse.json<SearchResult>(result, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
