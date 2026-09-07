import { NextResponse, type NextRequest } from "next/server";
import type { IdealVsActualRowDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { getIdealVsActual } from "@/lib/server/resources/lab-drafts";

type Params = { params: Promise<{ labItemId: string }> };

/** Per category within this lab: the approved ideal target, the live actual count,
 *  the gap, and any currently broken/impaired items — the numbers a department head
 *  adjusts before sending a real purchase request upward (Track 4). Read-only; scope
 *  checked the same way any other item read is (out-of-scope returns 404). */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { labItemId } = await params;
    const rows = await getIdealVsActual(user.id, labItemId);
    return NextResponse.json<IdealVsActualRowDto[]>(rows, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
