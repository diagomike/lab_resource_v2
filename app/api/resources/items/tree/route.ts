import { NextResponse, type NextRequest } from "next/server";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { parseItemQuery, tree } from "@/lib/server/resources/items";

/** The whole scoped, filter-expanded (ancestor + descendant closed) set, unpaginated
 *  — what both the Hierarchy and Rollup register views build from client-side via
 *  lib/domain/tree.ts's `buildTree`/`buildRollup`. See items.ts's `tree()` for why
 *  there is one endpoint, not two. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const result = await tree(user.id, parseItemQuery(request.nextUrl.searchParams));
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
