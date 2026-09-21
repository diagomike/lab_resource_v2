import { NextResponse, type NextRequest } from "next/server";
import { StageDraftChangeInput, type ItemDraftChangeDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { listDraft, stageChange } from "@/lib/server/resources/lab-drafts";

type Params = { params: Promise<{ labItemId: string }> };

/** The custodian's own pending-changes view for one lab — Track 2's draft staging
 *  area. Nothing here is visible to the register until a batch is submitted and
 *  approved (lab-drafts.ts's own header). */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { labItemId } = await params;
    const rows = await listDraft(user.id, labItemId);
    return NextResponse.json<ItemDraftChangeDto[]>(rows, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { labItemId } = await params;
    const body = await parseBody(StageDraftChangeInput, request);
    const row = await stageChange(user.id, labItemId, body);
    return NextResponse.json<ItemDraftChangeDto>(row, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
