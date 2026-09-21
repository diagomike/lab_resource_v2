import { NextResponse, type NextRequest } from "next/server";
import { CancelBookingInput, type ReservationDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { cancelBooking } from "@/lib/server/scheduling/reservations";

type Params = { params: Promise<{ id: string }> };

/** Withdraw one's own booking, or — as the room's custodian — cancel anything on its
 *  calendar (a class date becomes a series exception). */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const body = await parseBody(CancelBookingInput, request);
    return NextResponse.json<ReservationDto>(await cancelBooking(user.id, id, body.note), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
