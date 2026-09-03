import { NextResponse, type NextRequest } from "next/server";
import { PreviewItemChangeInput, type ItemChangeResultDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { previewChange } from "@/lib/server/resources/mutate";

/** The exact same validate→apply path as the real write endpoint, rolled back
 *  instead of committed — what an edit-impact preview or a pending request's "what
 *  would this do?" uses. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const body = await parseBody(PreviewItemChangeInput, request);
    const result = await previewChange(user.id, body.change);
    return NextResponse.json<ItemChangeResultDto>(result, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
