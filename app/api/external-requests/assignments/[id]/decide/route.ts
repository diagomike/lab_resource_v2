import { NextResponse, type NextRequest } from "next/server";
import { DecideAssignmentInput, type ExternalRequestDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { decideAssignment } from "@/lib/server/external/requests";

type Params = { params: Promise<{ id: string }> };

/** A department head accepts (pricing sheet link + amount) or declines their part. */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const body = await parseBody(DecideAssignmentInput, request);
    return NextResponse.json<ExternalRequestDto>(await decideAssignment(user.id, id, body), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
