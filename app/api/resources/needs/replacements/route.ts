import { NextResponse, type NextRequest } from "next/server";
import type { ReplacementSuggestionDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { replacementSuggestions } from "@/lib/server/resources/purchasing";

/** Broken or lost items with no replacement asked for yet: `?node=<id>` — in the labs
 *  that unit owns (its head); omitted — in the labs the caller runs (a custodian). */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const node = request.nextUrl.searchParams.get("node") ?? undefined;
    return NextResponse.json<ReplacementSuggestionDto[]>(await replacementSuggestions(user.id, node), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
