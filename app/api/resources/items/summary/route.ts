import { NextResponse, type NextRequest } from "next/server";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { summary, type SummaryDto } from "@/lib/server/resources/items";

/** Dashboard-shaped counts over the caller's scoped set. Deliberately minimal — the
 *  dashboard UI itself is a later phase; this proves the read path, not the final
 *  shape a dashboard will want. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const result = await summary(user.id);
    return NextResponse.json<SummaryDto>(result, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
