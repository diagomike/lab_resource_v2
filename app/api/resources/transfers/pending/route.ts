import { NextResponse, type NextRequest } from "next/server";
import type { PendingTransferMarkersDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession, requireRole, STAFF_ROLES } from "@/lib/server/auth/session";
import { pendingTransferMarkers } from "@/lib/server/resources/approvals";

/** Register markers — which items a pending transfer or handover will move, and where. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    requireRole(user, STAFF_ROLES);
    return NextResponse.json<PendingTransferMarkersDto>(await pendingTransferMarkers(user.id), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
