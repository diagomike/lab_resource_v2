import { NextResponse, type NextRequest } from "next/server";
import type { BookableDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { searchBookables } from "@/lib/server/scheduling/reservations";

/** `?q=` (≥ 2 characters) — bookable rooms and machines across the university. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const q = request.nextUrl.searchParams.get("q") ?? "";
    return NextResponse.json<BookableDto[]>(await searchBookables(user.id, q), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
