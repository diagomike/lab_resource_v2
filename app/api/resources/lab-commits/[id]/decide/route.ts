import { NextResponse, type NextRequest } from "next/server";
import { DecideCommitInput, type LabCommitRequestDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { decideCommit } from "@/lib/server/resources/lab-versions";

type Params = { params: Promise<{ id: string }> };

/** Approve or reject one lab commit request. Decided by exactly the lab's owning
 *  department's head, re-derived live — a vacant post refuses everyone. Approving a
 *  Draft merges it into the register; approving an Ideal proposal makes it the lab's
 *  Ideal. Rejecting returns it to the custodian with the reason. */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const body = await parseBody(DecideCommitInput, request);
    const result = await decideCommit(user.id, id, body.decision, body.note);
    return NextResponse.json<LabCommitRequestDto>(result, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
