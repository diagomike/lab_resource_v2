import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, HttpError } from "@/lib/server/http-error";
import { requireRole, requireSession, STAFF_ROLES } from "@/lib/server/auth/session";
import { returnTarget } from "@/lib/server/resources/approvals";

/** Where a borrowed resource goes home to: the place it came from, and the owning
 *  unit's places. For either side of the loan. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    requireRole(user, STAFF_ROLES);
    const itemId = request.nextUrl.searchParams.get("itemId");
    if (!itemId) throw new HttpError(400, "Say which resource: ?itemId=");
    return NextResponse.json(await returnTarget(user.id, itemId), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
