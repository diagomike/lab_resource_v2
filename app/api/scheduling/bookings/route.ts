import { NextResponse, type NextRequest } from "next/server";
import { BookingInput, type ReservationDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse, HttpError } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { createStaffBooking, listBookings } from "@/lib/server/scheduling/reservations";

/** Book a room or machines in it. Confirms immediately for the room's custodian;
 *  otherwise waits for them. A clash with a HELD/CONFIRMED booking is a 409 carrying
 *  `clashes`. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const body = await parseBody(BookingInput, request);
    return NextResponse.json<ReservationDto>(await createStaffBooking(user.id, body), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

/** `?box=mine` — bookings I asked for. `?box=inbox` — requests waiting on my rooms. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const box = request.nextUrl.searchParams.get("box");
    if (box !== "mine" && box !== "inbox") throw new HttpError(400, "box must be 'mine' or 'inbox'.");
    return NextResponse.json<ReservationDto[]>(await listBookings(user.id, box), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
