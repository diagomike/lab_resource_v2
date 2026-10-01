import { NextResponse, type NextRequest } from "next/server";
import { ItemChangeInput, type ItemChangeResultDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { applyChange } from "@/lib/server/resources/mutate";

/**
 * The one write door — every item mutation, of every kind, goes through this single
 * endpoint. See mutate.ts's own header for why there is exactly one path. Scope is
 * enforced inside `applyChange` itself (assertAuthorized), not here — a signed-in
 * user is enough to reach this handler; whether they may act on the named items is
 * the write path's own job, same split reads already follow.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const body = await parseBody(ItemChangeInput, request);
    const result = await applyChange(user.id, body);
    return NextResponse.json<ItemChangeResultDto>(result, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
