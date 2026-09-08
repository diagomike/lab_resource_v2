import { NextResponse, type NextRequest } from "next/server";
import { DecideStepInput, type ChangeRequestDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { decideStep } from "@/lib/server/resources/approvals";

type Params = { params: Promise<{ id: string }> };

/** Approve or reject the CURRENT step of a transfer request — refused unless the
 *  actor is that step's live-resolved approver (see approvals.ts's `decideStep`). A
 *  REQUESTER_RECEIPT step is decided through this same endpoint, by the requester
 *  confirming delivery. */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const body = await parseBody(DecideStepInput, request);
    const result = await decideStep(user.id, id, body.decision, body.note);
    return NextResponse.json<ChangeRequestDto>(result, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
