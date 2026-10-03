import { NextResponse, type NextRequest } from "next/server";
import { AnswerHoldInput, type ExternalRequestDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { answerHold } from "@/lib/server/external/requests";

type Params = { params: Promise<{ id: string }> };

/** A custodian answers a hold request on a place they run: hold it, can't, or waiting for a loan. */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    return NextResponse.json<ExternalRequestDto>(await answerHold(user.id, id, await parseBody(AnswerHoldInput, request)), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
