import { NextResponse, type NextRequest } from "next/server";
import { CompilePurchaseInput, type PurchaseRequestDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { getRequest, reviseAndResubmit } from "@/lib/server/resources/purchasing";

type Params = { params: Promise<{ id: string }> };

/** Readable by the requester, any current/past step's approver, procurement, or
 *  SYS_ADMIN — 404 otherwise (a 403 would confirm the row exists). */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const result = await getRequest(user.id, id);
    return NextResponse.json<PurchaseRequestDto>(result, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Revise-and-resubmit — only while the request is REVISING (an approver sent it
 *  back) and only by the original raiser. Replaces the whole line set and rebuilds
 *  the chain fresh. */
export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const body = await parseBody(CompilePurchaseInput, request);
    const result = await reviseAndResubmit(user.id, id, body);
    return NextResponse.json<PurchaseRequestDto>(result, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
