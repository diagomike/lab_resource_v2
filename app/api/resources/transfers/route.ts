import { NextResponse, type NextRequest } from "next/server";
import { RequestTransferInput, type ChangeRequestDto, type RequestTransferResultDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse, HttpError } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { requestTransfer, listForActor } from "@/lib/server/resources/approvals";

/** Track 3 — request a cross-lab transfer. Resolves the governing policy and either
 *  applies it on the spot (AUTO, or a chain that turns out entirely self-held) or
 *  creates a `ChangeRequest` for the owning/receiving heads to decide — see
 *  approvals.ts's own header for the full design. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const body = await parseBody(RequestTransferInput, request);
    const result = await requestTransfer(user.id, body.input);
    return NextResponse.json<RequestTransferResultDto>(result, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}

/** `?box=inbox` — every PENDING transfer request this actor may decide right now.
 *  `?box=mine` — every transfer request this actor raised, any status. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const box = request.nextUrl.searchParams.get("box");
    if (box !== "inbox" && box !== "mine") throw new HttpError(400, "box must be 'inbox' or 'mine'.");
    const rows = await listForActor(user.id, box);
    return NextResponse.json<ChangeRequestDto[]>(rows, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
