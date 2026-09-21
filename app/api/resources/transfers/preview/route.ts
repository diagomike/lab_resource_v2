import { NextResponse, type NextRequest } from "next/server";
import { RequestTransferInput } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { previewTransfer } from "@/lib/server/resources/approvals";

/** Read-only: resolves what a transfer WOULD do, without creating a `ChangeRequest`
 *  — what `TransferModal` calls before the requester commits to asking, so it can
 *  say "applies immediately" or "needs approval from X, then Y" up front. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const body = await parseBody(RequestTransferInput, request);
    const result = await previewTransfer(user.id, body.input);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
