import { NextResponse, type NextRequest } from "next/server";
import type { HomeCountsDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { homeCounts } from "@/lib/server/home/home";

/** The sidebar's badges and the bell's unread count. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    return NextResponse.json<HomeCountsDto>(await homeCounts(user.id), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
