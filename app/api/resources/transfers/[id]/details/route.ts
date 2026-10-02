import { NextResponse, type NextRequest } from "next/server";
import type { TransferDetailsDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { getTransferDetails } from "@/lib/server/resources/transfer-details";

type Params = { params: Promise<{ id: string }> };

/** Each resource the transfer moves, as the register holds it now, and where it is
 *  going. Same read gate as the request (404 when unreadable). */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const result = await getTransferDetails(user.id, id);
    return NextResponse.json<TransferDetailsDto>(result, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
