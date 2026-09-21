import { NextResponse, type NextRequest } from "next/server";
import { DecideBookingInput, type ReservationDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { decideBooking } from "@/lib/server/scheduling/reservations";

type Params = { params: Promise<{ id: string }> };

/** The room's custodian approves or declines a requested booking. */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const body = await parseBody(DecideBookingInput, request);
    return NextResponse.json<ReservationDto>(await decideBooking(user.id, id, body.decision, body.note), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
