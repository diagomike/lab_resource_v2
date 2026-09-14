import { NextResponse, type NextRequest } from "next/server";
import { SeriesExceptionInput, type ScheduleSeriesDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse, HttpError } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { addException, removeException } from "@/lib/server/scheduling/series";

type Params = { params: Promise<{ id: string }> };

/** Cancel one date of a class slot. */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const body = await parseBody(SeriesExceptionInput, request);
    return NextResponse.json<ScheduleSeriesDto>(await addException(user.id, id, body), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}

/** `?date=YYYY-MM-DD` — reinstate a cancelled date, if still ahead and still free. */
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const date = request.nextUrl.searchParams.get("date");
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, "date is required, like 2026-09-14.");
    return NextResponse.json<ScheduleSeriesDto>(await removeException(user.id, id, date), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
