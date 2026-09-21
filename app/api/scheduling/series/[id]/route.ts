import { NextResponse, type NextRequest } from "next/server";
import { UpdateSeriesInput, type ScheduleSeriesDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { removeSeries, updateSeries } from "@/lib/server/scheduling/series";

type Params = { params: Promise<{ id: string }> };

/** Change a class slot; its future sessions are regenerated (exceptions kept). */
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const body = await parseBody(UpdateSeriesInput, request);
    return NextResponse.json<ScheduleSeriesDto>(await updateSeries(user.id, id, body), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Remove a class slot — its future sessions leave the calendar, past ones stay. */
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    await removeSeries(user.id, id);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
