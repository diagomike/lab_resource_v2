import { NextResponse, type NextRequest } from "next/server";
import type { ReservationDto } from "@/lib/shared";
import { errorResponse, HttpError } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { listCalendar } from "@/lib/server/scheduling/reservations";

/** `?labItemId=&from=YYYY-MM-DD&to=YYYY-MM-DD` — everything live on a room's calendar,
 *  the room itself or anything inside it, between two civil dates inclusive. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const sp = request.nextUrl.searchParams;
    const labItemId = sp.get("labItemId");
    if (!labItemId) throw new HttpError(400, "labItemId is required.");
    const rows = await listCalendar(user.id, labItemId, sp.get("from") ?? "", sp.get("to") ?? "");
    return NextResponse.json<ReservationDto[]>(rows, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
