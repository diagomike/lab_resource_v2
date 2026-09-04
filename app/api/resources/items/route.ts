import { NextResponse, type NextRequest } from "next/server";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { parseItemQuery, search, type SearchResult } from "@/lib/server/resources/items";
import { assertCanBrowseUniversity } from "@/lib/server/resources/scope";

/** The flat, paginated search list. Scope is resolved and applied to the full match
 *  set before the page is sliced — see items.ts's `search()`. `?scope=UNIVERSITY`
 *  (10b of ~/.claude/plans/three-product-changes-dynamic-thompson.md) is never
 *  trusted on its own — `assertCanBrowseUniversity` re-checks server-side regardless
 *  of what the UI offered. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const sp = request.nextUrl.searchParams;
    const page = Number(sp.get("page") ?? "1") || 1;
    const pageSize = Number(sp.get("pageSize") ?? "50") || 50;
    const university = sp.get("scope") === "UNIVERSITY";
    if (university) await assertCanBrowseUniversity(user.id);

    const result = await search(user.id, parseItemQuery(sp), page, pageSize, university ? "UNIVERSITY" : undefined);
    return NextResponse.json<SearchResult>(result, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
