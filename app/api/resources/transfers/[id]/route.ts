import { NextResponse, type NextRequest } from "next/server";
import type { ChangeRequestDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { getRequest } from "@/lib/server/resources/approvals";

type Params = { params: Promise<{ id: string }> };

/** Readable by the requester, any step's current or past resolved approver, or
 *  SYS_ADMIN — 404 otherwise (a 403 would confirm the row exists). */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const result = await getRequest(user.id, id);
    return NextResponse.json<ChangeRequestDto>(result, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
