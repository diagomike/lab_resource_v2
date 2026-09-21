import { NextResponse, type NextRequest } from "next/server";
import { CompilePurchaseInput, type PurchaseRequestDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse, HttpError } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { compilePurchaseRequest, listForActor } from "@/lib/server/resources/purchasing";

/** The department's formal ask, compiled by its head — walks the org chart itself
 *  (see purchasing.ts's own header) straight into APPROVING. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const body = await parseBody(CompilePurchaseInput, request);
    const result = await compilePurchaseRequest(user.id, body);
    return NextResponse.json<PurchaseRequestDto>(result, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}

/** `?box=inbox` — every request at APPROVING whose current step this actor may
 *  decide right now. `?box=mine` — every request this actor raised, any status.
 *  `?box=pipeline` — procurement's own view of everything it's running.
 *  `?box=receiving` — the store keeper's own view of what's ready to register.
 *  `?box=tracking` — every request this actor takes part in, any stage, for
 *  following its status (see purchasing.ts's `readableRequestWhere`). */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const box = request.nextUrl.searchParams.get("box");
    if (box !== "inbox" && box !== "mine" && box !== "pipeline" && box !== "receiving" && box !== "tracking") {
      throw new HttpError(400, "box must be 'inbox', 'mine', 'pipeline', 'receiving', or 'tracking'.");
    }
    const rows = await listForActor(user.id, box);
    return NextResponse.json<PurchaseRequestDto[]>(rows, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
