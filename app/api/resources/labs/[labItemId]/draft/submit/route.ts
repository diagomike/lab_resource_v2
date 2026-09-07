import { NextResponse, type NextRequest } from "next/server";
import { SubmitDraftInput, type LabCommitRequestDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { submitDraft } from "@/lib/server/resources/lab-drafts";

type Params = { params: Promise<{ labItemId: string }> };

/** Groups every OPEN draft row this custodian has staged for this lab's given target
 *  (VISIBLE or IDEAL) into one LabCommitRequest, decided by the lab's owning
 *  department's head. */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { labItemId } = await params;
    const body = await parseBody(SubmitDraftInput, request);
    const result = await submitDraft(user.id, labItemId, body.targetKind);
    return NextResponse.json<LabCommitRequestDto>(result, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
