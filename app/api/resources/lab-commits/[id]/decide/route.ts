import { NextResponse, type NextRequest } from "next/server";
import { DecideCommitInput, type LabCommitRequestDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { decideCommit } from "@/lib/server/resources/lab-drafts";

type Params = { params: Promise<{ id: string }> };

/** Approve or reject one lab commit request. Decided by exactly the lab's owning
 *  department's head, re-derived live — a vacant post refuses everyone, a headship
 *  change redirects who may decide with no rebuild. Approving VISIBLE applies every
 *  staged operation through the existing write door; approving IDEAL upserts the
 *  lab's target quantities directly. Rejecting leaves the draft intact for revision. */
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
