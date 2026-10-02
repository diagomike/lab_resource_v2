import { NextResponse, type NextRequest } from "next/server";
import type { PurchaseDetailsDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { getRequestDetails } from "@/lib/server/resources/purchasing";

type Params = { params: Promise<{ id: string }> };

/** The lines in depth — each one's kind and the lab needs it answers. Same read gate as
 *  the request (404 when unreadable). */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const result = await getRequestDetails(user.id, id);
    return NextResponse.json<PurchaseDetailsDto>(result, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
