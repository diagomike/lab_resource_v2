import { NextResponse, type NextRequest } from "next/server";
import { DecidePurchaseInput, type PurchaseRequestDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { decideStep } from "@/lib/server/resources/purchasing";

type Params = { params: Promise<{ id: string }> };

/** Approve, reject, or send back for revision — refused unless the actor is the
 *  current step's live-resolved approver (see purchasing.ts's `decideStep`). */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const body = await parseBody(DecidePurchaseInput, request);
    const result = await decideStep(user.id, id, body.decision, body.note);
    return NextResponse.json<PurchaseRequestDto>(result, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
