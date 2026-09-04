import { NextResponse, type NextRequest } from "next/server";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { usageCounts } from "@/lib/server/resources/categories";

/** categoryId → live item count, for the Category Studio's sidebar rows. Shared read,
 *  same as the categories list itself. */
export async function GET(request: NextRequest) {
  try {
    await requireSession(request);
    const counts = await usageCounts();
    return NextResponse.json<Record<string, number>>(counts, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
