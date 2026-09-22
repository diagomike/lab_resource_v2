import { NextResponse, type NextRequest } from "next/server";
import type { LabCommitRequestDto } from "@/lib/shared";
import { errorResponse, HttpError } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { listForActor } from "@/lib/server/resources/lab-versions";

/** `?box=inbox` — every PENDING commit request this signed-in account may decide
 *  right now (re-derived live against the org chart, never a stored flag).
 *  `?box=mine` — every request this account has raised, any status. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const box = request.nextUrl.searchParams.get("box");
    if (box !== "inbox" && box !== "mine") throw new HttpError(400, "box must be 'inbox' or 'mine'.");
    const rows = await listForActor(user.id, box);
    return NextResponse.json<LabCommitRequestDto[]>(rows, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
