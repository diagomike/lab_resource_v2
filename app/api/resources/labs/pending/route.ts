import { NextResponse, type NextRequest } from "next/server";
import type { PendingMarkersDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession, requireRole, STAFF_ROLES } from "@/lib/server/auth/session";
import { pendingMarkers } from "@/lib/server/resources/lab-versions";

/** Register markers — which items a pending Draft would change, and how. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    requireRole(user, STAFF_ROLES);
    return NextResponse.json<PendingMarkersDto>(await pendingMarkers(user.id), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
