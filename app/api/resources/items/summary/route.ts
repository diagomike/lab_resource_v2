import { NextResponse, type NextRequest } from "next/server";
import type { ItemSummaryDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { summary } from "@/lib/server/resources/items";

/** Dashboard-shaped counts over the caller's scoped set. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const result = await summary(user.id);
    return NextResponse.json<ItemSummaryDto>(result, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
