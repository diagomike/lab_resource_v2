import { NextResponse, type NextRequest } from "next/server";
import type { SchedulingLabDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { myLabs } from "@/lib/server/scheduling/reservations";

/** Rooms whose calendar the caller keeps (every bookable room in their custody). */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    return NextResponse.json<SchedulingLabDto[]>(await myLabs(user.id), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
