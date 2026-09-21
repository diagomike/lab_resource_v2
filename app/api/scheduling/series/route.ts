import { NextResponse, type NextRequest } from "next/server";
import { SeriesInput, type ScheduleSeriesDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse, HttpError } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { createSeries, listSeries } from "@/lib/server/scheduling/series";

/** `?labItemId=` — a room's active weekly class slots. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const labItemId = request.nextUrl.searchParams.get("labItemId");
    if (!labItemId) throw new HttpError(400, "labItemId is required.");
    return NextResponse.json<ScheduleSeriesDto[]>(await listSeries(user.id, labItemId), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Add a weekly class slot to a room. Refused with 409 + `clashes` if any session
 *  collides with something already confirmed — nothing is written in that case. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const body = await parseBody(SeriesInput, request);
    return NextResponse.json<ScheduleSeriesDto>(await createSeries(user.id, body), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
