import { NextResponse, type NextRequest } from "next/server";
import type { ItemSummaryDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { summary } from "@/lib/server/resources/items";
import { assertCanBrowseUniversity } from "@/lib/server/resources/scope";

/** Dashboard-shaped counts over the caller's scoped set. `?scope=UNIVERSITY` — see
 *  `/items`'s own note. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const university = request.nextUrl.searchParams.get("scope") === "UNIVERSITY";
    if (university) await assertCanBrowseUniversity(user.id);

    const result = await summary(user.id, university ? "UNIVERSITY" : undefined);
    return NextResponse.json<ItemSummaryDto>(result, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
