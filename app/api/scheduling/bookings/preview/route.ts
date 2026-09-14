import { NextResponse, type NextRequest } from "next/server";
import { BookingInput, type BookingPreviewDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { previewBooking } from "@/lib/server/scheduling/reservations";

/** What booking this would run into — blocking clashes and contending requests — and
 *  whether it would confirm immediately. Writes no booking. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const body = await parseBody(BookingInput, request);
    return NextResponse.json<BookingPreviewDto>(await previewBooking(user.id, body), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
