import { NextResponse, type NextRequest } from "next/server";
import type { HomeDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { homeFor } from "@/lib/server/home/home";

/** Home for the signed-in person: the next step, what waits, what is theirs, what is new. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    return NextResponse.json<HomeDto>(await homeFor(user.id), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
