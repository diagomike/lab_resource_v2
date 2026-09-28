import { NextResponse, type NextRequest } from "next/server";
import { FinishTaskInput, type ExternalRequestDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { finishTask } from "@/lib/server/external/requests";

type Params = { params: Promise<{ id: string }> };

/** A custodian reports back to their head: held what was asked, or can't. */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    return NextResponse.json<ExternalRequestDto>(await finishTask(user.id, id, await parseBody(FinishTaskInput, request)), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
