import { NextResponse, type NextRequest } from "next/server";
import type { LabSummaryDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession, requireRole, STAFF_ROLES } from "@/lib/server/auth/session";
import { listLabs } from "@/lib/server/resources/lab-versions";

/** The labs (top-level resources) the caller answers for — Lab states' own list. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    requireRole(user, STAFF_ROLES);
    return NextResponse.json<LabSummaryDto[]>(await listLabs(user.id), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
